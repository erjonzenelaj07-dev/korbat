# korbat moderation cases (3c) — Task 1 of 12: The ground for moderation cases: migration 0014 (the old tables, their enums and profiles.reputation dropped), migration 0015 (the moderation tables with their grants and forced columns, the attach and quote triggers, the view of measures in force, the freeze's predicate, the keep trigger and the guard on image rows, holds), the Drizzle schema, the contracts' constants and digests, image readers that give only visible images, test-db's --fresh and --upgrade-from, and the development cleaner's order

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, a staff console, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 3c gives it moderation cases: reports and notices that anyone can send, cases, decisions that are the statement of reasons, evidence, appeals and re-examination. This task lays the ground: migration 0014 removes the tables nothing wrote, migration 0015 creates the moderation tables with their grants, triggers and the freeze, the contracts gain the moderation constants, and the image readers give only visible images before any code can write another state. The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (sections 6.1, 6.5, 10 and 12).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: moderation cases (3c) plan and verified execution prompts`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/01-ground.md 1
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/media-sealed.test.ts`

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MediaStatusResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { MediaDeps } from "../../src/media/context";
import { serve } from "../../src/media/flows/serve";
import { status } from "../../src/media/flows/status";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { openCase, rowCounts } from "./moderation-fixtures";
import { rejection } from "./social-harness";
import { rolledBack } from "./staff-fixtures";

// Each test builds a store directory, uploads its images and reads them back inside one open transaction: on a loaded
// machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The image readers fail closed (3c design, sections 5 and 7.10, gate S) before any code can write the state `sealed`: an
 * image in that state is served, listed and exported to nobody, its author included, and its status carries no blurhash.
 * Only a migrator-owned function will ever write an image's moderation state, and none exists yet, so each test runs as
 * the migrator inside one transaction that is rolled back: it makes its accounts, posts and images there, sets the state,
 * and runs the readers on that same transaction. A sealed image that no decision sealed never reaches the database's
 * other readers, and the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a sealed image reaches nobody", () => {
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(migrateDb);
  });
  afterAll(async () => {
    await closeDb(migrateDb);
  });

  /** The media module on a transaction of the migrator that is rolled back, with a store directory of its own. */
  const inWorld = (fn: (h: MediaHarness, tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      const h = await mediaHarness(tx as unknown as Db);
      try {
        await fn(h, tx);
      } finally {
        h.cleanup();
      }
    });
  /** Sets the images' moderation state as the migrator, which stands in for the function of a later migration. */
  const seal = (tx: DbTx, mediaIds: readonly string[]) => tx.execute(sql`update post_media set moderation_state = 'sealed' where id = any(${`{${mediaIds.join(",")}}`}::uuid[])`);
  /** What serve answers for the large file, with the file it opened closed again. */
  async function ask(deps: MediaDeps, id: string, viewer: string | null, ifNoneMatch?: string) {
    const served = await serve(deps, { id, size: "large", ifNoneMatch, viewer: async () => viewer });
    if (served.kind === "file") await served.file.handle.close();
    return served.kind === "not_found" ? { kind: served.kind } : { kind: served.kind, cacheControl: served.cacheControl };
  }

  test("serve answers a sealed image as not found to its author, to others and signed out, and still serves its sibling", async () => {
    await inWorld(async (h, tx) => {
      const [ada, bob] = [await h.established(), await h.established()];
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      expect((await ask(h.deps, mediaIds[0]!, null)).kind).toBe("file");
      await seal(tx, [mediaIds[0]!]);
      for (const viewer of [ada.id, bob.id, null]) expect((await ask(h.deps, mediaIds[0]!, viewer)).kind, String(viewer)).toBe("not_found");
      // A browser that holds the file's tag gets no "not modified" either.
      expect((await ask(h.deps, mediaIds[0]!, ada.id, `"${mediaIds[0]}-large"`)).kind).toBe("not_found");
      expect(await ask(h.deps, mediaIds[1]!, null)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });
    });
  });

  test.each(["withheld", "removed"] as const)("a sealed image of a %s post is not found for its author too, who still gets the post's other image", async (state) => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 2);
      await seal(tx, [mediaIds[0]!]);
      await tx.execute(sql`update posts set state = ${state}::post_state where id = ${postId}::uuid`);
      // The seal is tested before the author's branch.
      expect((await ask(h.deps, mediaIds[0]!, ada.id)).kind).toBe("not_found");
      expect(await ask(h.deps, mediaIds[1]!, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
    });
  });

  test("forPosts lists a post's images without the sealed one", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 3);
      expect(((await h.deps.repo.forPosts([postId])).get(postId) ?? []).map((image) => image.id)).toEqual(mediaIds);
      await seal(tx, [mediaIds[1]!]);
      expect(((await h.deps.repo.forPosts([postId])).get(postId) ?? []).map((image) => image.id)).toEqual([mediaIds[0], mediaIds[2]]);
      await seal(tx, mediaIds);
      expect((await h.deps.repo.forPosts([postId])).get(postId)).toBeUndefined();
    });
  });

  test("readyImages, which names the files of an export, leaves the sealed image out", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      const upload = await h.readyImage(ada.id);
      expect(await h.deps.repo.readyImages(ada.id)).toEqual([...mediaIds, upload]);
      await seal(tx, [mediaIds[0]!]);
      expect(await h.deps.repo.readyImages(ada.id)).toEqual([mediaIds[1], upload]);
    });
  });

  test("find and the status flow answer a sealed image without its blurhash", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      expect(await status(h.deps, ada.id, mediaIds[0]!)).toMatchObject({ status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
      await seal(tx, [mediaIds[0]!]);
      expect(await h.deps.repo.find(mediaIds[0]!)).toMatchObject({ id: mediaIds[0], status: "ready", blurhash: null, width: 2048, height: 1536 });
      const answer = await status(h.deps, ada.id, mediaIds[0]!);
      expect(answer).toEqual({ id: mediaIds[0], status: "ready", width: 2048, height: 1536 });
      expect("blurhash" in answer).toBe(false);
      // The answer is still one the contract knows.
      expect(MediaStatusResponse.parse(answer)).toEqual(answer);
      // The post's other image is answered as before.
      expect(await status(h.deps, ada.id, mediaIds[1]!)).toMatchObject({ status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
    });
  });

  test("find and the status flow answer a kept image of a deleted post as a row that does not exist, to its owner too", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 1);
      // A case's hold keeps the row when the post is deleted; the freeze keeps rows the same way.
      await tx.execute(sql`insert into media_holds (media_id, case_id) values (${mediaIds[0]!}::uuid, ${await openCase(tx, "post", postId)}::uuid)`);
      await h.setPostState(postId, "deleted_by_author");
      expect(await h.deps.repo.detachAll(tx, postId)).toEqual([]);
      expect(await h.deps.repo.find(mediaIds[0]!)).toBeNull();
      expect(await rejection(status(h.deps, ada.id, mediaIds[0]!))).toBe("not_found");
      // The row is there: only the readers do not show it.
      expect(await h.deps.repo.existing(mediaIds)).toEqual(new Set(mediaIds));
    });
  });

  test("the same for an image that was erased, and for an image of a post whose content was erased", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const own = await h.postWithImages(ada.id, 1);
      const ofPost = await h.postWithImages(ada.id, 1);
      expect(await status(h.deps, ada.id, own.mediaIds[0]!)).toMatchObject({ status: "ready" });
      // What the R4 redaction will leave: the marks only a migrator-owned function writes.
      await tx.execute(sql`update post_media set erased_at = now() where id = ${own.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now() where id = ${ofPost.postId}::uuid`);
      for (const id of [own.mediaIds[0]!, ofPost.mediaIds[0]!]) {
        expect(await h.deps.repo.find(id), id).toBeNull();
        expect(await rejection(status(h.deps, ada.id, id)), id).toBe("not_found");
      }
    });
  });

  test("an upload on no post is found and answered as before", async () => {
    await inWorld(async (h) => {
      const ada = await h.established();
      const upload = await h.readyImage(ada.id);
      expect(await h.deps.repo.find(upload)).toMatchObject({ id: upload, ownerId: ada.id, postId: null, status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
      expect(await status(h.deps, ada.id, upload)).toEqual({ id: upload, status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3~qoL" });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(migrateDb)).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/moderation-attach.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { textDigest } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import {
  MINORS,
  SPEECH,
  answerItem,
  csamNotice,
  fabricateDecision,
  findingBy,
  gate,
  hex64,
  illegalNotice,
  insertIntake,
  insertItem,
  newMarker,
  newPostRow,
  openCase,
  readCase,
  removeFixtures,
  rowCounts,
  ruleReport,
  untilBlocked,
  type ItemRow,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements, each a round trip, and several hold a transaction open across them: on a
// loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The triggers of intake_items (3c design, section 6.1) against the real database, with the statements the intake
 * transaction will issue written here as SQL: intake_items_attach, which numbers an item into its open case and forces
 * what the API must not choose, with its checks of a re-examination; and intake_items_quote, which holds at commit that a
 * suspect item about a post that quotes another is a report about both. Statements run as korbat_api unless a test says
 * otherwise. Nothing in 0015 can answer an item or close a case, so the tests that need either write those rows as the
 * migrator. A test with one session runs inside a transaction that is rolled back; a test with two sessions has to
 * commit, and removes what it committed in a `finally`. The file's last test holds it to leaving nothing behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: intake items, their cases and their re-examinations", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 6 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** A profile, written by whichever role runs the test. */
  const profile = (db: Db | DbTx) => newProfile(db as Db);
  /** An author and a post of theirs. */
  async function authored(db: Db | DbTx, options: { quoteOfId?: string } = {}) {
    const author = await profile(db);
    return { author, postId: await newPostRow(db, author.id, options) };
  }
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  /**
   * The quote rule as it runs at commit, made to run now: the step's items are inserted with the check deferred, then the
   * check is made immediate, all in a savepoint, so the transaction goes on after a refusal.
   */
  const atCommit = (tx: DbTx, make: (sp: DbTx) => Promise<void>) =>
    within(tx, async (sp) => {
      await sp.execute(sql`set constraints public.intake_items_quote deferred`);
      await make(sp);
      await sp.execute(sql`set constraints public.intake_items_quote immediate`);
    });

  describe("numbering and the case's derived columns", () => {
    test("the first item is number 1 and gives the case its lane and its oldest time; later items number on, and the lane only gets more severe", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const reporters = [await profile(tx), await profile(tx), await profile(tx)];
        const caseId = await openCase(tx, "post", postId);
        expect(await readCase(tx, caseId)).toMatchObject({ lane: 2, intake_seq: 0, answered_seq: 0, oldest_open_at: null, closed_at: null });

        const first = await insertItem(tx, { intakeId: await ruleReport(tx, reporters[0]!.id), caseId, targetId: postId, lane: 2 });
        expect(first).toMatchObject({ seq: 1, case_id: caseId, outcome: null });
        const opened = await readCase(tx, caseId);
        expect(opened).toMatchObject({ lane: 2, intake_seq: 1, answered_seq: 0 });
        expect(opened.oldest_open_at).toEqual(first.created_at);

        const second = await insertItem(tx, { intakeId: await ruleReport(tx, reporters[1]!.id, "R3"), caseId, targetId: postId, lane: 1 });
        const third = await insertItem(tx, { intakeId: await ruleReport(tx, reporters[2]!.id), caseId, targetId: postId, lane: 2 });
        expect([second.seq, third.seq]).toEqual([2, 3]);
        // The most severe lane of the unanswered items, and the time of the oldest of them.
        expect(await readCase(tx, caseId)).toMatchObject({ lane: 1, intake_seq: 3, oldest_open_at: opened.oldest_open_at });
      });
    });

    test("when no item is left unanswered, the next item's lane is the case's lane, also when it is less severe", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { postId } = await authored(tx);
        const caseId = await openCase(tx, "post", postId);
        await insertItem(tx, { intakeId: await csamNotice(tx), caseId, targetId: postId, lane: 0 });
        expect(await readCase(tx, caseId)).toMatchObject({ lane: 0, intake_seq: 1 });
        // As a final decision leaves a case it does not close: everything so far answered.
        await tx.execute(sql`update cases set answered_seq = intake_seq, oldest_open_at = null where id = ${caseId}::uuid`);
        await insertItem(tx, { intakeId: await ruleReport(tx, (await profile(tx)).id), caseId, targetId: postId, lane: 2 });
        const after = await readCase(tx, caseId);
        expect(after).toMatchObject({ lane: 2, intake_seq: 2, answered_seq: 1 });
        expect(after.oldest_open_at).not.toBeNull();
      });
    });
  });

  describe("the forced columns", () => {
    test("an item's times, answer, release, reporter, ground and mail state are the database's, whatever the insert supplies", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const reporter = await profile(tx);
        const caseId = await openCase(tx, "post", postId);
        const supplied: Record<string, SQL> = {
          seq: sql`99`,
          created_at: sql`'2001-01-01T00:00:00Z'`,
          answered_by: sql`${randomUUID()}::uuid`,
          outcome_sent_at: sql`now()`,
          shown_outcome: sql`'no_violation'`,
          revision_pending_at: sql`now()`,
          revised_sent_at: sql`now()`,
          erased_at: sql`now()`,
          reporter_account_id: sql`${randomUUID()}::uuid`,
          alleges_illegal: sql`true`,
          suspect: sql`true`,
          outcome_mail: sql`'sent'`,
        };
        const item = await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id), caseId, targetId: postId, outcome: "no_violation", namedHandle: "not_for_a_post", extra: supplied });
        expect(item).toMatchObject({
          seq: 1,
          answered_by: null,
          outcome: null,
          outcome_sent_at: null,
          shown_outcome: null,
          revision_pending_at: null,
          revised_sent_at: null,
          erased_at: null,
          reporter_account_id: reporter.id,
          alleges_illegal: false,
          suspect: false,
          outcome_mail: "none",
          named_handle: null,
        });
        const [age] = await tx.execute<{ at_start: boolean }>(sql`select (created_at = now()) as at_start from intake_items where id = ${item.id}::uuid`);
        expect(age!.at_start).toBe(true);
      });
    });

    test("suspect is forced from the intake: the CSAM path and a finding citing R2, and nothing else; never null", async () => {
      await rolledBack(apiDb, async (tx) => {
        const staff = await profile(tx);
        const reporter = await profile(tx);
        const cases: [string, () => Promise<string>, boolean, SQL][] = [
          ["a notice on the CSAM path", () => csamNotice(tx), true, sql`false`],
          ["a finding citing R2", () => findingBy(tx, staff.id, "R2", MINORS), true, sql`false`],
          ["a finding citing R5", () => findingBy(tx, staff.id, "R5"), false, sql`true`],
          ["a rule report", () => ruleReport(tx, reporter.id, "R1"), false, sql`true`],
          // A notice on the law alone has no rule: the comparison with R2 is then null, and suspect must still be false.
          ["a notice of illegality without a rule", () => illegalNotice(tx, reporter.id), false, sql`true`],
        ];
        for (const [label, intake, suspect, supplied] of cases) {
          const { postId } = await authored(tx);
          const item = await insertItem(tx, { intakeId: await intake(), caseId: await openCase(tx, "post", postId), targetId: postId, lane: 0, extra: { suspect: supplied } });
          expect(item.suspect, label).toBe(suspect);
        }
      });
    });

    test("alleges_illegal and the outcome's mail state are copied from the intake: pending for a contact, or for a reporter who alleged illegality", async () => {
      await rolledBack(apiDb, async (tx) => {
        const reporter = await profile(tx);
        const withContact = () => insertIntake(tx, { channel: "signed_out", contactId: randomUUID(), lookupHash: hex64(), allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true });
        const cases: [string, () => Promise<string>, { alleges_illegal: boolean; outcome_mail: string; reporter_account_id: string | null }][] = [
          ["a rule report", () => ruleReport(tx, reporter.id), { alleges_illegal: false, outcome_mail: "none", reporter_account_id: reporter.id }],
          ["a signed-in notice of illegality", () => illegalNotice(tx, reporter.id), { alleges_illegal: true, outcome_mail: "pending", reporter_account_id: reporter.id }],
          ["a signed-out notice with a contact", withContact, { alleges_illegal: true, outcome_mail: "pending", reporter_account_id: null }],
          ["a notice on the CSAM path, which has nobody to mail", () => csamNotice(tx), { alleges_illegal: true, outcome_mail: "none", reporter_account_id: null }],
        ];
        for (const [label, intake, expected] of cases) {
          const { postId } = await authored(tx);
          const item = await insertItem(tx, { intakeId: await intake(), caseId: await openCase(tx, "post", postId), targetId: postId });
          expect(item, label).toMatchObject(expected);
        }
      });
    });

    test("an account item keeps the handle it was named by; a post item never has one; an account item without one is refused", async () => {
      await rolledBack(apiDb, async (tx) => {
        const account = await profile(tx);
        const reporter = await profile(tx);
        const caseId = await openCase(tx, "account", account.id);
        const kept = await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id), caseId, targetType: "account", targetId: account.id, namedHandle: "an_old_handle" });
        expect(kept.named_handle).toBe("an_old_handle");
        const intakeId = await illegalNotice(tx, reporter.id);
        const err = await within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetType: "account", targetId: account.id, namedHandle: null }));
        expect(err).toMatchObject({ code: "23514", message: expect.stringMatching(/intake_items_named_handle/) });
      });
    });

    test("an item of an intake that does not exist is refused as a missing reference", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const caseId = await openCase(tx, "post", postId);
        const err = await within(tx, (sp) => insertItem(sp, { intakeId: randomUUID(), caseId, targetId: postId }));
        expect(err?.code).toBe("23503");
      });
    });
  });

  describe("an item without a case", () => {
    test("is stored only as 'not available', with no number", async () => {
      await rolledBack(apiDb, async (tx) => {
        const reporter = await profile(tx);
        const intakeId = await ruleReport(tx, reporter.id);
        const dead = await insertItem(tx, { intakeId, caseId: null, targetId: randomUUID(), outcome: "not_available", extra: { seq: sql`5` } });
        expect(dead).toMatchObject({ case_id: null, seq: null, outcome: "not_available", answered_by: null });
        // Any other outcome, and no outcome, are refused: an item is in a case or answered at once.
        for (const [position, outcome] of [
          [2, null],
          [3, "no_violation"],
          [4, "restricted_rule"],
        ] as const) {
          const err = await within(tx, (sp) => insertItem(sp, { intakeId, caseId: null, targetId: randomUUID(), position, outcome }));
          expect(err, String(outcome)).toMatchObject({ code: "23514", message: expect.stringMatching(/intake_items_case/) });
        }
      });
    });

    test("the check itself refuses it too: with the trigger switched off, a row with no case and no outcome, or another outcome, is not stored", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const intakeId = await ruleReport(tx, (await profile(tx)).id);
        // Only the table's owner can do this, and the rollback switches the trigger on again.
        await tx.execute(sql`alter table public.intake_items disable trigger intake_items_attach`);
        const insert = (position: number, outcome: SQL) =>
          within(tx, (sp) =>
            sp.execute(sql`insert into intake_items (intake_id, target_type, target_id, position, lane, created_at, outcome) values (${intakeId}::uuid, 'post', ${randomUUID()}::uuid, ${position}, 2, now(), ${outcome})`),
          );
        // The check's own words: a null outcome is no longer a null expression, which a CHECK would let through.
        const refusedByCheck = expect.objectContaining({ code: "23514", message: expect.stringMatching(/violates check constraint "intake_items_case"/) });
        expect(await insert(1, sql`null`)).toEqual(refusedByCheck);
        expect(await insert(2, sql`'no_violation'`)).toEqual(refusedByCheck);
        expect(await insert(3, sql`'not_available'`)).toBeNull();
      });
    });

    test("an item in a case never arrives answered", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const item = await insertItem(tx, { intakeId: await ruleReport(tx, (await profile(tx)).id), caseId: await openCase(tx, "post", postId), targetId: postId, outcome: "not_available" });
        expect(item.outcome).toBeNull();
      });
    });
  });

  describe("one open case a target, under concurrency", () => {
    test("two first reports of one target merge into one case", async () => {
      const { author, postId } = await authored(apiDb);
      const reporters = [await profile(apiDb), await profile(apiDb)];
      const marker = newMarker();
      const hold = gate();
      const inserted = gate();
      // The first report has opened the case and waits before its item; the second one's case insert waits for it.
      const first = withLockTimeout(apiDb, async (tx) => {
        const intakeId = await ruleReport(tx, reporters[0]!.id);
        const caseId = await openCase(tx, "post", postId);
        inserted.open();
        await hold.opened;
        return insertItem(tx, { intakeId, caseId, targetId: postId });
      });
      let second: Promise<unknown> = Promise.resolve();
      try {
        await Promise.race([inserted.opened, first]);
        const racing = withLockTimeout(apiDb, async (tx) => {
          const intakeId = await ruleReport(tx, reporters[1]!.id);
          await tx.execute(sql`insert ${sql.raw(`/* ${marker} */`)} into cases (target_type, target_id) values ('post', ${postId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
          // A statement of its own: it sees the case the first report committed while the insert waited.
          const caseId = await openCase(tx, "post", postId);
          return insertItem(tx, { intakeId, caseId, targetId: postId });
        });
        second = racing;
        await untilBlocked(apiDb, marker);
        hold.open();
        const items = await Promise.all([first, racing]);
        expect(items[0].case_id).toBe(items[1].case_id);
        expect(items.map((item) => item.seq)).toEqual([1, 2]);
        const cases = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from cases where target_type = 'post' and target_id = ${postId}::uuid`);
        expect(cases[0]!.n).toBe(1);
      } finally {
        // Both transactions end before the rows go, whatever failed above.
        hold.open();
        await Promise.allSettled([first, second]);
        await removeFixtures(migrateDb, [author.id, ...reporters.map((reporter) => reporter.id)]);
      }
    }, 60_000);

    test("an item that names a case of another target is refused as a serialization failure, the code its transaction retries on", async () => {
      await rolledBack(apiDb, async (tx) => {
        const one = await authored(tx);
        const other = await authored(tx);
        const caseId = await openCase(tx, "post", one.postId);
        const intakeId = await ruleReport(tx, (await profile(tx)).id);
        const wrongPost = await within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetId: other.postId }));
        expect(wrongPost).toEqual({ code: "40001", message: "case_closed" });
        const wrongKind = await within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetType: "account", targetId: one.postId, namedHandle: "x" }));
        expect(wrongKind).toEqual({ code: "40001", message: "case_closed" });
        expect((await readCase(tx, caseId)).intake_seq).toBe(0);
      });
    });

    test("an item that names a closed case is refused the same way, and the retry opens a new case", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { postId } = await authored(tx);
        const reporter = await profile(tx);
        const closed = await openCase(tx, "post", postId);
        // Read by the report, then closed by a decision before the report's item arrives.
        await tx.execute(sql`update cases set closed_at = now() where id = ${closed}::uuid`);
        const intakeId = await ruleReport(tx, reporter.id);
        expect(await within(tx, (sp) => insertItem(sp, { intakeId, caseId: closed, targetId: postId }))).toEqual({ code: "40001", message: "case_closed" });
        const reopened = await openCase(tx, "post", postId);
        expect(reopened).not.toBe(closed);
        expect(await insertItem(tx, { intakeId, caseId: reopened, targetId: postId })).toMatchObject({ case_id: reopened, seq: 1 });
        expect((await readCase(tx, closed)).intake_seq).toBe(0);
      });
    });

    test("an item waits for a transaction that holds its case, and attaches once it ends", async () => {
      const { author, postId } = await authored(apiDb);
      const reporter = await profile(apiDb);
      const marker = newMarker();
      const hold = gate();
      const held = gate();
      let holder: Promise<void> = Promise.resolve();
      let attaching: Promise<unknown> = Promise.resolve();
      try {
        const caseId = await openCase(apiDb, "post", postId);
        const intakeId = await ruleReport(apiDb, reporter.id);
        // What a decision holds while it decides: the case's row. Rolled back, so the case stays open.
        holder = rolledBack(migrateDb, async (tx) => {
          await tx.execute(sql`update cases set closed_at = now() where id = ${caseId}::uuid`);
          held.open();
          await hold.opened;
        });
        await Promise.race([held.opened, holder]);
        const waiting = withLockTimeout(apiDb, (tx) => insertItem(tx, { intakeId, caseId, targetId: postId, marker }));
        attaching = waiting;
        await untilBlocked(apiDb, marker);
        hold.open();
        await holder;
        expect(await waiting).toMatchObject({ case_id: caseId, seq: 1 });
      } finally {
        // Both transactions end before the rows go, whatever failed above.
        hold.open();
        await Promise.allSettled([holder, attaching]);
        await removeFixtures(migrateDb, [author.id, reporter.id]);
      }
    }, 60_000);

    test("notices that name the same two posts, each taking its cases in the targets' order, all land without a deadlock", async () => {
      const authors = [await authored(apiDb), await authored(apiDb)];
      const posts = authors.map((a) => a.postId).sort();
      try {
        const notice = () =>
          withLockTimeout(apiDb, async (tx) => {
            const intakeId = await insertIntake(tx, { channel: "signed_out", lookupHash: hex64(), ruleId: "R3" });
            // First every case, in (target_type, target_id) order; then the items.
            const caseIds = [await openCase(tx, "post", posts[0]!), await openCase(tx, "post", posts[1]!)];
            await insertItem(tx, { intakeId, caseId: caseIds[0]!, targetId: posts[0]!, position: 1, lane: 1 });
            await insertItem(tx, { intakeId, caseId: caseIds[1]!, targetId: posts[1]!, position: 2, lane: 1 });
          });
        // Settled, not raced: every notice has ended before anything is asserted or removed.
        const landed = await Promise.allSettled([notice(), notice(), notice(), notice()]);
        expect(landed.map((outcome) => (outcome.status === "rejected" ? String(outcome.reason) : outcome.status))).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
        for (const postId of posts) {
          const rows = await apiDb.execute<{ cases: number; items: number; top: number }>(
            sql`select count(distinct c.id)::int as cases, count(i.id)::int as items, max(i.seq)::int as top from cases c join intake_items i on i.case_id = c.id where c.target_type = 'post' and c.target_id = ${postId}::uuid`,
          );
          expect({ ...rows[0]! }).toEqual({ cases: 1, items: 4, top: 4 });
        }
      } finally {
        await removeFixtures(migrateDb, authors.map((a) => a.author.id));
      }
    }, 60_000);

    test("one item per signed-in reporter, case and ground; signed-out notifiers are never merged; a notice names a target once", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await authored(tx);
        const [ada, bob] = [await profile(tx), await profile(tx)];
        const caseId = await openCase(tx, "post", postId);
        const report = (intakeId: string, position = 1) => within(tx, (sp) => insertItem(sp, { intakeId, caseId, targetId: postId, position }));

        expect(await report(await ruleReport(tx, ada.id))).toBeNull();
        // A second rule report by the same person on the same case, under another rule or not.
        expect(await report(await ruleReport(tx, ada.id, "R3"))).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_reporter_once/) });
        // The same person's later notice that the post is illegal is another ground, and stands beside the report.
        expect(await report(await illegalNotice(tx, ada.id))).toBeNull();
        expect(await report(await illegalNotice(tx, ada.id))).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_reporter_once/) });
        expect(await report(await ruleReport(tx, bob.id))).toBeNull();
        // Signed out there is no account to merge by: every notice keeps its own item.
        for (let i = 0; i < 2; i++) expect(await report(await insertIntake(tx, { channel: "signed_out", lookupHash: hex64(), ruleId: "R1" }))).toBeNull();

        const twice = await insertIntake(tx, { channel: "signed_out", lookupHash: hex64(), ruleId: "R1" });
        expect(await report(twice, 1)).toBeNull();
        expect(await report(twice, 2)).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_target_once/) });
        expect((await readCase(tx, caseId)).intake_seq).toBe(6);
      });
    });
  });

  describe("re-examinations", () => {
    /**
     * Inside a migrator transaction: a signed-in report about a post (or, with a handle, an account), its open case and
     * its item, with a staff profile for the decisions the tests fabricate.
     */
    async function reported(tx: DbTx, options: { suspect?: boolean; handle?: string } = {}) {
      const staff = await profile(tx);
      const author = await profile(tx);
      const targetType = options.handle ? ("account" as const) : ("post" as const);
      const targetId = options.handle ? author.id : await newPostRow(tx, author.id);
      const intakeId = options.suspect ? await csamNotice(tx) : await ruleReport(tx, (await profile(tx)).id);
      const caseId = await openCase(tx, targetType, targetId);
      const item = await insertItem(tx, { intakeId, caseId, targetType, targetId, position: 3, lane: options.suspect ? 0 : 1, namedHandle: options.handle ?? null });
      return { staff, intakeId, caseId, targetType, targetId, item };
    }
    /** A re-examination of the item, supplying a wrong target, position and lane on purpose. */
    const reexamine = (tx: DbTx, r: { intakeId: string; caseId: string }, item: ItemRow, extra: Record<string, SQL> = {}) =>
      insertItem(tx, { intakeId: r.intakeId, caseId: r.caseId, targetType: "account", targetId: randomUUID(), position: 9, lane: 0, namedHandle: "supplied", reexaminesItemId: item.id, extra });

    test("a released no-action item is re-examined within its window, with the original's target, position, lane and handle whatever was supplied", async () => {
      await rolledBack(migrateDb, async (tx) => {
        for (const outcome of ["no_violation", "not_evident"] as const) {
          const r = await reported(tx);
          await answerItem(tx, r.item, r.staff.id, { outcome });
          const again = await reexamine(tx, r, r.item);
          expect(again, outcome).toMatchObject({ target_type: "post", target_id: r.targetId, position: 3, lane: 1, named_handle: null, reexamines_item_id: r.item.id, case_id: r.caseId, seq: 2, suspect: false, outcome: null });
        }
        const account = await reported(tx, { handle: "as_named" });
        await answerItem(tx, account.item, account.staff.id);
        expect(await reexamine(tx, account, account.item)).toMatchObject({ target_type: "account", target_id: account.targetId, named_handle: "as_named", position: 3, lane: 1 });
      });
    });

    test("it is refused for an unanswered item, a restricted one, an unreleased one, one past its window, an item of another intake and an erased intake", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const refused = async (label: string, prepare: (r: Awaited<ReturnType<typeof reported>>) => Promise<{ intakeId?: string } | void>) => {
          const r = await reported(tx);
          const other = await prepare(r);
          const err = await within(tx, (sp) => reexamine(sp, { intakeId: other?.intakeId ?? r.intakeId, caseId: r.caseId }, r.item));
          expect(err, label).toEqual({ code: "P0001", message: "reexamination_not_open" });
        };
        await refused("unanswered", async () => undefined);
        await refused("restricted", async (r) => void (await answerItem(tx, r.item, r.staff.id, { outcome: "restricted_rule" })));
        await refused("answered, not yet released", async (r) => void (await answerItem(tx, r.item, r.staff.id, { released: null })));
        await refused("released seven months ago", async (r) => void (await answerItem(tx, r.item, r.staff.id, { released: sql`now() - interval '7 months'` })));
        await refused("an item of another intake", async (r) => {
          await answerItem(tx, r.item, r.staff.id);
          return { intakeId: await ruleReport(tx, (await profile(tx)).id) };
        });
        await refused("an erased intake", async (r) => {
          await answerItem(tx, r.item, r.staff.id);
          await tx.execute(sql`update intakes set erased_at = now(), explanation = null, cited_law = null where id = ${r.intakeId}::uuid`);
        });
        // The window is the appeal's, six calendar months from the release: five months on it is still open.
        const r = await reported(tx);
        await answerItem(tx, r.item, r.staff.id, { released: sql`now() - interval '5 months'` });
        expect(await within(tx, (sp) => reexamine(sp, r, r.item))).toBeNull();
        // An item that does not exist cannot be re-examined either.
        const err = await within(tx, (sp) => insertItem(sp, { intakeId: r.intakeId, caseId: r.caseId, targetId: r.targetId, reexaminesItemId: randomUUID() }));
        expect(err).toEqual({ code: "P0001", message: "reexamination_not_open" });
      });
    });

    test("an item is re-examined once", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const r = await reported(tx);
        await answerItem(tx, r.item, r.staff.id);
        await reexamine(tx, r, r.item);
        const err = await within(tx, (sp) => reexamine(sp, r, r.item));
        expect(err).toMatchObject({ code: "23505", message: expect.stringMatching(/intake_items_reexamines_once/) });
      });
    });

    test("a re-examination is not re-examined, unless it is about a post, is not suspect and was answered while nobody could open the images", async () => {
      await rolledBack(migrateDb, async (tx) => {
        // Answered by a decision that saw the images: the one request is spent.
        const seen = await reported(tx);
        await answerItem(tx, seen.item, seen.staff.id);
        const seenAgain = await reexamine(tx, seen, seen.item);
        await answerItem(tx, seenAgain, seen.staff.id, { unseen: false });
        expect(await within(tx, (sp) => reexamine(sp, seen, seenAgain))).toEqual({ code: "P0001", message: "reexamination_not_open" });

        // Answered unseen: it can be asked again, and again while the answers stay unseen.
        const unseen = await reported(tx);
        await answerItem(tx, unseen.item, unseen.staff.id, { unseen: true });
        const second = await reexamine(tx, unseen, unseen.item);
        await answerItem(tx, second, unseen.staff.id, { unseen: true });
        const third = await reexamine(tx, unseen, second);
        expect(third).toMatchObject({ reexamines_item_id: second.id, target_id: unseen.targetId, position: 3, lane: 1, seq: 3 });
        await answerItem(tx, third, unseen.staff.id, { unseen: true, outcome: "not_evident" });
        expect(await within(tx, (sp) => reexamine(sp, unseen, third))).toBeNull();

        // A suspect item's answer is never "unseen" in this sense: its re-examination is final.
        const suspect = await reported(tx, { suspect: true });
        await answerItem(tx, suspect.item, suspect.staff.id, { unseen: true });
        const suspectAgain = await reexamine(tx, suspect, suspect.item);
        expect(suspectAgain).toMatchObject({ suspect: true, lane: 0 });
        await answerItem(tx, suspectAgain, suspect.staff.id, { unseen: true });
        expect(await within(tx, (sp) => reexamine(sp, suspect, suspectAgain))).toEqual({ code: "P0001", message: "reexamination_not_open" });

        // Nor an account's: its answer concerns the display name and bio, which staff read.
        const account = await reported(tx, { handle: "named" });
        await answerItem(tx, account.item, account.staff.id, { unseen: true });
        const accountAgain = await reexamine(tx, account, account.item);
        await answerItem(tx, accountAgain, account.staff.id, { unseen: true });
        expect(await within(tx, (sp) => reexamine(sp, account, accountAgain))).toEqual({ code: "P0001", message: "reexamination_not_open" });
      });
    });

    test("only a re-examination carries a statement, and only with its salt and the digest of both; the same holds for an appeal's statement", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const statement = "I think this was judged too quickly.";
        const salt = hex64();
        const digest = await textDigest(salt, statement);
        const stated = (held: string | null): Record<string, SQL> => ({ statement: sql`${statement}`, statement_salt: sql`${salt}`, statement_digest: held === null ? sql`null` : sql`${held}` });
        const refusedBy = (name: string) => expect.objectContaining({ code: "23514", message: expect.stringMatching(new RegExp(`violates check constraint "${name}"`)) });

        const r = await reported(tx);
        await answerItem(tx, r.item, r.staff.id);
        // A wrong digest, and no digest at all: a null comparison must not let the statement through.
        expect(await within(tx, (sp) => reexamine(sp, r, r.item, stated(hex64())))).toEqual(refusedBy("intake_items_statement"));
        expect(await within(tx, (sp) => reexamine(sp, r, r.item, stated(null)))).toEqual(refusedBy("intake_items_statement"));
        expect(await reexamine(tx, r, r.item, stated(digest))).toMatchObject({ statement });

        // An ordinary item has none, with a digest or without.
        const plain = await reported(tx);
        for (const held of [digest, null]) {
          const err = await within(tx, (sp) => insertItem(sp, { intakeId: plain.intakeId, caseId: plain.caseId, targetId: plain.targetId, position: 4, extra: stated(held) }));
          expect(err, String(held)).toEqual(refusedBy("intake_items_statement"));
        }

        // An appeal's statement is held the same way. Its row names a decision, which only the fixture can write here.
        const decisionId = await fabricateDecision(tx, { caseId: plain.caseId, targetType: "post", targetId: plain.targetId, staffId: plain.staff.id, outcome: "restricted" });
        const appeal = (held: string | null) =>
          within(tx, (sp) =>
            sp.execute(
              sql`insert into appeals (decision_id, appellant_account_id, statement, statement_salt, statement_digest, filed_at) values (${decisionId}::uuid, ${plain.staff.id}::uuid, ${statement}, ${salt}, ${held}, now())`,
            ),
          );
        expect(await appeal(null)).toEqual(refusedBy("appeals_statement"));
        expect(await appeal(hex64())).toEqual(refusedBy("appeals_statement"));
        expect(await appeal(digest)).toBeNull();
      });
    });
  });

  describe("a suspect item about a post that quotes another is a report about both", () => {
    /** A post, and a post by someone else that quotes it. */
    async function quoting(db: Db | DbTx) {
      const quoted = await authored(db);
      const quoter = await authored(db, { quoteOfId: quoted.postId });
      return { quotedId: quoted.postId, quotingId: quoter.postId };
    }

    test("alone it is refused at commit, and nothing of the transaction is stored", async () => {
      let made: { quotedId: string; quotingId: string } | undefined;
      // Everything in the one transaction, the two posts included: its commit runs the rule and fails.
      const err = await pgError(
        withLockTimeout(apiDb, async (tx) => {
          made = await quoting(tx);
          const item = await insertItem(tx, { intakeId: await csamNotice(tx), caseId: await openCase(tx, "post", made.quotingId), targetId: made.quotingId, lane: 0 });
          // The insert itself passes: the rule is held when the transaction commits.
          expect(item.suspect).toBe(true);
        }),
      );
      expect(err).toEqual({ code: "P0001", message: "quote_item_missing" });
      const [left] = await apiDb.execute<{ posts: number; cases: number }>(sql`
        select (select count(*)::int from posts where id in (${made!.quotedId}::uuid, ${made!.quotingId}::uuid)) as posts,
               (select count(*)::int from cases where target_id in (${made!.quotedId}::uuid, ${made!.quotingId}::uuid)) as cases`);
      expect({ ...left! }).toEqual({ posts: 0, cases: 0 });
    });

    test("with an item on the quoted post, added at the origin's position plus 10 or named by the sender, it passes", async () => {
      await rolledBack(apiDb, async (tx) => {
        const added = await quoting(tx);
        expect(
          await atCommit(tx, async (sp) => {
            const intakeId = await csamNotice(sp);
            // The cases in their targets' order, then the items.
            const caseOf: Record<string, string> = {};
            for (const id of [added.quotingId, added.quotedId].sort()) caseOf[id] = await openCase(sp, "post", id);
            await insertItem(sp, { intakeId, caseId: caseOf[added.quotingId]!, targetId: added.quotingId, position: 4, lane: 0 });
            await insertItem(sp, { intakeId, caseId: caseOf[added.quotedId]!, targetId: added.quotedId, position: 14, lane: 0 });
          }),
        ).toBeNull();

        const named = await quoting(tx);
        expect(
          await atCommit(tx, async (sp) => {
            const intakeId = await csamNotice(sp);
            await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", named.quotedId), targetId: named.quotedId, position: 1, lane: 0 });
            await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", named.quotingId), targetId: named.quotingId, position: 2, lane: 0 });
          }),
        ).toBeNull();
      });
    });

    test("an item that is not suspect, a post that quotes nothing and a link that names no row need no second item", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { quotingId } = await quoting(tx);
        const reporter = await profile(tx);
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await ruleReport(sp, reporter.id), caseId: await openCase(sp, "post", quotingId), targetId: quotingId })))).toBeNull();
        const plain = await authored(tx);
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await csamNotice(sp), caseId: await openCase(sp, "post", plain.postId), targetId: plain.postId, lane: 0 })))).toBeNull();
        // A link that names nothing live: no case, answered at once.
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await csamNotice(sp), caseId: null, targetId: randomUUID(), outcome: "not_available", lane: 0 })))).toBeNull();
      });
    });

    test("an added item without its origin is refused", async () => {
      await rolledBack(apiDb, async (tx) => {
        const reporter = await profile(tx);
        const refused = { code: "P0001", message: "quote_item_missing" };
        // No item at its position minus 10.
        const alone = await quoting(tx);
        expect(await atCommit(tx, async (sp) => void (await insertItem(sp, { intakeId: await csamNotice(sp), caseId: await openCase(sp, "post", alone.quotedId), targetId: alone.quotedId, position: 11, lane: 0 })))).toEqual(refused);

        // An origin whose post quotes another post than the item's own.
        const one = await quoting(tx);
        const stranger = await authored(tx);
        const strayed = await atCommit(tx, async (sp) => {
          const intakeId = await csamNotice(sp);
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", one.quotingId), targetId: one.quotingId, position: 1, lane: 0 });
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", one.quotedId), targetId: one.quotedId, position: 2, lane: 0 });
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", stranger.postId), targetId: stranger.postId, position: 11, lane: 0 });
        });
        expect(strayed).toEqual(refused);

        // An origin that is not suspect brings no added item.
        const ordinary = await quoting(tx);
        const notSuspect = await atCommit(tx, async (sp) => {
          const intakeId = await ruleReport(sp, reporter.id);
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", ordinary.quotingId), targetId: ordinary.quotingId, position: 1 });
          await insertItem(sp, { intakeId, caseId: await openCase(sp, "post", ordinary.quotedId), targetId: ordinary.quotedId, position: 11 });
        });
        expect(notSuspect).toEqual(refused);
      });
    });

    test("a re-examination of the origin re-examines its added item too while that is open to it, and alone otherwise", async () => {
      /** A notice about a quoting post as it stands once committed: its origin item, the added item, both in their cases. */
      async function notice(tx: DbTx) {
        // An earlier block may have left the check immediate; a notice's two items are checked together.
        await tx.execute(sql`set constraints public.intake_items_quote deferred`);
        const staff = await profile(tx);
        const { quotingId, quotedId } = await quoting(tx);
        const intakeId = await csamNotice(tx);
        const originCase = await openCase(tx, "post", quotingId);
        const addedCase = await openCase(tx, "post", quotedId);
        const origin = await insertItem(tx, { intakeId, caseId: originCase, targetId: quotingId, position: 2, lane: 0 });
        const added = await insertItem(tx, { intakeId, caseId: addedCase, targetId: quotedId, position: 12, lane: 0 });
        // The notice's own check passes here; from now on only the re-examinations' rows are pending.
        await tx.execute(sql`set constraints public.intake_items_quote immediate`);
        await answerItem(tx, origin, staff.id);
        return { staff, intakeId, originCase, addedCase, origin, added };
      }
      const again = (sp: DbTx, n: Awaited<ReturnType<typeof notice>>, item: ItemRow) =>
        insertItem(sp, { intakeId: n.intakeId, caseId: item.id === n.origin.id ? n.originCase : n.addedCase, targetId: item.target_id, lane: 0, reexaminesItemId: item.id });

      await rolledBack(migrateDb, async (tx) => {
        // The added item was answered without action and released too: both are re-examined, or neither.
        const open = await notice(tx);
        await answerItem(tx, open.added, open.staff.id);
        expect(await atCommit(tx, async (sp) => void (await again(sp, open, open.origin)))).toEqual({ code: "P0001", message: "quote_item_missing" });
        expect(
          await atCommit(tx, async (sp) => {
            await again(sp, open, open.origin);
            await again(sp, open, open.added);
          }),
        ).toBeNull();

        // The added item is still unanswered: the quoted post is frozen anyway, and the origin goes alone.
        const unanswered = await notice(tx);
        expect(await atCommit(tx, async (sp) => void (await again(sp, unanswered, unanswered.origin)))).toBeNull();

        // Answered with a restriction, not yet released, or past its window: not open to re-examination, so the origin goes alone.
        const restricted = await notice(tx);
        await answerItem(tx, restricted.added, restricted.staff.id, { outcome: "restricted_rule" });
        expect(await atCommit(tx, async (sp) => void (await again(sp, restricted, restricted.origin)))).toBeNull();
        const unreleased = await notice(tx);
        await answerItem(tx, unreleased.added, unreleased.staff.id, { released: null });
        expect(await atCommit(tx, async (sp) => void (await again(sp, unreleased, unreleased.origin)))).toBeNull();
        const late = await notice(tx);
        await answerItem(tx, late.added, late.staff.id, { released: sql`now() - interval '7 months'` });
        expect(await atCommit(tx, async (sp) => void (await again(sp, late, late.origin)))).toBeNull();

        // The added item can also be re-examined by itself: it has no added item of its own.
        const own = await notice(tx);
        await answerItem(tx, own.added, own.staff.id);
        expect(await atCommit(tx, async (sp) => void (await again(sp, own, own.added)))).toBeNull();
        // And once it has been, the origin's re-examination needs nothing more.
        expect(await atCommit(tx, async (sp) => void (await again(sp, own, own.origin)))).toBeNull();
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/moderation-fixtures.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Db, DbTx } from "@korbat/db";

/**
 * Rows for the database tests of the moderation tables (3c design, section 6.1), written as SQL the way the intake
 * transaction writes them: an insert names only what the API supplies, and the triggers of migration 0015 force the rest.
 * The helpers take a pool or a transaction, so a test chooses the role and whether anything commits. The suites share
 * one database, so a test leaves nothing behind: it runs inside a transaction that is rolled back, or, where a second
 * session must see its rows, it commits them and removes them again with removeFixtures.
 */
export type Runner = Db | DbTx;
export type TargetType = "post" | "account";

export const TC = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";
export const MINORS = "STATEMENT_CATEGORY_PROTECTION_OF_MINORS";
export const SPEECH = "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH";

/** 32 random bytes as lower-case hex: a salt, a digest's stand-in or a token's hash. */
export const hex64 = () => randomBytes(32).toString("hex");

/** A public reference as the API makes it: N- and ten base32 characters. */
export function newRef(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return `N-${Array.from(randomBytes(10), (byte) => alphabet[byte % 32]).join("")}`;
}

/** Null as SQL, any other value as a parameter. */
const orNull = (value: string | null | undefined, cast: string): SQL => (value === null || value === undefined ? sql`null` : sql`${value}::${sql.raw(cast)}`);

/** Ids as one uuid[] parameter. */
const uuids = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * A post row straight in the table: these tests need the row, not the flow and its counters. It is dated a month back.
 * The suites share one database, and others read the public Latest timeline from its newest post down and Explore's
 * 48-hour window: a visible post dated now would stand among theirs, and dozens of them push theirs off the first page.
 */
export async function newPostRow(db: Runner, authorId: string, options: { quoteOfId?: string; body?: string } = {}): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into posts (author_id, body, quote_of_id, created_at) values (${authorId}::uuid, ${options.body ?? "a post"}, ${orNull(options.quoteOfId, "uuid")}, now() - interval '30 days') returning id`,
  );
  return row!.id;
}

/**
 * A ready image of the account, on the post when one is given. The row is inserted on no post, which is the only way the
 * database takes one, and then attached with one update of post_id, position and alt text, as the media repository's
 * attach does.
 */
export async function newImageRow(db: Runner, ownerId: string, postId: string | null, position = 0): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into post_media (owner_id, status, width, height, blurhash) values (${ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL') returning id`,
  );
  if (postId) await db.execute(sql`update post_media set post_id = ${postId}::uuid, position = ${position}, alt_text = ${`image ${position + 1}`} where id = ${row!.id}::uuid`);
  return row!.id;
}

export interface IntakeInput {
  kind?: "user" | "finding";
  channel?: "signed_in" | "signed_out" | "staff";
  reporterId?: string | null;
  findingBy?: string | null;
  contactId?: string | null;
  ruleId?: string | null;
  allegesIllegal?: boolean;
  csam?: boolean;
  category?: string;
  categoryKeyword?: string | null;
  citedLaw?: string | null;
  explanation?: string | null;
  bonaFide?: boolean;
  lookupHash?: string | null;
  ref?: string;
}

/** Inserts an intake with the ground's columns, as step 4.2 of the intake transaction does, and answers its id. */
export async function insertIntake(db: Runner, input: IntakeInput): Promise<string> {
  const [row] = await db.execute<{ id: string }>(sql`
    insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
    values (${input.kind ?? "user"}::intake_kind, ${input.ref ?? newRef()}, ${orNull(input.lookupHash, "text")}, ${input.channel ?? "signed_in"}::intake_channel,
            ${orNull(input.reporterId, "uuid")}, ${orNull(input.findingBy, "uuid")}, ${orNull(input.contactId, "uuid")}, ${orNull(input.ruleId, "text")},
            ${input.allegesIllegal ?? false}, ${input.csam ?? false}, ${input.category ?? TC}, ${orNull(input.categoryKeyword, "text")},
            ${orNull(input.citedLaw, "text")}, ${orNull(input.explanation, "text")}, ${input.bonaFide ?? false})
    returning id`);
  return row!.id;
}

/** A signed-in report under a korbat rule. */
export const ruleReport = (db: Runner, reporterId: string, ruleId = "R1") => insertIntake(db, { kind: "user", channel: "signed_in", reporterId, ruleId, category: TC });

/** A signed-in notice that the target is illegal, with its explanation and good-faith statement. */
export const illegalNotice = (db: Runner, reporterId: string) =>
  insertIntake(db, { kind: "user", channel: "signed_in", reporterId, allegesIllegal: true, category: SPEECH, explanation: "It breaks the law.", bonaFide: true });

/** A notice on the path for child sexual abuse material: signed out, no account, no contact, only the token's hash. */
export const csamNotice = (db: Runner) => insertIntake(db, { kind: "user", channel: "signed_out", csam: true, allegesIllegal: true, category: MINORS, lookupHash: hex64() });

/** A moderator's own finding under a rule. */
export const findingBy = (db: Runner, staffId: string, ruleId: string, category = TC) => insertIntake(db, { kind: "finding", channel: "staff", findingBy: staffId, ruleId, category });

/**
 * The target's open case, opened when there is none: the insert that does nothing on a conflict and the read of the
 * open case, as step 4.3 of the intake transaction runs them.
 */
export async function openCase(db: Runner, targetType: TargetType, targetId: string): Promise<string> {
  await db.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [row] = await db.execute<{ id: string }>(sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  if (!row) throw new Error("the target has no open case");
  return row.id;
}

/** An item as the database stores it, with the columns these tests read. A raw read hands every time over as PostgreSQL's text. */
export interface ItemRow {
  id: string;
  intake_id: string;
  position: number;
  target_type: TargetType;
  target_id: string;
  named_handle: string | null;
  case_id: string | null;
  seq: number | null;
  lane: number;
  reporter_account_id: string | null;
  alleges_illegal: boolean;
  suspect: boolean;
  created_at: string;
  outcome: string | null;
  answered_by: string | null;
  outcome_sent_at: string | null;
  shown_outcome: string | null;
  revision_pending_at: string | null;
  revised_sent_at: string | null;
  outcome_mail: string;
  reexamines_item_id: string | null;
  statement: string | null;
  erased_at: string | null;
}

export interface ItemInput {
  intakeId: string;
  caseId: string | null;
  targetType?: TargetType;
  targetId: string;
  position?: number;
  lane?: number;
  namedHandle?: string | null;
  outcome?: string | null;
  reexaminesItemId?: string | null;
  /** Further columns and their values as SQL, for the tests that supply what the trigger forces. */
  extra?: Record<string, SQL>;
  /** A comment the statement carries, by which a test finds the session that runs it. */
  marker?: string;
}

/** Inserts one item and answers the row as the attach trigger left it. */
export async function insertItem(db: Runner, input: ItemInput): Promise<ItemRow> {
  const extra = Object.entries(input.extra ?? {});
  const names = extra.map(([name]) => sql.raw(`, ${name}`));
  const values = extra.map(([, value]) => sql`, ${value}`);
  const [row] = await db.execute<ItemRow & Record<string, unknown>>(sql`
    insert ${sql.raw(input.marker ? `/* ${input.marker} */` : "")} into intake_items (intake_id, case_id, target_type, target_id, position, lane, named_handle, outcome, reexamines_item_id${sql.join(names, sql``)})
    values (${input.intakeId}::uuid, ${orNull(input.caseId, "uuid")}, ${input.targetType ?? "post"}::moderation_target, ${input.targetId}::uuid, ${input.position ?? 1}, ${input.lane ?? 2},
            ${orNull(input.namedHandle, "text")}, ${orNull(input.outcome, "item_outcome")}, ${orNull(input.reexaminesItemId, "uuid")}${sql.join(values, sql``)})
    returning *`);
  return row!;
}

/** A case's derived columns. */
export interface CaseRow {
  id: string;
  lane: number;
  intake_seq: number;
  answered_seq: number;
  state_version: number;
  opened_at: string;
  oldest_open_at: string | null;
  last_decided_at: string | null;
  closed_at: string | null;
}

export async function readCase(db: Runner, id: string): Promise<CaseRow> {
  const [row] = await db.execute<CaseRow & Record<string, unknown>>(sql`select * from cases where id = ${id}::uuid`);
  return row!;
}

/**
 * A whole suspect intake on one target, as a notice on the CSAM path leaves it: the intake, the target's open case and
 * the item in lane 0. From its commit on, every post the case reaches is frozen.
 */
export async function suspectItemOn(db: Runner, targetType: TargetType, targetId: string, namedHandle: string | null = null): Promise<{ intakeId: string; caseId: string; item: ItemRow }> {
  const intakeId = await csamNotice(db);
  const caseId = await openCase(db, targetType, targetId);
  const item = await insertItem(db, { intakeId, caseId, targetType, targetId, lane: 0, namedHandle: targetType === "account" ? (namedHandle ?? "named") : null });
  return { intakeId, caseId, item };
}

/**
 * A final decision's row with a snapshot for it to name, written as the migrator: Task 1 of 3c has no decision engine, and
 * a re-examination can only be tested on an item that a decision answered (as an appeal's statement and a decision's own
 * checks can only be tested on a decision's row). Migration 0015 has no trigger on decisions, so nothing but the table's
 * checks looks at this row and no audit row names it: it is only ever written inside a transaction that is rolled back.
 * Task 2 replaces it by a real, confirmed decision when the triggers of migration 0016 land, which refuse a row like this
 * one.
 */
export async function fabricateDecision(
  tx: DbTx,
  input: { caseId: string; targetType: TargetType; targetId: string; staffId: string; outcome?: "restricted" | "no_violation" | "not_evident"; unseen?: boolean },
): Promise<string> {
  const [snapshot] = await tx.execute<{ id: string }>(
    sql`insert into evidence_snapshots (case_id, target_type, target_id, author_handle, digest) values (${input.caseId}::uuid, ${input.targetType}::moderation_target, ${input.targetId}::uuid, 'author', ${hex64()}) returning id`,
  );
  const restricted = (input.outcome ?? "no_violation") === "restricted";
  const [decision] = await tx.execute<{ id: string }>(sql`
    insert into decisions (case_id, kind, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                           facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, unseen, needs_admin, ended_interim)
    values (${input.caseId}::uuid, 'final', 0, 0, ${input.outcome ?? "no_violation"}::decision_outcome,
            ${restricted ? sql`'incompatible'` : sql`null`}, ${restricted ? sql`'R1'` : sql`null`}, 2, 1, ${TC}, 'report', ${snapshot!.id}::uuid, ${hex64()},
            ${restricted ? sql`${hex64()}` : sql`null`}, ${restricted ? sql`${hex64()}` : sql`null`}, ${input.staffId}::uuid, now(), pg_current_xact_id(),
            ${randomUUID().replaceAll("-", "")}, now(), false, ${input.unseen ?? false}, false, false)
    returning id`);
  return decision!.id;
}

/**
 * Marks an item answered by a fabricated decision and, unless told otherwise, released at the given time: what a final
 * decision and the daily release leave on it. Written as the migrator, inside a transaction that is rolled back, because
 * Task 1 of 3c has no decision engine and no release; Task 2 replaces it by a real decision, and by the release function,
 * when the triggers of migration 0016 land.
 */
export async function answerItem(
  tx: DbTx,
  item: ItemRow,
  staffId: string,
  options: { outcome?: "no_violation" | "not_evident" | "restricted_rule"; released?: SQL | null; unseen?: boolean } = {},
): Promise<string> {
  const outcome = options.outcome ?? "no_violation";
  const decisionId = await fabricateDecision(tx, {
    caseId: item.case_id!,
    targetType: item.target_type,
    targetId: item.target_id,
    staffId,
    outcome: outcome === "restricted_rule" ? "restricted" : outcome,
    unseen: options.unseen,
  });
  const released = options.released === undefined ? sql`now()` : (options.released ?? sql`null`);
  await tx.execute(sql`update intake_items set answered_by = ${decisionId}::uuid, outcome = ${outcome}::item_outcome, outcome_sent_at = ${released}, shown_outcome = case when ${released} is null then null else ${outcome}::item_outcome end where id = ${item.id}::uuid`);
  return decisionId;
}

/** Whether the post is frozen, as the role of the runner reads it. */
export async function postFrozen(db: Runner, postId: string): Promise<boolean> {
  const [row] = await db.execute<{ frozen: boolean }>(sql`select public.post_frozen(${postId}::uuid) as frozen`);
  return row!.frozen;
}

/**
 * Removes, as the migrator, everything a test committed about these profiles. Only a test whose second session must see
 * its rows commits them, and it calls this in a `finally`. The order is the one the keep trigger and the foreign keys
 * ask for: the items first (an unanswered suspect item freezes every image its case reaches, and the database then keeps
 * those rows against every delete); the holds released and then deleted (a release takes the image's hold_until back; a
 * delete of the hold's row would not); snapshots, texts and access rows; the cases; the intakes of the items and of
 * these reporters and finders; then the image rows, the posts and the profiles.
 */
export async function removeFixtures(migrateDb: Db, profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const profiles = uuids(profileIds);
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`
      select c.id from cases c
       where (c.target_type = 'account' and c.target_id = any(${profiles}))
          or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = any(${profiles})))`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.reporter_id = any(${profiles}) or n.finding_by = any(${profiles})`);
    const intakeIds = uuids(intakes.map((row) => row.id));
    await tx.execute(sql`delete from intake_items where case_id = any(${caseIds}) or intake_id = any(${intakeIds})`);
    await tx.execute(sql`update media_holds set released_at = now() where case_id = any(${caseIds}) and released_at is null`);
    await tx.execute(sql`delete from media_holds where case_id = any(${caseIds})`);
    await tx.execute(sql`delete from evidence_snapshots where case_id = any(${caseIds})`);
    await tx.execute(sql`delete from staff_texts where case_id = any(${caseIds})`);
    await tx.execute(sql`delete from case_access_log where case_id = any(${caseIds})`);
    await tx.execute(sql`delete from cases where id = any(${caseIds})`);
    await tx.execute(sql`delete from intakes where id = any(${intakeIds})`);
    await tx.execute(sql`delete from post_media where owner_id = any(${profiles})`);
    await tx.execute(sql`delete from posts where author_id = any(${profiles})`);
    await tx.execute(sql`delete from profiles where id = any(${profiles})`);
  });
}

/** How many rows each table that these suites write holds. A suite reads it before its first test and after its last. */
export async function rowCounts(db: Runner): Promise<Record<string, number>> {
  const tables = ["cases", "intakes", "intake_items", "media_holds", "evidence_snapshots", "staff_texts", "case_access_log", "decisions", "decision_actions", "seal_posts", "appeals", "post_media", "posts", "profiles"];
  const columns = tables.map((table) => `(select count(*)::int from public.${table}) as ${table}`).join(", ");
  const [row] = await db.execute<Record<string, number>>(sql.raw(`select ${columns}`));
  return { ...row! };
}

/** A marker for one statement of one test: a word that no other statement holds. */
export const newMarker = () => `race_${randomBytes(6).toString("hex")}`;

/**
 * Resolves once a session is waiting for a lock while it runs a statement that carries the marker. A two-session test
 * waits for this instead of sleeping, so a loaded machine cannot make it read "did not wait" too early. The pool must be
 * of the waiting session's role: a role sees only its own sessions' statements.
 */
export async function untilBlocked(db: Db, marker: string, timeoutMs = 20_000): Promise<void> {
  const pattern = `%${marker}%`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like ${pattern}`,
    );
    if (row!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no session came to wait for a lock with the statement marked ${marker}`);
}

/** A promise with its resolver, for a transaction that stays open until the test lets it end. */
export function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}
```

### Create `apps/api/test/integration/moderation-freeze.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createMediaRepo } from "../../src/media/repo";
import {
  gate,
  illegalNotice,
  insertItem,
  newImageRow,
  newMarker,
  newPostRow,
  openCase,
  postFrozen,
  removeFixtures,
  rowCounts,
  ruleReport,
  suspectItemOn,
  untilBlocked,
  type TargetType,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements, each a round trip, and several hold a transaction open across them: on a
// loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The freeze of the path for suspected child sexual abuse material (3c design, section 6.1) against the real database, as
 * far as it holds without a decision: the predicate, gate K (the trigger post_media_keep, which keeps every image row of
 * a frozen post and every held row against every delete, and post_media_guard and post_media_insert, which keep an image
 * on its post), and the holds' trigger. The statements the later flows will issue are written here as SQL. They run as
 * korbat_api unless a test says otherwise; a released hold exists only through code of a later migration, so the tests
 * that need one write it as the migrator. A test with one session runs inside a transaction that is rolled back; a test
 * with two sessions has to commit, and removes what it committed in a `finally`. The file's last test holds it to
 * leaving nothing behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the freeze, the keep trigger and the holds", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 6 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 3 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  const profile = (db: Db | DbTx) => newProfile(db as Db);
  /** An author with a post that carries this many images. */
  async function imagePost(db: Db | DbTx, images = 2, authorId?: string) {
    const ownerId = authorId ?? (await profile(db)).id;
    const postId = await newPostRow(db, ownerId);
    const mediaIds: string[] = [];
    for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(db, ownerId, postId, position));
    return { ownerId, postId, mediaIds };
  }
  const uuids = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
  /** Which of these image rows still exist. */
  async function existing(db: Db | DbTx, ids: readonly string[]): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`);
    return rows.map((row) => row.id);
  }
  const ids = (rows: Iterable<{ id: string }>) => [...rows].map((row) => row.id).sort();
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  /** A transaction at the given isolation level, always rolled back, with the lock timeout every test transaction has. */
  async function rolledBackAt(db: Db, isolationLevel: "repeatable read" | "serializable", fn: (tx: DbTx) => Promise<void>): Promise<void> {
    const rollback = new Error("rolled back on purpose");
    const outcome = await db
      .transaction(
        async (tx) => {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await fn(tx);
          throw rollback;
        },
        { isolationLevel },
      )
      .then(
        () => null,
        (err: unknown) => err,
      );
    if (outcome !== rollback) throw outcome;
  }
  /** A case's evidence hold on an image, as the API role places it. */
  const hold = (db: Db | DbTx, mediaId: string, caseId: string, until: SQL = sql`null`) =>
    db.execute<{ id: number }>(sql`insert into media_holds (media_id, case_id, until) values (${mediaId}::uuid, ${caseId}::uuid, ${until}) returning id`);
  const holdUntil = async (db: Db | DbTx, mediaId: string) => (await db.execute<{ until: string | null }>(sql`select hold_until::text as until from post_media where id = ${mediaId}::uuid`))[0]!.until;

  /** The two forms a delete of image rows takes, by post or by owner: in id order under row locks, and plain. */
  const DELETE = {
    ordered: (column: "post_id" | "owner_id", id: string, marker = "") =>
      sql`delete ${sql.raw(marker ? `/* ${marker} */` : "")} from post_media where id in (select id from post_media where ${sql.raw(column)} = ${id}::uuid order by id for update) returning id`,
    plain: (column: "post_id" | "owner_id", id: string, marker = "") => sql`delete ${sql.raw(marker ? `/* ${marker} */` : "")} from post_media where ${sql.raw(column)} = ${id}::uuid returning id`,
  };
  /** An intake's lock statement: every image row of the posts and every attached row of the owners, in one id order. */
  const lockImages = (tx: DbTx, posts: readonly string[], owners: readonly string[], marker = "") =>
    tx.execute<{ id: string }>(
      sql`select ${sql.raw(marker ? `/* ${marker} */` : "")} m.id from post_media m join posts p on p.id = m.post_id where m.post_id = any(${uuids(posts)}) or m.owner_id = any(${uuids(owners)}) order by m.id for key share of m`,
    );

  describe("the predicate, without a decision", () => {
    test("a post nobody reported is not frozen, nor one reported on another ground, nor a post that does not exist", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId } = await imagePost(tx, 1);
        expect(await postFrozen(tx, postId)).toBe(false);
        const reporter = await profile(tx);
        const caseId = await openCase(tx, "post", postId);
        await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id, "R5"), caseId, targetId: postId, lane: 0 });
        // A notice on the law alone has no rule: its item's suspect is false, never null, and the predicate stays false.
        const legal = await insertItem(tx, { intakeId: await illegalNotice(tx, reporter.id), caseId, targetId: postId, lane: 1 });
        expect(legal.suspect).toBe(false);
        expect(await postFrozen(tx, postId)).toBe(false);
        expect(await postFrozen(tx, randomUUID())).toBe(false);
      });
    });

    test("an unanswered suspect item about a post freezes that post and no other", async () => {
      await rolledBack(apiDb, async (tx) => {
        const one = await imagePost(tx, 1);
        const other = await imagePost(tx, 1, one.ownerId);
        await suspectItemOn(tx, "post", one.postId);
        expect([await postFrozen(tx, one.postId), await postFrozen(tx, other.postId)]).toEqual([true, false]);
      });
    });

    test("one about an account freezes every post of the account, a deleted one and a later one included, and nobody else's", async () => {
      await rolledBack(apiDb, async (tx) => {
        const live = await imagePost(tx, 1);
        const deleted = await imagePost(tx, 1, live.ownerId);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
        const stranger = await imagePost(tx, 1);
        await suspectItemOn(tx, "account", live.ownerId);
        const later = await imagePost(tx, 1, live.ownerId);
        const frozen = [];
        for (const p of [live, deleted, later, stranger]) frozen.push(await postFrozen(tx, p.postId));
        expect(frozen).toEqual([true, true, true, false]);
      });
    });

    test("one about a post that quotes another freezes the quoted post through the item korbat adds for it, and no other post of its author", async () => {
      await rolledBack(apiDb, async (tx) => {
        const quoted = await imagePost(tx, 1);
        const sibling = await imagePost(tx, 1, quoted.ownerId);
        const quoter = await profile(tx);
        const quotingId = await newPostRow(tx, quoter.id, { quoteOfId: quoted.postId });
        const first = await suspectItemOn(tx, "post", quotingId);
        await insertItem(tx, { intakeId: first.intakeId, caseId: await openCase(tx, "post", quoted.postId), targetId: quoted.postId, position: 11, lane: 0 });
        const frozen = [];
        for (const id of [quotingId, quoted.postId, sibling.postId]) frozen.push(await postFrozen(tx, id));
        expect(frozen).toEqual([true, true, false]);
      });
    });
  });

  describe("gate K: no image row of a frozen post, and no held row, is deleted", () => {
    test("an upload on no post goes with any delete, unless a hold retains it", async () => {
      await rolledBack(apiDb, async (tx) => {
        const owner = await profile(tx);
        const free = await newImageRow(tx, owner.id, null);
        const held = await newImageRow(tx, owner.id, null);
        await hold(tx, held, await openCase(tx, "account", owner.id));
        expect(ids(await tx.execute<{ id: string }>(DELETE.plain("owner_id", owner.id)))).toEqual([free]);
        expect(await existing(tx, [free, held])).toEqual([held]);
      });
    });

    test("an attached row that a case holds is skipped and RETURNING omits it; its sibling goes; a hold whose time has passed keeps nothing", async () => {
      await rolledBack(apiDb, async (tx) => {
        const { postId, mediaIds } = await imagePost(tx, 3);
        const caseId = await openCase(tx, "post", postId);
        await hold(tx, mediaIds[0]!, caseId);
        await hold(tx, mediaIds[1]!, caseId, sql`now() - interval '1 minute'`);
        expect(await holdUntil(tx, mediaIds[0]!)).toBe("infinity");
        expect(ids(await tx.execute<{ id: string }>(DELETE.plain("post_id", postId)))).toEqual([mediaIds[1]!, mediaIds[2]!].sort());
        expect(await existing(tx, mediaIds)).toEqual([mediaIds[0]!]);
        // The ordered form and a delete by id meet the same trigger.
        expect(ids(await tx.execute<{ id: string }>(DELETE.ordered("post_id", postId)))).toEqual([]);
        expect(ids(await tx.execute<{ id: string }>(sql`delete from post_media where id = ${mediaIds[0]!}::uuid returning id`))).toEqual([]);
        expect(await existing(tx, mediaIds)).toEqual([mediaIds[0]!]);
      });
    });

    test("every image row of a post frozen through its own item is kept against every form of delete, with no hold on it", async () => {
      await rolledBack(apiDb, async (tx) => {
        const frozen = await imagePost(tx, 2);
        const free = await imagePost(tx, 1, frozen.ownerId);
        await suspectItemOn(tx, "post", frozen.postId);
        for (const statement of [DELETE.plain("post_id", frozen.postId), DELETE.ordered("post_id", frozen.postId), sql`delete from post_media where id = ${frozen.mediaIds[0]!}::uuid returning id`]) {
          expect(ids(await tx.execute<{ id: string }>(statement))).toEqual([]);
        }
        // The owner's other post is not reached by a post's case: its image goes.
        expect(ids(await tx.execute<{ id: string }>(DELETE.ordered("owner_id", frozen.ownerId)))).toEqual(free.mediaIds);
        expect(await existing(tx, [...frozen.mediaIds, ...free.mediaIds])).toEqual([...frozen.mediaIds].sort());
        expect(await holdUntil(tx, frozen.mediaIds[0]!)).toBeNull();
      });
    });

    test("an item about the account keeps the images of every post of it, a deleted post included; the account's upload on no post goes", async () => {
      await rolledBack(apiDb, async (tx) => {
        const live = await imagePost(tx, 2);
        const deleted = await imagePost(tx, 1, live.ownerId);
        await tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${deleted.postId}::uuid`);
        const upload = await newImageRow(tx, live.ownerId, null);
        await suspectItemOn(tx, "account", live.ownerId);
        expect(ids(await tx.execute<{ id: string }>(DELETE.plain("post_id", deleted.postId)))).toEqual([]);
        expect(ids(await tx.execute<{ id: string }>(DELETE.ordered("owner_id", live.ownerId)))).toEqual([upload]);
        expect(await existing(tx, [...live.mediaIds, ...deleted.mediaIds, upload])).toEqual([...live.mediaIds, ...deleted.mediaIds].sort());
      });
    });

    describe("a delete that races an intake", () => {
      test.each([
        ["post", "ordered"],
        ["post", "plain"],
        ["account", "ordered"],
        ["account", "plain"],
      ] as const)("a %s target: the %s delete, started while the intake holds the rows with its suspect item uncommitted, waits and then deletes nothing the case reaches", async (target: TargetType, form) => {
        const { ownerId, postId, mediaIds } = await imagePost(apiDb, 2);
        const marker = newMarker();
        const wait = gate();
        const locked = gate();
        let intake: Promise<void> = Promise.resolve();
        let deletion: Promise<Iterable<{ id: string }>> = Promise.resolve([]);
        try {
          const upload = await newImageRow(apiDb, ownerId, null);
          // The intake: the case, the suspect item, then the row locks; it commits when the test lets it.
          intake = withLockTimeout(apiDb, async (tx) => {
            await suspectItemOn(tx, target, target === "post" ? postId : ownerId);
            const rows = await lockImages(tx, target === "post" ? [postId] : [], target === "post" ? [] : [ownerId]);
            expect(ids(rows)).toEqual([...mediaIds].sort());
            locked.open();
            await wait.opened;
          });
          await Promise.race([locked.opened, intake]);
          // Uncommitted, the item freezes nothing for anyone else yet.
          expect(await postFrozen(apiDb, postId)).toBe(false);
          const column = target === "post" ? "post_id" : "owner_id";
          deletion = withLockTimeout(apiDb, (tx) => tx.execute<{ id: string }>(DELETE[form](column, target === "post" ? postId : ownerId, marker)));
          await untilBlocked(apiDb, marker);
          wait.open();
          await intake;
          // The trigger read the freeze after the wait, in a statement of its own: it saw the committed item.
          expect(ids(await deletion)).toEqual(target === "post" ? [] : [upload]);
          expect(await existing(apiDb, mediaIds)).toEqual([...mediaIds].sort());
        } finally {
          // Both transactions end before the rows go, whatever failed above.
          wait.open();
          await Promise.allSettled([intake, deletion]);
          await removeFixtures(migrateDb, [ownerId]);
        }
      }, 60_000);

      test("a delete that commits first leaves the intake's lock statement with no row, and no error", async () => {
        const { ownerId, postId, mediaIds } = await imagePost(apiDb, 2);
        const marker = newMarker();
        const wait = gate();
        const deleted = gate();
        const deletion = withLockTimeout(apiDb, async (tx) => {
          const rows = await tx.execute<{ id: string }>(DELETE.ordered("post_id", postId));
          deleted.open();
          await wait.opened;
          return ids(rows);
        });
        let intake: Promise<string[]> = Promise.resolve([]);
        try {
          await Promise.race([deleted.opened, deletion]);
          intake = withLockTimeout(apiDb, async (tx) => {
            await suspectItemOn(tx, "post", postId);
            return ids(await lockImages(tx, [postId], [], marker));
          });
          await untilBlocked(apiDb, marker);
          wait.open();
          expect(await deletion).toEqual([...mediaIds].sort());
          // The report came too late for these images, as it would have a moment later.
          expect(await intake).toEqual([]);
          expect(await existing(apiDb, mediaIds)).toEqual([]);
          expect(await postFrozen(apiDb, postId)).toBe(true);
        } finally {
          // Both transactions end before the rows go, whatever failed above.
          wait.open();
          await Promise.allSettled([deletion, intake]);
          await removeFixtures(migrateDb, [ownerId]);
        }
      }, 60_000);
    });

    test("outside READ COMMITTED a delete of an attached row is refused, since the trigger would read an old snapshot; an upload on no post goes", async () => {
      for (const isolationLevel of ["repeatable read", "serializable"] as const) {
        await rolledBackAt(apiDb, isolationLevel, async (tx) => {
          const { ownerId, postId, mediaIds } = await imagePost(tx, 1);
          const upload = await newImageRow(tx, ownerId, null);
          expect(await within(tx, (sp) => sp.execute(DELETE.plain("post_id", postId))), isolationLevel).toEqual({ code: "25000", message: "read_committed_only" });
          expect(await existing(tx, mediaIds)).toEqual(mediaIds);
          expect(ids(await tx.execute<{ id: string }>(sql`delete from post_media where id = ${upload}::uuid returning id`))).toEqual([upload]);
        });
      }
    });

    test("a cascade from a deleted post or profile is refused when it meets a retained row, and passes when it meets none", async () => {
      /** The error of a cascading delete as the migrator, inside a savepoint. */
      const cascade = (tx: DbTx, table: "posts" | "profiles", id: string) => within(tx, (sp) => sp.execute(sql`delete from ${sql.raw(table)} where id = ${id}::uuid`));
      const retained = expect.objectContaining({ code: "23001", message: expect.stringMatching(/^post_media row [0-9a-f-]{36} is retained$/) });

      await rolledBack(migrateDb, async (tx) => {
        // Frozen through its post's own item.
        const own = await imagePost(tx, 2);
        await suspectItemOn(tx, "post", own.postId);
        expect(await cascade(tx, "posts", own.postId)).toEqual(retained);
        expect(await cascade(tx, "profiles", own.ownerId)).toEqual(retained);
        // An erased image of that post is kept like the others.
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${own.mediaIds[0]!}::uuid`);
        await tx.execute(sql`delete from post_media where id = ${own.mediaIds[1]!}::uuid`);
        expect(await existing(tx, own.mediaIds)).toEqual([...own.mediaIds].sort());
        expect(await cascade(tx, "posts", own.postId)).toEqual(retained);

        // Frozen through its author's account's item.
        const account = await imagePost(tx, 1);
        await suspectItemOn(tx, "account", account.ownerId);
        expect(await cascade(tx, "posts", account.postId)).toEqual(retained);
        expect(await cascade(tx, "profiles", account.ownerId)).toEqual(retained);

        // Retained by a case's hold alone.
        const held = await imagePost(tx, 1);
        await hold(tx, held.mediaIds[0]!, await openCase(tx, "post", held.postId));
        expect(await cascade(tx, "posts", held.postId)).toEqual(retained);

        // Nothing retains this one: the post and its image go, as the development cleaner needs.
        const free = await imagePost(tx, 1);
        expect(await cascade(tx, "posts", free.postId)).toBeNull();
        expect(await existing(tx, free.mediaIds)).toEqual([]);
        // Every refused post is still there.
        const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from posts where id = any(${uuids([own.postId, account.postId, held.postId])})`);
        expect(left[0]!.n).toBe(3);
      });
    });
  });

  describe("an image stays on its post, with the content it was posted with", () => {
    const refused = { code: "42501", message: "moderation_column" };
    /** The API role holds no UPDATE on owner_id at all: the grant refuses before the trigger is asked. */
    const ungranted = { code: "42501", message: expect.stringMatching(/permission denied for table post_media/) };

    test("an image row is inserted on no post: an insert that names a post is refused, for the API role and for the migrator", async () => {
      for (const db of [apiDb, migrateDb]) {
        await rolledBack(db, async (tx) => {
          const mine = await imagePost(tx, 0);
          const theirs = await imagePost(tx, 0);
          // Whoever the post belongs to: a row comes to a post only by attach's update, which the guard checks.
          for (const postId of [theirs.postId, mine.postId]) {
            const err = await within(tx, (sp) =>
              sp.execute(sql`insert into post_media (owner_id, status, width, height, blurhash, post_id, position, alt_text) values (${mine.ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL', ${postId}::uuid, 0, 'x')`),
            );
            expect(err).toEqual(refused);
          }
          const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from post_media where owner_id = ${mine.ownerId}::uuid`);
          expect(left[0]!.n).toBe(0);
        });
      }
    });

    test("the API role can neither move, detach or re-own an image, nor put an upload on another account's post, nor change an attached image's content", async () => {
      await rolledBack(apiDb, async (tx) => {
        const mine = await imagePost(tx, 1);
        const second = await newPostRow(tx, mine.ownerId);
        const theirs = await imagePost(tx, 0);
        const upload = await newImageRow(tx, mine.ownerId, null);
        const attached = mine.mediaIds[0]!;
        for (const id of [attached, upload]) {
          expect(await within(tx, (sp) => sp.execute(sql`update post_media set owner_id = ${theirs.ownerId}::uuid where id = ${id}::uuid`)), "change the owner").toEqual(ungranted);
        }
        const statements: [string, SQL][] = [
          ["move to another post of the author", sql`update post_media set post_id = ${second}::uuid where id = ${attached}::uuid`],
          ["detach", sql`update post_media set post_id = null, position = null where id = ${attached}::uuid`],
          ["attach to another account's post", sql`update post_media set post_id = ${theirs.postId}::uuid, position = 0, alt_text = 'x' where id = ${upload}::uuid`],
          ["change the alt text", sql`update post_media set alt_text = 'another description' where id = ${attached}::uuid`],
          ["change the position", sql`update post_media set position = 3 where id = ${attached}::uuid`],
          ["change the width", sql`update post_media set width = 1 where id = ${attached}::uuid`],
          ["change the height", sql`update post_media set height = 1 where id = ${attached}::uuid`],
          ["change the blurhash", sql`update post_media set blurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' where id = ${attached}::uuid`],
        ];
        for (const [label, statement] of statements) expect(await within(tx, (sp) => sp.execute(statement)), label).toEqual(refused);
        // Naming a guarded column without changing it, and the worker's verdict on an upload, pass.
        expect(await within(tx, (sp) => sp.execute(sql`update post_media set alt_text = alt_text, post_id = post_id where id = ${attached}::uuid`))).toBeNull();
        expect(await within(tx, (sp) => sp.execute(sql`update post_media set width = 640, height = 480, blurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' where id = ${upload}::uuid`))).toBeNull();
      });
    });

    test("attach, for the post's author, passes: one update of a row that is on no post", async () => {
      await rolledBack(apiDb, async (tx) => {
        const author = await profile(tx);
        const postId = await newPostRow(tx, author.id);
        const upload = await newImageRow(tx, author.id, null);
        await createMediaRepo(tx as unknown as Db).attach(tx, { postId, ownerId: author.id, items: [{ id: upload, alt: "a described image" }] });
        const [row] = await tx.execute<Record<string, unknown>>(sql`select post_id, position, alt_text from post_media where id = ${upload}::uuid`);
        expect(row).toEqual({ post_id: postId, position: 0, alt_text: "a described image" });
      });
    });

    test("the migrator is held to the same, except that it may blank what an erasure erases", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const mine = await imagePost(tx, 1);
        const second = await newPostRow(tx, mine.ownerId);
        const theirs = await imagePost(tx, 0);
        const upload = await newImageRow(tx, mine.ownerId, null);
        const attached = mine.mediaIds[0]!;
        const statements: [string, SQL][] = [
          ["move", sql`update post_media set post_id = ${second}::uuid where id = ${attached}::uuid`],
          ["detach", sql`update post_media set post_id = null, position = null where id = ${attached}::uuid`],
          ["change the owner of an attached image", sql`update post_media set owner_id = ${theirs.ownerId}::uuid where id = ${attached}::uuid`],
          ["change the owner of an upload", sql`update post_media set owner_id = ${theirs.ownerId}::uuid where id = ${upload}::uuid`],
          ["attach to another account's post", sql`update post_media set post_id = ${theirs.postId}::uuid, position = 0, alt_text = 'x' where id = ${upload}::uuid`],
        ];
        for (const [label, statement] of statements) expect(await within(tx, (sp) => sp.execute(statement)), label).toEqual(refused);
        expect(await within(tx, (sp) => sp.execute(sql`update post_media set alt_text = '', erased_at = now() where id = ${attached}::uuid`))).toBeNull();
      });
    });
  });

  describe("media_holds_apply keeps hold_until at the latest end of an image's unreleased holds", () => {
    test("a hold without an end holds for good; with an end, until then; several, until the latest; released, no longer", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const { ownerId, postId, mediaIds } = await imagePost(tx, 1);
        const mediaId = mediaIds[0]!;
        expect(await holdUntil(tx, mediaId)).toBeNull();
        const postCase = await openCase(tx, "post", postId);
        const accountCase = await openCase(tx, "account", ownerId);

        const [timed] = await hold(tx, mediaId, postCase, sql`'2031-05-06T07:08:09Z'`);
        expect(await holdUntil(tx, mediaId)).toBe((await tx.execute<{ t: string }>(sql`select '2031-05-06T07:08:09Z'::timestamptz::text as t`))[0]!.t);
        const [open] = await hold(tx, mediaId, accountCase);
        expect(await holdUntil(tx, mediaId)).toBe("infinity");

        // A release is an update of the hold's row, which only migrator-owned code makes.
        await tx.execute(sql`update media_holds set released_at = now() where id = ${open!.id}`);
        expect(await holdUntil(tx, mediaId)).not.toBe("infinity");
        expect(await holdUntil(tx, mediaId)).not.toBeNull();
        await tx.execute(sql`update media_holds set released_at = now() where id = ${timed!.id}`);
        expect(await holdUntil(tx, mediaId)).toBeNull();
      });
    });

    test("a release of one case's hold that races a new hold of another case on the same image leaves the image held", async () => {
      const { ownerId, postId, mediaIds } = await imagePost(apiDb, 1);
      const mediaId = mediaIds[0]!;
      const marker = newMarker();
      const wait = gate();
      const placed = gate();
      let placing: Promise<void> = Promise.resolve();
      let releasing: Promise<void> = Promise.resolve();
      try {
        const postCase = await openCase(apiDb, "post", postId);
        const accountCase = await openCase(apiDb, "account", ownerId);
        const [first] = await hold(apiDb, mediaId, postCase);
        // The second case's hold is placed and not yet committed: its trigger holds the image's row.
        placing = withLockTimeout(apiDb, async (tx) => {
          await hold(tx, mediaId, accountCase);
          placed.open();
          await wait.opened;
        });
        await Promise.race([placed.opened, placing]);
        // The release of the first case's hold waits for that row; once it has it, it reads the holds afresh.
        releasing = rolledBack(migrateDb, async (tx) => {
          await tx.execute(sql`update ${sql.raw(`/* ${marker} */`)} media_holds set released_at = now() where id = ${first!.id}`);
          expect(await holdUntil(tx, mediaId)).toBe("infinity");
          const left = await tx.execute<{ n: number }>(sql`select count(*)::int as n from media_holds where media_id = ${mediaId}::uuid and released_at is null`);
          expect(left[0]!.n).toBe(1);
        });
        await untilBlocked(migrateDb, marker);
        wait.open();
        await placing;
        await releasing;
        expect(await holdUntil(apiDb, mediaId)).toBe("infinity");
      } finally {
        wait.open();
        await Promise.allSettled([placing, releasing]);
        await removeFixtures(migrateDb, [ownerId]);
      }
    }, 60_000);
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/moderation-schema.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTION_KINDS, CSAM_KEYWORDS, DECISION_KEYWORDS, MEASURES, NOTICE_LIMITS, RULE_IDS, TDB_CATEGORIES, appealDeadline, textDigest } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { TEXT_DIGEST_VECTORS } from "../../../../packages/contracts/test/digest-vectors";
import { loadConfig } from "../../src/config";
import { MINORS, SPEECH, TC, fabricateDecision, hex64, insertIntake, newImageRow, newPostRow, newRef, openCase, rowCounts, type IntakeInput } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements, each a round trip, and several hold a transaction open across them: on a
// loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/** The public tables migration 0015 creates, and what the API role holds on each beside SELECT. */
const APPEND_ONLY = ["cases", "decision_actions", "appeals", "staff_texts", "evidence_snapshots", "case_access_log", "media_holds"];
const COLUMN_UPDATES: Record<string, string[]> = {
  intakes: ["receipt", "receipt_sent_at"],
  intake_items: ["outcome_mail"],
  decisions: ["author_mail", "author_mail_at"],
  posts: ["body", "state", "deleted_at", "like_count", "repost_count", "reply_count", "quote_count"],
  post_media: ["status", "error", "post_id", "position", "width", "height", "blurhash", "alt_text", "nsfw_score"],
};
const READ_ONLY = ["moderation_limits", "seal_posts"];

/**
 * Migrations 0014 and 0015 (3c design, sections 6.1 and 6.5) against the real database, before any flow uses them: what
 * the API role holds and does not hold, which columns the database forces whatever an insert supplies, the CHECKs against
 * the contracts' constants, and who names the freeze's functions. Statements run as korbat_api, the role the running API
 * holds, unless a test says otherwise: what it cannot do is what a compromised API cannot do. Every test that writes a
 * row does it inside a transaction that is rolled back, each refused statement in a savepoint of it, so the file leaves
 * the database as it found it; its last test holds it to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the moderation tables, their grants and their checks", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** Runs one statement as the API role, in a transaction with a lock timeout, and returns its error or null. For statements that write no row. */
  const asApi = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(apiDb, (tx) => tx.execute(statement)));
  const asAuth = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(authDb, (tx) => tx.execute(statement)));
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  const run = (tx: DbTx, statement: ReturnType<typeof sql>) => within(tx, (sp) => sp.execute(statement));
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The digest of a salt and a text as SQL computes it, also for a salt the contracts' textDigest refuses. */
  const sqlDigest = async (db: Db | DbTx, salt: string, text: string) =>
    (await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${salt}, 'hex') || convert_to(${text}::text, 'UTF8')), 'hex') as digest`))[0]!.digest;

  /**
   * Which of the four table privileges, TRUNCATE and MAINTAIN a role holds on a table, named as schema.table. The table is
   * found in the catalogue by its oid: looking it up by name would need USAGE on its schema, which the API role lacks on auth.
   */
  async function tablePrivileges(role: string, table: string): Promise<string[]> {
    const [schema, name] = table.split(".");
    const rows = await apiDb.execute<{ privilege: string; held: boolean }>(sql`
      select p as privilege, has_table_privilege(${role}::name, c.oid, p) as held
        from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN']) with ordinality as u(p, place)
       where n.nspname = ${schema} and c.relname = ${name}
       order by u.place`);
    expect(rows, table).toHaveLength(6);
    return rows.filter((row) => row.held).map((row) => row.privilege);
  }

  /** The columns of a table a role may update, by a column grant or the table's. */
  async function updatableColumns(role: string, table: string): Promise<string[]> {
    const [schema, name] = table.split(".");
    const rows = await apiDb.execute<{ name: string }>(sql`
      select a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${schema} and c.relname = ${name} and a.attnum > 0 and not a.attisdropped and has_column_privilege(${role}::name, a.attrelid, a.attnum, 'UPDATE')
       order by a.attnum`);
    return rows.map((row) => row.name);
  }

  /** One CHECK as the migrated database defines it. */
  async function checkDefinition(table: string, name: string): Promise<string> {
    const [row] = await apiDb.execute<{ definition: string }>(sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = ${`public.${table}`}::regclass and conname = ${name}`);
    expect(row, `${table}.${name}`).toBeDefined();
    return row!.definition;
  }

  describe("what the API role holds", () => {
    test("the append-only tables: SELECT and INSERT, and no column of them can be updated", async () => {
      for (const table of APPEND_ONLY) {
        expect(await tablePrivileges("korbat_api", `public.${table}`), table).toEqual(["SELECT", "INSERT"]);
        expect(await updatableColumns("korbat_api", `public.${table}`), table).toEqual([]);
      }
    });

    test("intakes, items and decisions: SELECT, INSERT and UPDATE of their mail columns only; no DELETE and no TRUNCATE", async () => {
      for (const table of ["intakes", "intake_items", "decisions"]) {
        expect(await tablePrivileges("korbat_api", `public.${table}`), table).toEqual(["SELECT", "INSERT"]);
        expect(await updatableColumns("korbat_api", `public.${table}`), table).toEqual(COLUMN_UPDATES[table]);
      }
    });

    test("the limits and a seal's list are read only", async () => {
      for (const table of READ_ONLY) {
        expect(await tablePrivileges("korbat_api", `public.${table}`), table).toEqual(["SELECT"]);
        expect(await updatableColumns("korbat_api", `public.${table}`), table).toEqual([]);
      }
      expect(await tablePrivileges("korbat_api", "public.measures_in_force")).toEqual(["SELECT"]);
    });

    test("posts: UPDATE of the seven columns the API writes, never of the moderation level or the erasure time; no DELETE, no TRUNCATE", async () => {
      expect(await tablePrivileges("korbat_api", "public.posts")).toEqual(["SELECT", "INSERT"]);
      expect((await updatableColumns("korbat_api", "public.posts")).sort()).toEqual([...COLUMN_UPDATES.posts!].sort());
    });

    test("post_media: UPDATE of the nine columns the API writes, never of the moderation state, the hold or the erasure time; DELETE stays, TRUNCATE never", async () => {
      expect(await tablePrivileges("korbat_api", "public.post_media")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect((await updatableColumns("korbat_api", "public.post_media")).sort()).toEqual([...COLUMN_UPDATES.post_media!].sort());
    });

    test("profiles: everything but DELETE and TRUNCATE", async () => {
      expect(await tablePrivileges("korbat_api", "public.profiles")).toEqual(["SELECT", "INSERT", "UPDATE"]);
    });

    test("it has no access to the auth schema, nor to any of the four new auth tables", async () => {
      const [row] = await apiDb.execute<{ usage: boolean }>(sql`select has_schema_privilege('korbat_api', 'auth', 'usage') as usage`);
      expect(row!.usage).toBe(false);
      for (const table of ["notifier_contacts", "notifier_confirmations", "notifier_suppressions", "staff_personal_accounts"]) {
        expect(await tablePrivileges("korbat_api", `auth.${table}`), table).toEqual([]);
        expect((await asApi(sql`select count(*) from auth.${sql.identifier(table)}`))?.message, table).toMatch(/permission denied for schema auth/);
      }
    });

    test("the statements themselves are refused: updates, deletes and truncates of the moderation tables", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const caseId = await openCase(tx, "post", postId);
        const intakeId = await insertIntake(tx, { reporterId: ada.id, ruleId: "R1" });
        const refused: [ReturnType<typeof sql>, RegExp][] = [
          [sql`update cases set lane = 0 where id = ${caseId}::uuid`, /permission denied for table cases/],
          [sql`update cases set closed_at = now() where id = ${caseId}::uuid`, /permission denied for table cases/],
          [sql`delete from cases where id = ${caseId}::uuid`, /permission denied for table cases/],
          [sql`truncate cases cascade`, /permission denied for table/],
          // Without UPDATE on the table no row of it can be locked either, so the API cannot stall a decision by holding a case.
          [sql`select id from cases where id = ${caseId}::uuid for update`, /permission denied for table cases/],
          [sql`select id from cases where id = ${caseId}::uuid for key share`, /permission denied for table cases/],
          [sql`lock table cases in share mode`, /permission denied for table cases/],
          [sql`update intakes set erased_at = now() where id = ${intakeId}::uuid`, /permission denied for table intakes/],
          [sql`update intakes set reporter_id = null where id = ${intakeId}::uuid`, /permission denied for table intakes/],
          [sql`delete from intakes where id = ${intakeId}::uuid`, /permission denied for table intakes/],
          [sql`update intake_items set outcome_sent_at = now()`, /permission denied for table intake_items/],
          [sql`update intake_items set shown_outcome = 'no_violation'`, /permission denied for table intake_items/],
          [sql`update intake_items set revised_sent_at = now()`, /permission denied for table intake_items/],
          [sql`update intake_items set answered_by = null`, /permission denied for table intake_items/],
          [sql`delete from intake_items`, /permission denied for table intake_items/],
          [sql`update decisions set outcome = 'no_violation'`, /permission denied for table decisions/],
          [sql`delete from decisions`, /permission denied for table decisions/],
          [sql`delete from decision_actions`, /permission denied for table decision_actions/],
          [sql`insert into seal_posts (action_id, post_id, images) values (${randomUUID()}::uuid, ${postId}::uuid, 1)`, /permission denied for table seal_posts/],
          [sql`insert into moderation_limits (id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day, updated_at) values (1, 9, 9, 9, 9, 9, now())`, /permission denied for table moderation_limits/],
          [sql`update moderation_limits set decisions_per_hour = 100000`, /permission denied for table moderation_limits/],
          [sql`delete from moderation_limits`, /permission denied for table moderation_limits/],
          [sql`update staff_texts set text = 'changed'`, /permission denied for table staff_texts/],
          [sql`update evidence_snapshots set body = 'changed'`, /permission denied for table evidence_snapshots/],
          [sql`delete from case_access_log`, /permission denied for table case_access_log/],
          [sql`update media_holds set released_at = now()`, /permission denied for table media_holds/],
          [sql`delete from media_holds`, /permission denied for table media_holds/],
        ];
        for (const [statement, refusal] of refused) expect((await run(tx, statement))?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
        // The granted columns are writable.
        expect(await run(tx, sql`update intakes set receipt = 'sent', receipt_sent_at = now() where id = ${intakeId}::uuid`)).toBeNull();
      });
    });

    test("posts and profiles are never deleted, and the moderation columns of posts and images are never written", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const mediaId = await newImageRow(tx, ada.id, postId);
        const refused: [ReturnType<typeof sql>, RegExp][] = [
          [sql`delete from posts where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`delete from profiles where id = ${ada.id}::uuid`, /permission denied for table profiles/],
          [sql`truncate posts cascade`, /permission denied for table/],
          [sql`truncate profiles cascade`, /permission denied for table/],
          [sql`truncate post_media cascade`, /permission denied for table/],
          [sql`update posts set moderation_level = 'removed' where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`update posts set erased_at = now() where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`update posts set author_id = ${ada.id}::uuid where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`update post_media set moderation_state = 'sealed' where id = ${mediaId}::uuid`, /permission denied for table post_media/],
          [sql`update post_media set hold_until = null where id = ${mediaId}::uuid`, /permission denied for table post_media/],
          [sql`update post_media set erased_at = now() where id = ${mediaId}::uuid`, /permission denied for table post_media/],
        ];
        for (const [statement, refusal] of refused) expect((await run(tx, statement))?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
        // What the API writes today still works: a counter, the author's deletion and an upload's verdict.
        expect(await run(tx, sql`update posts set like_count = like_count + 1 where id = ${postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`)).toBeNull();
        const upload = await newImageRow(tx, ada.id, null);
        expect(await run(tx, sql`update post_media set status = 'failed', error = 'processing_failed' where id = ${upload}::uuid`)).toBeNull();
      });
    });

    test("it can neither switch off nor replace a trigger of the moderation tables", async () => {
      const refusals: [ReturnType<typeof sql>, RegExp][] = [
        [sql`alter table public.post_media disable trigger post_media_keep`, /must be owner of table post_media/],
        [sql`alter table public.intake_items disable trigger all`, /must be owner of table intake_items/],
        [sql`drop trigger post_media_guard on public.post_media`, /must be owner of (table|relation) post_media/],
        [sql`create or replace function public.frozen_for(post uuid, author uuid) returns boolean language sql as 'select false'`, /permission denied|must be owner/],
        [sql`drop trigger intake_items_quote on public.intake_items`, /must be owner of (table|relation) intake_items/],
      ];
      for (const [statement, refusal] of refusals) expect((await asApi(statement))?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
    });
  });

  describe("what the auth role holds on the new auth tables", () => {
    test("a contact is stored, read and deleted, and only its forget_after is ever updated", async () => {
      expect(await tablePrivileges("korbat_auth", "auth.notifier_contacts")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect(await updatableColumns("korbat_auth", "auth.notifier_contacts")).toEqual(["forget_after"]);
      await rolledBack(authDb, async (tx) => {
        const id = randomUUID();
        await tx.execute(sql`insert into auth.notifier_contacts (id, name_enc, email_enc, email_hash, forget_after) values (${id}::uuid, 'v1:n', 'v1:e', ${hex64()}, now() + interval '13 months')`);
        expect(await run(tx, sql`update auth.notifier_contacts set forget_after = now() + interval '6 months' where id = ${id}::uuid`)).toBeNull();
        // Never re-encrypted, renamed or pointed at another address.
        for (const column of ["name_enc", "email_enc", "email_hash", "mail_token_enc", "created_at"]) {
          const err = await run(tx, sql`update auth.notifier_contacts set ${sql.identifier(column)} = null where id = ${id}::uuid`);
          expect(err?.message, column).toMatch(/permission denied for table notifier_contacts/);
        }
        const gone = await tx.execute<{ id: string }>(sql`delete from auth.notifier_contacts where id = ${id}::uuid returning id`);
        expect(gone).toHaveLength(1);
      });
    });

    test("confirmations keep every default privilege; a suppression is inserted, read and deleted, never changed", async () => {
      expect(await tablePrivileges("korbat_auth", "auth.notifier_confirmations")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
      expect(await tablePrivileges("korbat_auth", "auth.notifier_suppressions")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect(await updatableColumns("korbat_auth", "auth.notifier_suppressions")).toEqual([]);
    });

    test("it holds nothing on the staff links, which only the migrator writes and reads", async () => {
      expect(await tablePrivileges("korbat_auth", "auth.staff_personal_accounts")).toEqual([]);
      expect((await asAuth(sql`select count(*) from auth.staff_personal_accounts`))?.message).toMatch(/permission denied for table staff_personal_accounts/);
      expect((await asAuth(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${randomUUID()}::uuid, ${randomUUID()}::uuid)`))?.message).toMatch(
        /permission denied for table staff_personal_accounts/,
      );
    });
  });

  describe("the functions and who names them", () => {
    type Fn = { name: string; args: string; owner: string; definer: boolean; config: string[] | null; api: boolean; auth: boolean; pub: boolean; definition: string };
    /** Every function of the public and auth schemas with its definition, as the catalogue holds it. */
    const functions = () =>
      apiDb.execute<Fn>(sql`
        select p.pronamespace::regnamespace::text || '.' || p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.proowner::regrole::text as owner,
               p.prosecdef as definer, p.proconfig as config, has_function_privilege('korbat_api', p.oid, 'execute') as api,
               has_function_privilege('korbat_auth', p.oid, 'execute') as auth, has_function_privilege('public', p.oid, 'execute') as pub,
               pg_get_functiondef(p.oid) as definition
          from pg_proc p
         where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace) and p.prokind = 'f'
         order by 1`);

    /** Every other definition the database holds that could name a function: views, triggers, constraints, index predicates and policies. */
    const otherDefinitions = () =>
      apiDb.execute<{ kind: string; name: string; definition: string }>(sql`
        select 'view' as kind, c.relname::text as name, pg_get_viewdef(c.oid) as definition from pg_class c where c.relkind = 'v' and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'trigger', t.tgname::text, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'constraint', n.conname::text, pg_get_constraintdef(n.oid) from pg_constraint n where n.connamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'index', i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'policy', p.polname::text, coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') from pg_policy p`);

    test("the migrator owns every function of 0015, each with its search path pinned and EXECUTE taken from PUBLIC", async () => {
      const pub = ["search_path=public, pg_temp"];
      // [definer, EXECUTE for the API role]. The few a role calls directly are granted to that role alone; a trigger
      // function fires for every role all the same, and nobody calls it.
      const expected: Record<string, [boolean, boolean]> = {
        appeal_deadline: [false, true],
        case_access_log_insert: [false, false],
        cases_insert: [false, false],
        evidence_snapshots_insert: [false, false],
        frozen_for: [false, true],
        intake_items_attach: [true, false],
        intake_items_quote: [true, false],
        intakes_insert: [false, false],
        media_holds_apply: [true, false],
        media_holds_insert: [false, false],
        post_frozen: [false, true],
        post_media_guard: [false, false],
        post_media_insert: [false, false],
        post_media_keep: [true, false],
        staff_texts_insert: [false, false],
      };
      const names = Object.keys(expected);
      const rows = (await functions()).filter((f) => f.name.startsWith("public.") && names.includes(f.name.slice(7)));
      expect(rows.map((f) => f.name.slice(7)).sort()).toEqual([...names].sort());
      for (const f of rows) {
        const [definer, api] = expected[f.name.slice(7)]!;
        expect({ name: f.name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }).toEqual({ name: f.name, owner: "korbat_migrate", definer, config: pub, api, auth: false, pub: false });
      }
    });

    test("every function the migrator owns in the two schemas pins its search path and is closed to PUBLIC", async () => {
      const owned = (await functions()).filter((f) => f.owner === "korbat_migrate");
      expect(owned.length).toBeGreaterThan(15);
      for (const f of owned) {
        expect(f.config?.some((setting) => /^search_path=(public|auth), pg_temp$/.test(setting)), f.name).toBe(true);
        expect(f.pub, f.name).toBe(false);
      }
    });

    test("frozen_for is named only by post_frozen and by the keep trigger's function; post_frozen by nothing else", async () => {
      const all = await functions();
      const naming = (word: RegExp) => all.filter((f) => word.test(f.definition)).map((f) => f.name);
      // Each function's own definition holds its name.
      expect(naming(/\bfrozen_for\b/)).toEqual(["public.frozen_for", "public.post_frozen", "public.post_media_keep"]);
      expect(naming(/\bpost_frozen\b/)).toEqual(["public.post_frozen"]);
      // Nor does a view, a trigger, a constraint, an index or a policy name either.
      const others = (await otherDefinitions()).filter((d) => /\b(frozen_for|post_frozen)\b/.test(d.definition));
      expect(others.map((d) => `${d.kind} ${d.name}`)).toEqual([]);
    });

    test("no function deletes from post_media: the image rows go only by a statement the keep trigger meets", async () => {
      const deleting = (await functions()).filter((f) => /delete\s+from\s+(only\s+)?("?public"?\s*\.\s*)?"?post_media"?\b/i.test(f.definition));
      expect(deleting.map((f) => f.name)).toEqual([]);
      // The search finds such a statement where there is one.
      expect(/delete\s+from\s+(only\s+)?("?public"?\s*\.\s*)?"?post_media"?\b/i.test('DELETE FROM "public"."post_media" WHERE id = $1')).toBe(true);
      expect(/delete\s+from\s+(only\s+)?("?public"?\s*\.\s*)?"?post_media"?\b/i.test("delete from public.post_media m where m.id = x")).toBe(true);
    });

    test("the triggers of 0015 are on their tables, in the timing the design gives", async () => {
      const rows = await apiDb.execute<{ name: string; definition: string }>(sql`
        select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t
         where not t.tgisinternal and t.tgrelid in ('public.cases'::regclass, 'public.intakes'::regclass, 'public.intake_items'::regclass, 'public.staff_texts'::regclass,
               'public.evidence_snapshots'::regclass, 'public.case_access_log'::regclass, 'public.post_media'::regclass, 'public.media_holds'::regclass)
         order by 1`);
      const timing = Object.fromEntries(rows.map((row) => [row.name, row.definition.replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]));
      expect(timing).toEqual({
        case_access_log_insert: "BEFORE INSERT ON public.case_access_log FOR EACH ROW",
        cases_insert: "BEFORE INSERT ON public.cases FOR EACH ROW",
        evidence_snapshots_insert: "BEFORE INSERT ON public.evidence_snapshots FOR EACH ROW",
        intake_items_attach: "BEFORE INSERT ON public.intake_items FOR EACH ROW",
        intake_items_quote: "AFTER INSERT ON public.intake_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW",
        intakes_insert: "BEFORE INSERT ON public.intakes FOR EACH ROW",
        media_holds_apply: "AFTER INSERT OR UPDATE ON public.media_holds FOR EACH ROW",
        media_holds_insert: "BEFORE INSERT ON public.media_holds FOR EACH ROW",
        post_media_guard: 'BEFORE UPDATE OF post_id, owner_id, alt_text, "position", width, height, blurhash ON public.post_media FOR EACH ROW',
        post_media_insert: "BEFORE INSERT ON public.post_media FOR EACH ROW",
        post_media_keep: "BEFORE DELETE ON public.post_media FOR EACH ROW",
        staff_texts_insert: "BEFORE INSERT ON public.staff_texts FOR EACH ROW",
      });
    });

    test("measures_in_force runs with its reader's rights and names exactly the contracts' measures", async () => {
      const [view] = await apiDb.execute<{ options: string[] | null; definition: string }>(sql`select c.reloptions as options, pg_get_viewdef(c.oid) as definition from pg_class c where c.oid = 'public.measures_in_force'::regclass`);
      expect(view!.options).toEqual(["security_invoker=true"]);
      const measures = ACTION_KINDS.filter((kind) => MEASURES[kind].lifts === null);
      const named = [...view!.definition.matchAll(/'([a-z_]+)'::action_kind/g)].map((m) => m[1]);
      expect([...new Set(named)].sort()).toEqual([...measures].sort());
      // No value of post_state: a migration that adds one cannot change what "in force" means.
      expect(view!.definition).not.toMatch(/post_state/);
      const columns = await apiDb.execute<{ name: string }>(sql`select attname::text as name from pg_attribute where attrelid = 'public.measures_in_force'::regclass and attnum > 0 order by attnum`);
      expect(columns.map((c) => c.name)).toEqual(["id", "kind", "post_id", "media_id", "subject_account_id", "decision_id", "decision_kind", "case_id"]);
    });
  });

  describe("each CHECK written from a contracts constant holds exactly that constant's values", () => {
    /** The quoted values of one CHECK, as the migrated database defines it. */
    const checkValues = async (table: string, name: string) => [...(await checkDefinition(table, name)).matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();
    /** The one number of a length CHECK. */
    async function checkBound(table: string, name: string): Promise<number> {
      const definition = await checkDefinition(table, name);
      const numbers = [...definition.matchAll(/<= (\d+)/g)].map((m) => Number(m[1]));
      expect(numbers, definition).toHaveLength(1);
      return numbers[0]!;
    }

    test("the 16 Transparency Database categories, on intakes and on decisions", async () => {
      expect(await checkValues("intakes", "intakes_category")).toEqual([...TDB_CATEGORIES].sort());
      expect(await checkValues("decisions", "decisions_category")).toEqual([...TDB_CATEGORIES].sort());
    });

    test("the CSAM path's keywords on intakes, and a decision's keywords", async () => {
      const keywords = Object.values(CSAM_KEYWORDS).filter((keyword): keyword is NonNullable<typeof keyword> => keyword !== null);
      expect(await checkValues("intakes", "intakes_category_keyword")).toEqual([...keywords].sort());
      expect(await checkValues("decisions", "decisions_category_keyword")).toEqual([...DECISION_KEYWORDS].sort());
    });

    test("the six rules, on intakes and on decisions", async () => {
      expect(await checkValues("intakes", "intakes_rule_id")).toEqual([...RULE_IDS]);
      expect(await checkValues("decisions", "decisions_rule_id")).toEqual([...RULE_IDS]);
    });

    test("the bounds of a notice's two texts", async () => {
      expect(await checkBound("intakes", "intakes_explanation_len")).toBe(NOTICE_LIMITS.explanationMax);
      expect(await checkBound("intakes", "intakes_cited_law_len")).toBe(NOTICE_LIMITS.citedLawMax);
    });

    test("the ledger's kinds are the contracts' action kinds, in their order", async () => {
      const rows = await apiDb.execute<{ label: string }>(sql`select e.enumlabel::text as label from pg_enum e where e.enumtypid = 'public.action_kind'::regtype order by e.enumsortorder`);
      expect(rows.map((row) => row.label)).toEqual([...ACTION_KINDS]);
    });

    test("post_state still has its four values: a seal is a state of images", async () => {
      const rows = await apiDb.execute<{ label: string }>(sql`select e.enumlabel::text as label from pg_enum e where e.enumtypid = 'public.post_state'::regtype order by e.enumsortorder`);
      expect(rows.map((row) => row.label)).toEqual(["visible", "withheld", "removed", "deleted_by_author"]);
    });

    test("no check lets a row through on a null: the database holds the null-safe forms", async () => {
      // A CHECK passes when its expression is null. These five are written so that it never is. PostgreSQL stores
      // "is not distinct from" as the negation of "is distinct from" and prints it that way.
      expect(await checkDefinition("intake_items", "intake_items_case")).toContain("(NOT (outcome IS DISTINCT FROM 'not_available'::item_outcome))");
      expect(await checkDefinition("decisions", "decisions_keyword")).toContain("(NOT (ground IS DISTINCT FROM 'illegal'::decision_ground))");
      expect(await checkDefinition("intake_items", "intake_items_statement")).toContain("statement_digest IS NOT NULL");
      expect(await checkDefinition("appeals", "appeals_statement")).toContain("statement_digest IS NOT NULL");
      expect(await checkDefinition("staff_texts", "staff_texts_digest")).toContain("salt ~ '^[0-9a-f]{64}$'");
    });
  });

  describe("appeal_deadline", () => {
    test("it equals the contracts' appealDeadline on every month end of two years, a leap year among them, and on the days around them", async () => {
      // The last three days of each month of 2027 and 2028 (2028 has a 29 February) and the first of the next, at three times of day.
      // Both times as the text toISOString writes, so that nothing depends on how the driver reads a timestamp.
      const rows = await apiDb.execute<{ informed: string; deadline: string }>(sql`
        select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as informed, to_char(public.appeal_deadline(t) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deadline
          from generate_series('2027-01-01'::timestamp, '2028-12-01'::timestamp, interval '1 month') month,
               generate_series(-3, 0) shift,
               unnest(array[interval '0 hours', interval '12 hours 30 minutes 15.25 seconds', interval '23 hours 59 minutes 59.999 seconds']) time_of_day,
               lateral (select (month + interval '1 month' + make_interval(days => shift) + time_of_day) at time zone 'UTC' as t) s
         order by 1`);
      expect(rows).toHaveLength(24 * 4 * 3);
      for (const row of rows) expect(appealDeadline(new Date(row.informed)).toISOString(), row.informed).toBe(row.deadline);
      // The set really holds the clamp: 31 August 2027 is due on the leap day.
      const august = rows.find((row) => row.informed === "2027-08-31T00:00:00.000Z");
      expect(august?.deadline).toBe("2028-02-29T00:00:00.000Z");
    });

    test("it does not depend on the session's time zone", async () => {
      const deadlines = await withLockTimeout(apiDb, async (tx) => {
        const read = async () =>
          (await tx.execute<{ d: string }>(sql`select to_char(public.appeal_deadline('2027-08-30T23:30:00Z'::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as d`))[0]!.d;
        // 30 August, 23:30 UTC, is already the 31st at +14 and still the 30th at -7: a deadline computed in the session's zone
        // would differ between the two, and from UTC's 29 February.
        await tx.execute(sql`set local time zone 'Pacific/Kiritimati'`);
        const east = await read();
        await tx.execute(sql`set local time zone 'America/Los_Angeles'`);
        return [east, await read()];
      });
      expect(deadlines).toEqual(["2028-02-29T23:30:00.000Z", "2028-02-29T23:30:00.000Z"]);
    });
  });

  describe("the forced columns ignore what an insert supplies", () => {
    test("a case starts open, in lane 2, at number 0, whatever the insert said, for the API role and for the migrator", async () => {
      for (const db of [apiDb, migrateDb]) {
        await rolledBack(db, async (tx) => {
          const targetId = randomUUID();
          const [row] = await tx.execute<Record<string, unknown>>(sql`
            insert into cases (target_type, target_id, opened_at, lane, intake_seq, answered_seq, state_version, oldest_open_at, last_decided_at, closed_at)
            values ('post', ${targetId}::uuid, '2001-01-01T00:00:00Z', 0, 7, 7, 9, '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')
            returning *, (opened_at = now()) as opened_now`);
          expect(row).toMatchObject({ target_type: "post", target_id: targetId, lane: 2, intake_seq: 0, answered_seq: 0, state_version: 0, oldest_open_at: null, last_decided_at: null, closed_at: null, opened_now: true });
        });
      }
    });

    test("an intake's times and receipt: pending for a contact, or for a signed-in reporter alleging illegality, else none", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const insert = (input: IntakeInput) =>
          tx.execute<{ receipt: string; receipt_sent_at: string | null; erased_at: string | null; now: boolean }>(sql`
            insert into intakes (kind, ref, lookup_hash, channel, reporter_id, contact_id, rule_id, alleges_illegal, csam, category, explanation, bona_fide, received_at, receipt, receipt_sent_at, erased_at)
            values ('user', ${newRef()}, ${input.lookupHash ?? null}, ${input.channel ?? "signed_in"}::intake_channel, ${input.reporterId ?? null}::uuid, ${input.contactId ?? null}::uuid, ${input.ruleId ?? null},
                    ${input.allegesIllegal ?? false}, ${input.csam ?? false}, ${input.category ?? TC}, ${input.explanation ?? null}, ${input.bonaFide ?? false},
                    '2001-01-01T00:00:00Z', 'sent', '2001-01-01T00:00:00Z', null)
            returning receipt, receipt_sent_at, erased_at, (received_at = now()) as now`);
        const cases: [string, IntakeInput, string][] = [
          ["a rule report", { reporterId: ada.id, ruleId: "R1" }, "none"],
          ["a signed-in notice of illegality", { reporterId: ada.id, allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true }, "pending"],
          ["a signed-out notice with a contact", { channel: "signed_out", contactId: randomUUID(), lookupHash: hex64(), allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true }, "pending"],
          ["a signed-out rule report without a contact", { channel: "signed_out", lookupHash: hex64(), ruleId: "R3" }, "none"],
          ["a CSAM notice", { channel: "signed_out", lookupHash: hex64(), csam: true, allegesIllegal: true, category: MINORS }, "none"],
        ];
        for (const [label, input, receipt] of cases) {
          const [row] = await insert(input);
          expect(row, label).toEqual({ receipt, receipt_sent_at: null, erased_at: null, now: true });
        }
      });
    });

    test("a staff text is born unconfirmed, and a snapshot is taken at the transaction's start, to the millisecond", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const caseId = await openCase(tx, "post", postId);
        const salt = hex64();
        const [text] = await tx.execute<Record<string, unknown>>(sql`
          insert into staff_texts (case_id, author_id, kind, text, salt, digest, created_at, decision_id, confirmed_at)
          values (${caseId}::uuid, ${ada.id}::uuid, 'note', 'a note', ${salt}, ${await textDigest(salt, "a note")}, '2001-01-01T00:00:00Z', null, '2001-01-01T00:00:00Z')
          returning decision_id, confirmed_at, (created_at = now()) as now`);
        expect(text).toEqual({ decision_id: null, confirmed_at: null, now: true });

        const [snapshot] = await tx.execute<Record<string, unknown>>(sql`
          insert into evidence_snapshots (case_id, target_type, target_id, taken_at, author_handle, body, salt, digest)
          values (${caseId}::uuid, 'post', ${postId}::uuid, '2001-01-01T00:00:00.123456Z', ${ada.handle}, 'a post', ${hex64()}, ${hex64()})
          returning (taken_at = date_trunc('milliseconds', now())) as at_start, (taken_at = date_trunc('milliseconds', taken_at)) as whole_ms`);
        expect(snapshot).toEqual({ at_start: true, whole_ms: true });

        const [access] = await tx.execute<Record<string, unknown>>(sql`
          insert into case_access_log (staff_id, case_id, kind, at) values (${ada.id}::uuid, ${caseId}::uuid, 'case_opened', '2001-01-01T00:00:00Z') returning (at = now()) as now`);
        expect(access).toEqual({ now: true });
      });
    });

    test("an image row is born visible, unheld and unerased, for the API role and for the migrator", async () => {
      for (const db of [apiDb, migrateDb]) {
        await rolledBack(db, async (tx) => {
          const ada = await profile(tx);
          const [row] = await tx.execute<Record<string, unknown>>(
            sql`insert into post_media (owner_id, status, moderation_state, hold_until, erased_at) values (${ada.id}::uuid, 'processing', 'sealed', 'infinity', now()) returning moderation_state, hold_until, erased_at`,
          );
          expect(row).toEqual({ moderation_state: "visible", hold_until: null, erased_at: null });
        });
      }
    });

    test("a hold is born unreleased, held from the transaction's start", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const mediaId = await newImageRow(tx, ada.id, postId);
        const caseId = await openCase(tx, "post", postId);
        const [hold] = await tx.execute<Record<string, unknown>>(sql`
          insert into media_holds (media_id, case_id, held_at, released_at) values (${mediaId}::uuid, ${caseId}::uuid, '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')
          returning released_at, (held_at = now()) as now`);
        expect(hold).toEqual({ released_at: null, now: true });
      });
    });
  });

  describe("the checks of intakes", () => {
    /** One test's intakes, all in a transaction that is rolled back: each insert in a savepoint, its refusal's message or null. */
    const intakes = (fn: (refusal: (input: IntakeInput) => Promise<string | null>, ada: { id: string }) => Promise<void>) =>
      rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        await fn(async (input) => (await within(tx, (sp) => insertIntake(sp, input)))?.message ?? null, ada);
      });

    test("a ground is needed: a rule, an allegation of illegality or the CSAM path", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ reporterId: ada.id })).toMatch(/intakes_has_ground/);
        expect(await refusal({ reporterId: ada.id, ruleId: "R7" })).toMatch(/intakes_rule_id/);
        expect(await refusal({ reporterId: ada.id, ruleId: "R1" })).toBeNull();
      });
    });

    test("a notice of illegality carries its explanation and its good-faith statement; the CSAM path needs neither", async () => {
      await intakes(async (refusal, ada) => {
        const illegal = { reporterId: ada.id, allegesIllegal: true, category: SPEECH };
        expect(await refusal({ ...illegal })).toMatch(/intakes_illegal_elements/);
        expect(await refusal({ ...illegal, explanation: "why" })).toMatch(/intakes_illegal_elements/);
        expect(await refusal({ ...illegal, bonaFide: true })).toMatch(/intakes_illegal_elements/);
        expect(await refusal({ ...illegal, explanation: "why", bonaFide: true })).toBeNull();
        // A CSAM intake alleges illegality with neither, and with no keyword (the "abuse" choice) or one of the three.
        const csam = { channel: "signed_out" as const, csam: true, allegesIllegal: true, category: MINORS };
        expect(await refusal({ ...csam, lookupHash: hex64() })).toBeNull();
        expect(await refusal({ ...csam, lookupHash: hex64(), categoryKeyword: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS" })).toBeNull();
        expect(await refusal({ ...csam, lookupHash: hex64(), categoryKeyword: "KEYWORD_TERRORIST_CONTENT" })).toMatch(/intakes_category_keyword/);
      });
    });

    test("the CSAM path stores no account and no contact, and is always about the protection of minors", async () => {
      await intakes(async (refusal, ada) => {
        const csam = { csam: true, allegesIllegal: true, category: MINORS };
        expect(await refusal({ ...csam, channel: "signed_in", reporterId: ada.id, lookupHash: hex64() })).toMatch(/intakes_csam/);
        expect(await refusal({ ...csam, channel: "signed_out", contactId: randomUUID(), lookupHash: hex64() })).toMatch(/intakes_csam/);
        expect(await refusal({ ...csam, channel: "signed_out", category: SPEECH, lookupHash: hex64() })).toMatch(/intakes_csam/);
        // Signed in, it still stores no account: the channel is kept, the reporter is not, and the token's hash is needed.
        expect(await refusal({ ...csam, channel: "signed_in", lookupHash: hex64() })).toBeNull();
        expect(await refusal({ ...csam, channel: "signed_in" })).toMatch(/intakes_lookup/);
      });
    });

    test("a user never reports under R2, signed in or out; a moderator's finding may cite it", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ reporterId: ada.id, ruleId: "R2" })).toMatch(/intakes_r2_finding_only/);
        expect(await refusal({ channel: "signed_out", lookupHash: hex64(), ruleId: "R2" })).toMatch(/intakes_r2_finding_only/);
        expect(await refusal({ kind: "finding", channel: "staff", findingBy: ada.id, ruleId: "R2", category: MINORS })).toBeNull();
      });
    });

    test("a finding names its finder, comes through the staff channel and never alleges illegality", async () => {
      await intakes(async (refusal, ada) => {
        const finding = { kind: "finding" as const, channel: "staff" as const, findingBy: ada.id, ruleId: "R3" };
        expect(await refusal(finding)).toBeNull();
        expect(await refusal({ ...finding, allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true })).toMatch(/intakes_finding_legal/);
        expect(await refusal({ ...finding, findingBy: null })).toMatch(/intakes_finding/);
        expect(await refusal({ ...finding, channel: "signed_in" })).toMatch(/intakes_finding/);
        expect(await refusal({ kind: "user", channel: "staff", ruleId: "R3" })).toMatch(/intakes_finding/);
        expect(await refusal({ kind: "user", channel: "signed_in", findingBy: ada.id, ruleId: "R3" })).toMatch(/intakes_finding/);
      });
    });

    test("a contact belongs to a signed-out notice, a reporter to a signed-in one, and a token's hash to a signed-out or CSAM one", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ channel: "signed_in", reporterId: ada.id, contactId: randomUUID(), ruleId: "R1" })).toMatch(/intakes_contact_signed_out/);
        expect(await refusal({ channel: "signed_out", reporterId: ada.id, lookupHash: hex64(), ruleId: "R1" })).toMatch(/intakes_reporter_signed_in/);
        expect(await refusal({ channel: "signed_out", ruleId: "R1" })).toMatch(/intakes_lookup/);
        expect(await refusal({ channel: "signed_in", reporterId: ada.id, lookupHash: hex64(), ruleId: "R1" })).toMatch(/intakes_lookup/);
        const hash = hex64();
        expect(await refusal({ channel: "signed_out", lookupHash: hash, ruleId: "R1" })).toBeNull();
        expect(await refusal({ channel: "signed_out", lookupHash: hash, ruleId: "R1" })).toMatch(/intakes_lookup_hash_unique/);
      });
    });

    test("the category is one of the 16, never the terms-and-conditions one on an allegation of illegality; the texts are bounded; the reference has its form", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ reporterId: ada.id, ruleId: "R1", category: "STATEMENT_CATEGORY_PORNOGRAPHY_OR_SEXUALIZED_CONTENT" })).toMatch(/intakes_category/);
        expect(await refusal({ reporterId: ada.id, allegesIllegal: true, category: TC, explanation: "why", bonaFide: true })).toMatch(/intakes_illegal_not_tc/);
        const illegal = { reporterId: ada.id, allegesIllegal: true, category: SPEECH, bonaFide: true };
        expect(await refusal({ ...illegal, explanation: "x".repeat(2000), citedLaw: "y".repeat(300) })).toBeNull();
        expect(await refusal({ ...illegal, explanation: "x".repeat(2001) })).toMatch(/intakes_explanation_len/);
        expect(await refusal({ ...illegal, explanation: "why", citedLaw: "y".repeat(301) })).toMatch(/intakes_cited_law_len/);
        for (const ref of ["N-ABCDEFGH2", "n-ABCDEFGHJ2", "N-abcdefghj2", "N-ABCDEFGH01", "N-ABCDEFGHJ23", "X-ABCDEFGHJ2"]) expect(await refusal({ reporterId: ada.id, ruleId: "R1", ref }), ref).toMatch(/intakes_ref/);
        const ref = newRef();
        expect(await refusal({ reporterId: ada.id, ruleId: "R1", ref })).toBeNull();
        expect(await refusal({ reporterId: ada.id, ruleId: "R1", ref })).toMatch(/intakes_ref_unique/);
      });
    });
  });

  describe("the staff_texts CHECK", () => {
    type Save = (text: string | null, salt: string | null, digest: string, erased?: boolean) => Promise<{ message: string; code: string } | null>;
    /** One test's texts on a case of their own, in a transaction that is rolled back; each insert in a savepoint. */
    const texts = (fn: (save: Save, tx: DbTx) => Promise<void>) =>
      rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const caseId = await openCase(tx, "post", await newPostRow(tx, ada.id));
        const save: Save = (text, salt, digest, erased = false) =>
          run(tx, sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest, erased_at) values (${caseId}::uuid, ${ada.id}::uuid, 'facts', ${text}, ${salt}, ${digest}, ${erased ? sql`now()` : sql`null`})`);
        await fn(save, tx);
      });

    test.each(TEXT_DIGEST_VECTORS.map((vector) => [vector.name, vector] as const))("%s: SQL computes the digest the contracts' textDigest computes", async (_name, vector) => {
      expect(await sqlDigest(apiDb, vector.salt, vector.text)).toBe(vector.digest);
    });

    test("a text is stored with the digest the contracts compute for its salt and itself, and with no other", async () => {
      await texts(async (save) => {
        // Fresh salts: a digest names one text, so a vector's own digest could be stored only once.
        for (const vector of TEXT_DIGEST_VECTORS) {
          const salt = hex64();
          const digest = await textDigest(salt, vector.text);
          expect(await save(vector.text, salt, digest), vector.name).toBeNull();
          // The same text under the digest of another salt, or of another text, is refused.
          expect((await save(vector.text, hex64(), digest))?.message, vector.name).toMatch(/staff_texts_digest/);
          expect((await save(`${vector.text}.`, salt, digest))?.message, vector.name).toMatch(/staff_texts_digest/);
        }
      });
    });

    test("a digest names one text; a text has a salt; only an erased row has neither", async () => {
      await texts(async (save) => {
        const salt = hex64();
        const digest = await textDigest(salt, "a text");
        expect(await save("a text", salt, digest)).toBeNull();
        expect((await save("a text", salt, digest))?.message).toMatch(/staff_texts_digest_unique/);
        expect((await save("a text", null, hex64()))?.message).toMatch(/staff_texts_digest/);
        expect((await save(null, hex64(), hex64()))?.message).toMatch(/staff_texts_digest/);
        expect((await save(null, null, hex64()))?.message).toMatch(/staff_texts_digest/);
        expect((await save("a text", hex64(), hex64(), true))?.message).toMatch(/staff_texts_digest/);
        // The erased form: text and salt gone, the digest kept.
        expect(await save(null, null, hex64(), true)).toBeNull();
      });
    });

    test("the salt is 32 bytes as lower-case hex: an empty, a short or an upper-case salt is refused, also with the digest it gives", async () => {
      await texts(async (save, tx) => {
        const salt = hex64();
        // hex decodes either case to the same bytes, so the upper-case spelling has the lower-case salt's digest.
        const upper = salt.toUpperCase();
        expect(await sqlDigest(tx, upper, "a text")).toBe(await textDigest(salt, "a text"));
        for (const malformed of ["", salt.slice(2), upper, `${salt}00`]) {
          const err = await save("a text", malformed, await sqlDigest(tx, malformed, "a text"));
          expect(err, JSON.stringify(malformed)).toMatchObject({ code: "23514", message: expect.stringMatching(/staff_texts_digest/) });
        }
        expect(await save("a text", salt, await textDigest(salt, "a text"))).toBeNull();
      });
    });

    test("a text longer than 5000 characters is refused whatever its digest", async () => {
      await texts(async (save, tx) => {
        const salt = hex64();
        const long = "x".repeat(5001);
        expect((await save(long, salt, await sqlDigest(tx, salt, long)))?.message).toMatch(/staff_texts_text_len/);
      });
    });
  });

  test("a decision's keyword needs the ground of the law: on a decision without a ground, or on a rule, it is refused", async () => {
    // No code of Task 1 writes a decision, so the row is the fixture's, as the migrator, in a transaction that is rolled back.
    await rolledBack(migrateDb, async (tx) => {
      const [author, staff] = [await profile(tx), await profile(tx)];
      const postId = await newPostRow(tx, author.id);
      const decisionId = await fabricateDecision(tx, { caseId: await openCase(tx, "post", postId), targetType: "post", targetId: postId, staffId: staff.id });
      const keyword = DECISION_KEYWORDS[0];
      const set = (changes: ReturnType<typeof sql>) => run(tx, sql`update decisions set ${changes} where id = ${decisionId}::uuid`);
      const refused = { code: "23514", message: expect.stringMatching(/decisions_keyword/) };
      // A null ground is the row a plain comparison let through: its result is null, and a check passes on a null.
      expect(await set(sql`category_keyword = ${keyword}`)).toMatchObject(refused);
      expect(await set(sql`category_keyword = ${keyword}, ground = 'incompatible', rule_id = 'R1'`)).toMatchObject(refused);
      expect(await set(sql`category_keyword = ${keyword}, ground = 'illegal', legal_reference_digest = ${hex64()}`)).toBeNull();
    });
  });

  test("the limits' row is the migration's: 60 decisions an hour and 300 a day, 400 case opens, 50 findings and 10 reveals a day", async () => {
    // The suite's setup leaves this table alone, so the row read here is the one migration 0015 inserted.
    const rows = await apiDb.execute<Record<string, unknown>>(sql`select id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits`);
    expect(rows.map((row) => ({ ...row }))).toEqual([{ id: 1, decisions_per_hour: 60, decisions_per_day: 300, case_opens_per_day: 400, findings_per_day: 50, reveals_per_day: 10 }]);
    await rolledBack(migrateDb, async (tx) => {
      const err = await run(tx, sql`insert into moderation_limits (id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day, updated_at) values (2, 1, 1, 1, 1, 1, now())`);
      expect(err?.message).toMatch(/moderation_limits_single_row/);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Create `packages/contracts/test/canonical.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "../src/canonical";

// The canonical writer and the hash helpers moved out of staff.ts, which the step-up action's tests (staff.test.ts) still
// cover through stepUpActionText and stepUpActionHash. These hold the module's own exports, which moderation.ts uses too.
describe("the canonical JSON writer", () => {
  const BS = String.fromCharCode(92);

  test("sorts the keys of every object, keeps the order of arrays and writes no whitespace", () => {
    expect(sortedJson({ b: [3, { z: 1, a: null }, "x"], a: true, "": -1 })).toBe('{"":-1,"a":true,"b":[3,{"a":null,"z":1},"x"]}');
    expect(sortedJson([])).toBe("[]");
    expect(sortedJson({})).toBe("{}");
    expect(sortedJson(null)).toBe("null");
  });

  test("writes strings and numbers as JSON.stringify writes them", () => {
    const text = `q"${BS}${String.fromCharCode(10)}${String.fromCharCode(0xe9)}`;
    expect(sortedJson(text)).toBe(JSON.stringify(text));
    expect(sortedJson(0.5)).toBe("0.5");
    expect(sortedJson(-0)).toBe("0");
  });

  test("refuses what JSON cannot carry rather than dropping or changing it", () => {
    for (const value of [undefined, Number.NaN, Number.NEGATIVE_INFINITY, () => 1, BigInt(1), new Date(0), [undefined], { a: undefined }, new Map()]) {
      expect(() => sortedJson(value), String(typeof value)).toThrow(TypeError);
    }
  });
});

describe("the hash helpers", () => {
  test("utf8 gives a text's UTF-8 bytes", () => {
    expect(Array.from(utf8("a"))).toEqual([0x61]);
    // e with an acute accent is two bytes; a character outside the basic plane is four.
    expect(Array.from(utf8(String.fromCharCode(0xe9)))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8(String.fromCodePoint(0x1f600)))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  test("hex writes each byte as two lower-case digits", () => {
    expect(hex(new Uint8Array([0, 1, 0x0a, 0xab, 0xff]))).toBe("00010aabff");
    expect(hex(new Uint8Array())).toBe("");
  });

  test("sha256 hashes a text's UTF-8 bytes, and sha256Bytes the bytes it is given", async () => {
    const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(hex(await sha256("abc"))).toBe(ABC);
    expect(hex(await sha256Bytes(new Uint8Array([0x61, 0x62, 0x63])))).toBe(ABC);
    expect(await sha256("abc")).toHaveLength(32);
  });
});
```

### Create `packages/contracts/test/digest-vectors.ts`

```ts
/**
 * Texts with their salts and their digests, shared by the contracts' textDigest test and the database's CHECK test
 * (apps/api/test/integration/moderation-schema.test.ts), so that Node, the browser and SQL are held to the same values.
 * The digests were computed with Python's hashlib when the vectors were written: the lower-case hex sha256 of the bytes
 * of "korbat.text.v1", a line feed, the salt's 32 bytes and the text's UTF-8 bytes. Characters outside ASCII are built
 * from their code points, never typed.
 */
const LF = String.fromCharCode(10);
/** U+1F600, outside the basic plane: two UTF-16 units, four UTF-8 bytes. */
const GRINNING = String.fromCodePoint(0x1f600);

export interface TextDigestVector {
  name: string;
  /** 32 bytes as 64 lower-case hex characters. */
  salt: string;
  text: string;
  digest: string;
}

export const TEXT_DIGEST_VECTORS: readonly TextDigestVector[] = [
  { name: "plain text", salt: "a1".repeat(32), text: "The post offers a counterfeit product for sale.", digest: "e427a70be6f10c970e16b353b327d84898d924672fb0f73d1a55b7b709fe7959" },
  { name: "an empty text", salt: "00".repeat(32), text: "", digest: "4b0f918d0b6cd2ee642138a8114716ff591fe2e396f4b827c98553ae71aa69c2" },
  {
    name: "a text with line feeds",
    salt: "0f".repeat(32),
    text: `First line.${LF}Second line.${LF}${LF}After a blank line.`,
    digest: "46dc7d07d46e0f2898a45c559356d0206f1888d10a2ffe96b3442c568ef63567",
  },
  {
    // Latin with an accent, two Han characters, a Cyrillic word, then a c with caron and a sharp s.
    name: "a text outside ASCII",
    salt: "c3".repeat(32),
    text: `Caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0x4e2d, 0x6587)} ${String.fromCharCode(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442)} ${String.fromCharCode(0x10d, 0xdf)}`,
    digest: "7da28392d94768f9a29ddbe0bfded1c50869b3117b5a909a9ad32b6ed6b746fb",
  },
  {
    // A face and a flag (two regional indicators): three characters outside the basic plane.
    name: "a text with emoji",
    salt: "5e".repeat(32),
    text: `Threat ${GRINNING} ${String.fromCodePoint(0x1f1e9, 0x1f1ea)} end`,
    digest: "0bb325c3a0982a535becb15b5a9fee173a7a1db0c9aff5d897865dec99318942",
  },
  {
    // 5000 UTF-16 units, the bound of a staff text: 4998 letters and one character of two units.
    name: "the longest text",
    salt: "ff".repeat(32),
    text: "x".repeat(4998) + GRINNING,
    digest: "462d06627152b99e106da6bd67798a336e81f6b7b8737db50b3c3dbebfa0185d",
  },
];
```

### Create `packages/contracts/test/moderation.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  ACTION_KINDS,
  APPEAL_MONTHS,
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  DECISION_KEYWORDS,
  MEASURES,
  NOTICE_LIMITS,
  RETENTION,
  RULE_DEFAULT_CATEGORY,
  RULE_IDS,
  SEAL_LIST_MAX,
  SNAPSHOT_DIGEST_TAG,
  SUSPECT_EARLIER_MONTHS,
  TDB_CATEGORIES,
  TDB_FORM_CATEGORIES,
  TEXT_DIGEST_TAG,
  appealDeadline,
  laneFor,
  snapshotDigest,
  snapshotText,
  textDigest,
  type ActionKind,
  type SnapshotDigestInput,
  type TdbCategory,
} from "../src/index";
import { TEXT_DIGEST_VECTORS } from "./digest-vectors";

const LF = String.fromCharCode(10);
const GRINNING = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);

describe("the Transparency Database's values", () => {
  test("there are 16 categories, as the database was read on 2026-10-02", () => {
    expect(TDB_CATEGORIES).toEqual([
      "STATEMENT_CATEGORY_ANIMAL_WELFARE",
      "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
      "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
      "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
      "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
      "STATEMENT_CATEGORY_SELF_HARM",
      "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
      "STATEMENT_CATEGORY_VIOLENCE",
    ]);
    expect(new Set(TDB_CATEGORIES).size).toBe(16);
  });

  test("the illegal-ground form shows 14 of them: not the terms-and-conditions category, and not 'not specified'", () => {
    expect(TDB_FORM_CATEGORIES).toHaveLength(14);
    expect(TDB_FORM_CATEGORIES).toEqual(TDB_CATEGORIES.filter((c) => c !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && c !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"));
  });

  test("the CSAM path's four choices map to the three keywords, and 'abuse' to none", () => {
    expect(CSAM_KEYWORDS).toEqual({
      csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
      deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
      grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
      abuse: null,
    });
    expect(Object.keys(CSAM_KEYWORDS)).toEqual(["csam", "deepfake", "grooming", "abuse"]);
  });

  test("a decision on the law may carry one keyword: terrorist content", () => {
    expect(DECISION_KEYWORDS).toEqual(["KEYWORD_TERRORIST_CONTENT"]);
  });

  test("each rule has its default category", () => {
    expect(RULE_IDS).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    expect(RULE_DEFAULT_CATEGORY).toEqual({
      R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      R5: "STATEMENT_CATEGORY_VIOLENCE",
      R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    });
    for (const category of Object.values(RULE_DEFAULT_CATEGORY)) expect(TDB_CATEGORIES).toContain(category);
  });
});

describe("laneFor", () => {
  const TC: TdbCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";

  test("a rule report takes its rule's lane: R2 and R5 are urgent, R3 and R4 next, R1 and R6 last", () => {
    const lanes = RULE_IDS.map((ruleId) => laneFor({ ruleId, allegesIllegal: false, csam: false, category: TC }));
    expect(lanes).toEqual([2, 0, 1, 1, 0, 2]);
  });

  test("the CSAM path is lane 0 whatever else the intake says", () => {
    expect(laneFor({ ruleId: null, allegesIllegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toBe(0);
    expect(laneFor({ ruleId: null, allegesIllegal: false, csam: true, category: TC })).toBe(0);
  });

  test("a notice of illegality takes its category's lane, for every category", () => {
    const urgent = ["STATEMENT_CATEGORY_VIOLENCE", "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", "STATEMENT_CATEGORY_SELF_HARM"];
    const next = [
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
    ];
    for (const category of TDB_CATEGORIES) {
      const expected = urgent.includes(category) ? 0 : next.includes(category) ? 1 : 2;
      expect(laneFor({ ruleId: null, allegesIllegal: true, csam: false, category }), category).toBe(expected);
    }
  });

  test("a notice of illegality that also cites a rule takes the more severe of the two lanes", () => {
    // Fraud (lane 2) under R5 (lane 0), and violence (lane 0) under R1 (lane 2): both are urgent.
    expect(laneFor({ ruleId: "R5", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(0);
    expect(laneFor({ ruleId: "R1", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_VIOLENCE" })).toBe(0);
    expect(laneFor({ ruleId: "R3", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(1);
    expect(laneFor({ ruleId: "R6", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_ANIMAL_WELFARE" })).toBe(2);
  });

  test("where nothing is alleged to be illegal, the category is korbat's own classification and moves no lane", () => {
    for (const category of TDB_CATEGORIES) {
      expect(laneFor({ ruleId: "R1", allegesIllegal: false, csam: false, category }), category).toBe(2);
      expect(laneFor({ ruleId: "R3", allegesIllegal: false, csam: false, category }), category).toBe(1);
    }
  });
});

describe("limits and periods", () => {
  test("the notice limits: per network signed out, per account signed in, ten targets, and the two text bounds", () => {
    expect(NOTICE_LIMITS).toEqual({ signedOut: { perHour: 5, perDay: 20 }, signedIn: { perHour: 10, perDay: 50 }, maxTargets: 10, explanationMax: 2000, citedLawMax: 300 });
  });

  test("a notice on the CSAM path names at most one account; a seal's list shows 500 rows; earlier answers count for 12 months", () => {
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(SEAL_LIST_MAX).toBe(500);
    expect(SUSPECT_EARLIER_MONTHS).toBe(12);
  });

  test("six months to appeal or to ask for a re-examination, five of each a day", () => {
    expect(APPEAL_MONTHS).toBe(6);
    expect(DAILY_LIMITS).toEqual({ appeals: 5, reexaminations: 5 });
  });

  test("the retention periods of the design's table", () => {
    expect(RETENTION).toEqual({
      r4FinalMonths: 6,
      intakeDays: 30,
      resetValueDays: 30,
      evidenceHours: 24,
      statementMonths: 12,
      accessLogMonths: 12,
      contactMonths: 6,
      contactMaxMonths: 13,
      confirmationDays: 30,
      backupDays: 30,
      draftHours: 24,
      mailGiveUpDays: 5,
    });
    // Content restricted under R4 goes when its restriction is final: the appeal's window.
    expect(RETENTION.r4FinalMonths).toBe(APPEAL_MONTHS);
  });
});

describe("the measures", () => {
  const kinds = Object.keys(MEASURES) as ActionKind[];
  const measures = kinds.filter((kind) => MEASURES[kind].lifts === null);
  const reversals = kinds.filter((kind) => MEASURES[kind].lifts !== null);

  test("every action kind has an entry: the seven measures, then the five reversals", () => {
    expect(kinds).toEqual([
      "withhold",
      "remove",
      "seal_media",
      "withhold_media",
      "remove_media",
      "reset_display_name",
      "reset_bio",
      "restore",
      "unseal_media",
      "restore_media",
      "restore_display_name",
      "restore_bio",
    ]);
    expect(ACTION_KINDS).toEqual(kinds);
    expect(measures).toEqual(kinds.slice(0, 7));
    expect(reversals).toEqual(kinds.slice(7));
  });

  test("a post or one image is withheld only while deciding and removed only when the case is decided; a seal and a reset are either", () => {
    const when = (kind: ActionKind) => [MEASURES[kind].interim, MEASURES[kind].final];
    expect(when("withhold")).toEqual([true, false]);
    expect(when("withhold_media")).toEqual([true, false]);
    expect(when("remove")).toEqual([false, true]);
    expect(when("remove_media")).toEqual([false, true]);
    for (const kind of ["seal_media", "reset_display_name", "reset_bio"] as const) expect(when(kind), kind).toEqual([true, true]);
    // A reversal is neither: which decision may hold one is the reversed measure's matter.
    for (const kind of reversals) expect(when(kind), kind).toEqual([false, false]);
  });

  test("each measure has its target, and each reversal lifts the measures of its own target", () => {
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].target]))).toEqual({
      withhold: "post",
      remove: "post",
      seal_media: "images",
      withhold_media: "image",
      remove_media: "image",
      reset_display_name: "display_name",
      reset_bio: "bio",
      restore: "post",
      unseal_media: "images",
      restore_media: "image",
      restore_display_name: "display_name",
      restore_bio: "bio",
    });
    expect(Object.fromEntries(reversals.map((kind) => [kind, MEASURES[kind].lifts]))).toEqual({
      restore: ["withhold", "remove"],
      unseal_media: ["seal_media"],
      restore_media: ["withhold_media", "remove_media"],
      restore_display_name: ["reset_display_name"],
      restore_bio: ["reset_bio"],
    });
    // Every measure can be lifted, by exactly one kind of reversal.
    for (const measure of measures) expect(reversals.filter((kind) => (MEASURES[kind].lifts as readonly ActionKind[]).includes(measure)), measure).toHaveLength(1);
  });

  test("each has a label of its own: the composer's words where the composer names the measure", () => {
    // The first seven and "Lift the seal" are the words of the decision composer; the composer, the statement and the
    // terms all take them from here.
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].label]))).toEqual({
      withhold: "Withhold the post",
      remove: "Remove",
      seal_media: "Seal the images this case reaches",
      withhold_media: "Withhold one image",
      remove_media: "Remove one image",
      reset_display_name: "Reset display name",
      reset_bio: "Reset bio",
      restore: "Lift the restriction of the post",
      unseal_media: "Lift the seal",
      restore_media: "Lift the restriction of one image",
      restore_display_name: "Lift the reset of the display name",
      restore_bio: "Lift the reset of the bio",
    });
    const labels = kinds.map((kind) => MEASURES[kind].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("textDigest", () => {
  test("the tag names the version of the rule", () => {
    expect(TEXT_DIGEST_TAG).toBe("korbat.text.v1");
  });

  test.each(TEXT_DIGEST_VECTORS.map((vector) => [vector.name, vector] as const))("%s: the sha256 of the tag, a line feed, the salt's bytes and the text's UTF-8 bytes", async (_name, vector) => {
    expect(await textDigest(vector.salt, vector.text)).toBe(vector.digest);
  });

  test("the longest vector is 5000 UTF-16 units, and the vectors hold a line feed, a character outside ASCII and one outside the basic plane", () => {
    expect(Math.max(...TEXT_DIGEST_VECTORS.map((vector) => vector.text.length))).toBe(5000);
    const all = TEXT_DIGEST_VECTORS.map((vector) => vector.text).join("");
    expect(all).toContain(LF);
    expect(all).toContain(E_ACUTE);
    expect(all).toContain(GRINNING);
  });

  test("another salt or another text gives another digest", async () => {
    const digests = await Promise.all([textDigest("a1".repeat(32), "one"), textDigest("a2".repeat(32), "one"), textDigest("a1".repeat(32), "one "), textDigest("a1".repeat(32), "One")]);
    expect(new Set(digests).size).toBe(4);
  });

  test("a salt that is not 32 bytes of lower-case hex is refused, never padded or folded", async () => {
    for (const salt of ["", "a1".repeat(31), "a1".repeat(33), "A1".repeat(32), "g1".repeat(32), ` ${"a1".repeat(32)}`]) {
      await expect(textDigest(salt, "text"), JSON.stringify(salt)).rejects.toThrow(TypeError);
    }
  });

  test("a text with a lone surrogate, which has no UTF-8 bytes, is refused rather than hashed as something else", async () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xde00);
    for (const text of [high, low, `a${high}b`, `${low}${high}`]) await expect(textDigest("a1".repeat(32), text)).rejects.toThrow(TypeError);
    // The pair itself is a character.
    await expect(textDigest("a1".repeat(32), `${high}${low}`)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("snapshotText and snapshotDigest", () => {
  const post: SnapshotDigestInput = {
    salt: "ab".repeat(32),
    targetType: "post",
    targetId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    takenAt: "2026-10-03T10:00:00.123Z",
    authorHandle: "ada",
    postState: "visible",
    postCreatedAt: "2026-10-01T08:30:00.000Z",
    replyToId: null,
    quoteOfId: "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36",
    body: `Line one${LF}caf${E_ACUTE} ${GRINNING}`,
    media: [
      { id: "11111111-2222-4333-8444-555555555555", alt: "A cat", width: 1200, height: 800 },
      { id: "66666666-7777-4888-9999-aaaaaaaaaaaa", alt: null, width: 640, height: 480 },
    ],
    displayName: null,
    bio: null,
    handle: null,
  };
  const account: SnapshotDigestInput = {
    salt: "cd".repeat(32),
    targetType: "account",
    targetId: "8a3c7f0e-1111-4222-8333-944445555666",
    takenAt: "2026-10-03T10:00:00.000Z",
    authorHandle: "bob",
    postState: null,
    postCreatedAt: null,
    replyToId: null,
    quoteOfId: null,
    body: null,
    media: null,
    displayName: `Bob ${GRINNING}`,
    bio: "",
    handle: "bob",
  };
  const BS = String.fromCharCode(92);
  // The texts and the digests below were computed with Python's json and hashlib when they were written.
  const POST_TEXT =
    `{"authorHandle":"ada","bio":null,"body":"Line one${BS}ncaf${E_ACUTE} ${GRINNING}","displayName":null,"handle":null,` +
    `"media":[{"alt":"A cat","height":800,"id":"11111111-2222-4333-8444-555555555555","width":1200},{"alt":null,"height":480,"id":"66666666-7777-4888-9999-aaaaaaaaaaaa","width":640}],` +
    `"postCreatedAt":"2026-10-01T08:30:00.000Z","postState":"visible","quoteOfId":"7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36","replyToId":null,` +
    `"salt":"${"ab".repeat(32)}","takenAt":"2026-10-03T10:00:00.123Z","targetId":"3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a","targetType":"post","v":1}`;
  const POST_DIGEST = "cb995d11ed14e3c4e555c187d319a86506b263e98f924f59f2f7d5231a3bc6e6";
  const ACCOUNT_DIGEST = "41019b2a47d4ebad37cc8c5ad25f8d79a7232c4e3e705231f9e9ba1e02fb1f26";

  test("the tag names the version of the rule", () => {
    expect(SNAPSHOT_DIGEST_TAG).toBe("korbat.snapshot.v1");
  });

  test("the text is the sorted JSON of version 1 and the snapshot's fifteen members", () => {
    expect(snapshotText(post)).toBe(POST_TEXT);
    const parsed = JSON.parse(snapshotText(account)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["authorHandle", "bio", "body", "displayName", "handle", "media", "postCreatedAt", "postState", "quoteOfId", "replyToId", "salt", "takenAt", "targetId", "targetType", "v"]);
    expect(parsed).toEqual({ v: 1, ...account });
  });

  test("the digest is the sha256 of the tag, a line feed and that text", async () => {
    expect(await snapshotDigest(post)).toBe(POST_DIGEST);
    expect(await snapshotDigest(account)).toBe(ACCOUNT_DIGEST);
  });

  test("it round-trips the snapshot answer's JSON, whatever order and whatever else the answer carries", async () => {
    // As the console receives it: parsed from JSON, with members the digest does not cover, in another order.
    const sent = {
      id: "9d0f5e3c-0000-4000-8000-000000000001",
      digest: POST_DIGEST,
      withheld: false,
      erasedAt: null,
      ...Object.fromEntries(Object.entries(post).reverse()),
      media: post.media!.map((image) => ({ height: image.height, width: image.width, note: "never part of a snapshot", alt: image.alt, id: image.id })),
    };
    const answer = JSON.parse(JSON.stringify(sent)) as SnapshotDigestInput;
    expect(snapshotText(answer)).toBe(POST_TEXT);
    expect(await snapshotDigest(answer)).toBe(POST_DIGEST);
  });

  test("any member that changes gives another digest", async () => {
    const changed: SnapshotDigestInput[] = [
      { ...post, salt: "ac".repeat(32) },
      { ...post, takenAt: "2026-10-03T10:00:00.124Z" },
      { ...post, body: `${post.body} ` },
      { ...post, postState: "withheld" },
      { ...post, quoteOfId: null },
      { ...post, media: [post.media![1]!, post.media![0]!] },
      { ...post, media: [{ ...post.media![0]!, alt: "A dog" }, post.media![1]!] },
      { ...post, authorHandle: "adb" },
    ];
    const digests = await Promise.all([post, ...changed].map(snapshotDigest));
    expect(new Set(digests).size).toBe(changed.length + 1);
  });

  test("a time that is not the UTC string toISOString writes, to the millisecond, is refused", () => {
    for (const takenAt of ["2026-10-03T10:00:00Z", "2026-10-03T10:00:00.123456Z", "2026-10-03T12:00:00.123+02:00", "2026-10-03 10:00:00.123Z", ""]) {
      expect(() => snapshotText({ ...post, takenAt }), takenAt).toThrow(TypeError);
    }
    expect(() => snapshotText({ ...post, postCreatedAt: "2026-10-01T08:30:00Z" })).toThrow(TypeError);
    expect(snapshotText({ ...post, takenAt: new Date(Date.UTC(2026, 9, 3, 10, 0, 0, 123)).toISOString() })).toBe(POST_TEXT);
  });
});

describe("appealDeadline", () => {
  const at = (iso: string) => new Date(iso);
  const deadline = (iso: string) => appealDeadline(at(iso)).toISOString();

  test("six calendar months later, at the same UTC time", () => {
    expect(deadline("2026-10-03T10:15:30.250Z")).toBe("2027-04-03T10:15:30.250Z");
    expect(deadline("2026-01-15T00:00:00.000Z")).toBe("2026-07-15T00:00:00.000Z");
    expect(deadline("2026-07-01T23:59:59.999Z")).toBe("2027-01-01T23:59:59.999Z");
  });

  test("a day the sixth month lacks becomes that month's last day", () => {
    // 31 August plus six months is the end of February: the 28th, or the 29th in a leap year.
    expect(deadline("2026-08-31T12:00:00.000Z")).toBe("2027-02-28T12:00:00.000Z");
    expect(deadline("2027-08-31T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-30T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-29T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2026-03-31T08:00:00.000Z")).toBe("2026-09-30T08:00:00.000Z");
    expect(deadline("2026-05-31T08:00:00.000Z")).toBe("2026-11-30T08:00:00.000Z");
    expect(deadline("2026-10-31T08:00:00.000Z")).toBe("2027-04-30T08:00:00.000Z");
    expect(deadline("2026-12-31T08:00:00.000Z")).toBe("2027-06-30T08:00:00.000Z");
    // A leap day itself moves to 29 August: August has the day.
    expect(deadline("2028-02-29T08:00:00.000Z")).toBe("2028-08-29T08:00:00.000Z");
  });

  test("it is computed in UTC: the last instants of a UTC month stay on that month's side", () => {
    expect(deadline("2026-08-31T23:59:59.999Z")).toBe("2027-02-28T23:59:59.999Z");
    expect(deadline("2026-09-01T00:00:00.000Z")).toBe("2027-03-01T00:00:00.000Z");
  });

  test("it leaves its argument as it was", () => {
    const informed = at("2026-08-31T12:00:00.000Z");
    appealDeadline(informed);
    expect(informed.toISOString()).toBe("2026-08-31T12:00:00.000Z");
  });
});
```

### Replace `apps/api/test/integration/global-setup.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { closeDb, createDb } from "@korbat/db";
import { assertTestTargets, loadTestEnv } from "./test-env";

/**
 * Runs once before the integration suites. Every run starts from an empty test database and an
 * empty Redis database, so suites never depend on what an earlier run left behind.
 */
export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  assertTestTargets(env);

  const redis = new Redis(env.REDIS_URL!, { maxRetriesPerRequest: 2 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  // The migrate role owns every table, so it may truncate them. Names come from the catalog, quoted. One table is left as
  // it is: moderation_limits holds a single row that migration 0015 inserts and nothing in the API writes, and no table
  // refers to it, so the row a suite reads there is the migration's own.
  const db = createDb(env.DATABASE_URL_MIGRATE!, { max: 1 });
  try {
    const tables = await db.execute<{ name: string }>(
      sql`select quote_ident(schemaname) || '.' || quote_ident(tablename) as name from pg_tables
           where schemaname in ('public', 'auth') and not (schemaname = 'public' and tablename = 'moderation_limits') order by 1`,
    );
    if (tables.length === 0) throw new Error("The test database has no tables. Run `node scripts/test-db.mjs`.");
    await db.execute(sql.raw(`truncate table ${tables.map((table) => table.name).join(", ")} restart identity cascade`));
    // The truncate emptied audit_head too. The chain's trigger never creates the head (an insert without one fails), so the
    // run starts from the head of an empty log: place 0 and 64 zeros, as migration 0012 leaves it on a database without rows.
    await db.execute(sql`insert into public.audit_head (id, seq, hash) values (1, 0, repeat('0', 64))`);
  } finally {
    await closeDb(db);
  }
}
```

### Replace `apps/api/test/social/visibility.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { postState } from "@korbat/db";
import { postAccess, tombstone, type StoredPostState } from "../../src/social/visibility";

const author = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const post = (state: StoredPostState) => ({ authorId: author, state });

describe("post visibility", () => {
  test("a visible post is shown to everyone who is not blocked", () => {
    for (const viewer of [null, other, author]) expect(postAccess(viewer, post("visible"), false), String(viewer)).toBe("shown");
  });
  test("withheld and removed posts are shown only to their author", () => {
    for (const state of ["withheld", "removed"] as const) {
      expect(postAccess(author, post(state), false), state).toBe("shown");
      expect(postAccess(other, post(state), false), state).toBe("hidden");
      expect(postAccess(null, post(state), false), state).toBe("hidden");
    }
  });
  test("a deleted post is a deleted tombstone for everyone, the author included", () => {
    for (const viewer of [null, other, author]) expect(postAccess(viewer, post("deleted_by_author"), false), String(viewer)).toBe("deleted");
    expect(tombstone("x", "deleted")).toEqual({ id: "x", deleted: true });
  });
  test("a block in either direction hides everything, even the reason a post is gone", () => {
    for (const state of ["visible", "withheld", "removed", "deleted_by_author"] as const) {
      expect(postAccess(other, post(state), true), state).toBe("hidden");
    }
    expect(tombstone("x", "hidden")).toEqual({ id: "x", unavailable: true });
  });
  test("the reader decides every state the database stores", () => {
    // The four states above are all of post_state: a seal is a state of images, and no reader of posts learns a new state.
    expect([...postState.enumValues].sort()).toEqual(["deleted_by_author", "removed", "visible", "withheld"]);
  });
  test("a state the reader does not know is hidden from everyone, its author included", () => {
    // What a value added to the database's enum would be for code that was not told about it: never shown.
    const unknown = { authorId: author, state: "sealed" as StoredPostState };
    for (const viewer of [null, other, author]) expect(postAccess(viewer, unknown, false), String(viewer)).toBe("hidden");
  });
});
```

### Replace `packages/contracts/test/media.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  ALT_MAX_LENGTH,
  AltText,
  MEDIA_ACCEPTED_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_POST,
  MediaAttachment,
  MediaErrorCode,
  MediaFailure,
  MediaStatusResponse,
  MediaView,
  PostView,
  UploadResponse,
  altLength,
  mediaPath,
  normalizeAltText,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("limits and codes", () => {
  test("the numbers the API and the composer share", () => {
    expect(MEDIA_MAX_BYTES).toBe(20_971_520);
    expect(MEDIA_MAX_PER_POST).toBe(4);
    expect(ALT_MAX_LENGTH).toBe(1000);
    expect([...MEDIA_ACCEPTED_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
  });

  test("error codes and failure reasons", () => {
    expect(MediaErrorCode.options).toEqual(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
    expect(MediaFailure.options).toEqual(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
  });

  test("image paths end in .webp, which is what a CDN caches by default", () => {
    expect(mediaPath(id(7), "small")).toBe(`/api/media/${id(7)}/small.webp`);
    expect(mediaPath(id(7), "large")).toBe(`/api/media/${id(7)}/large.webp`);
  });
});

describe("alt text", () => {
  test("normalization: NFC, every run of whitespace to one space, trimmed", () => {
    expect(normalizeAltText("  a  red\tbarn\r\n\r\nat dusk ")).toBe("a red barn at dusk");
    expect(normalizeAltText("e\u0301")).toBe("\u00e9");
  });

  test("a description is required", () => {
    expect(AltText.safeParse("").success).toBe(false);
    expect(AltText.safeParse(" \n\t ").success).toBe(false);
    expect(AltText.parse(" a cat ")).toBe("a cat");
  });

  test("length is counted in code points after normalization", () => {
    const astral = "\u{1F600}";
    expect(altLength(astral.repeat(3))).toBe(3);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH)).success).toBe(true);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH + 1)).success).toBe(false);
    expect(AltText.safeParse(`${"a".repeat(ALT_MAX_LENGTH)}   `).success).toBe(true);
  });

  test("control characters are refused, including ones JavaScript does not count as whitespace", () => {
    expect(AltText.safeParse("a\u0000b").success).toBe(false);
    expect(AltText.safeParse("a\u0085b").success).toBe(false);
    expect(AltText.safeParse("a\u001bb").success).toBe(false);
  });

  test("media ids are canonical: any spelling of a UUID becomes its lowercase form", () => {
    expect(MediaAttachment.parse({ id: id(10).toUpperCase().replace("0000000A", "0000000a"), alt: "x" }).id).toBe(id(10));
    expect(MediaAttachment.parse({ id: "3F2A9C1E-8B7D-4E6F-A5C4-0123456789AB", alt: "x" }).id).toBe("3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab");
  });

  test("an attachment is an upload id and a description", () => {
    expect(MediaAttachment.parse({ id: id(1), alt: "  a   cat " })).toEqual({ id: id(1), alt: "a cat" });
    expect(MediaAttachment.safeParse({ id: "nope", alt: "a cat" }).success).toBe(false);
    expect(MediaAttachment.safeParse({ id: id(1) }).success).toBe(false);
  });
});

describe("upload and status responses", () => {
  test("an upload starts as processing", () => {
    expect(UploadResponse.parse({ id: id(1), status: "processing" })).toEqual({ id: id(1), status: "processing" });
    expect(UploadResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
  });

  test("each status carries exactly what it needs", () => {
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "processing" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
    // A sealed image is ready and shown to nobody: its status carries the size and no blurhash, which is made from the image.
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536 }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536, blurhash: "short" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 0, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "animated_not_supported" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "because" }).success).toBe(false);
  });
});

describe("images on posts", () => {
  const image = { id: id(9), width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3", alt: "a cat", small: mediaPath(id(9), "small"), large: mediaPath(id(9), "large") };
  const post = {
    id: id(2),
    author: { id: id(1), handle: "ada", displayName: "Ada", verified: false },
    body: "",
    createdAt: "2026-09-18T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    quoteOf: null,
  };

  test("a media view has dimensions, a placeholder, a description and both paths", () => {
    expect(MediaView.parse(image)).toEqual(image);
    expect(MediaView.safeParse({ ...image, blurhash: "" }).success).toBe(false);
    expect(MediaView.safeParse({ ...image, large: undefined }).success).toBe(false);
  });

  test("every post view has a media list, and a post may consist of images only", () => {
    expect(PostView.parse({ ...post, media: [image] }).media).toEqual([image]);
    expect(PostView.parse({ ...post, body: "text", media: [] }).media).toEqual([]);
    expect(PostView.safeParse(post).success).toBe(false);
  });

  test("a quoted post carries its images too", () => {
    const quoted = { ...post, id: id(3), media: [image] };
    const parsed = PostView.parse({ ...post, body: "look", media: [], quoteOf: quoted });
    expect(parsed.quoteOf).toMatchObject({ media: [image] });
  });
});
```

### Replace `packages/db/test/schema.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { is, type SQL } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig, pgTable } from "drizzle-orm/pg-core";
import { apiRole, authRole, bytea, xid8 } from "../src/schema/helpers";
import * as schema from "../src/schema/index";

const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
const byName = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

describe("auth schema", () => {
  test("auth tables live in the auth schema", () => {
    for (const name of ["users", "devices", "sessions", "email_codes", "passkeys", "auth_events"]) {
      expect(byName.get(name)?.schema, name).toBe("auth");
    }
  });
  test("sessions store only a hash id and carry both expiries", () => {
    const cols = byName.get("sessions")!.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "user_id", "device_id", "expires_at", "absolute_expires_at", "reauth_at", "revoked_at"]));
  });
});

describe("row level security", () => {
  test("every table has RLS enabled and at least one policy", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      expect(cfg.enableRLS, cfg.name).toBe(true);
      expect(cfg.policies.length, cfg.name).toBeGreaterThan(0);
    }
  });
});

describe("content schema", () => {
  test("posts carry a state enum and a body length check", () => {
    const cfg = byName.get("posts")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.find((c) => c.name === "state")?.notNull).toBe(true);
    expect(cfg.checks.map((c) => c.name)).toContain("posts_body_len");
  });
  test("join tables have composite primary keys", () => {
    for (const name of ["follows", "likes", "reposts", "bookmarks", "blocks", "mutes"]) {
      expect(byName.get(name)!.primaryKeys.length, name).toBe(1);
      expect(byName.get(name)!.primaryKeys[0]!.columns.length, name).toBe(2);
    }
  });
});

describe("trust and safety schema", () => {
  test("there are 39 tables in total", () => {
    // 28 before 3c, minus the five retired tables, plus the twelve moderation tables and the four auth tables.
    expect(tables.length).toBe(39);
  });
  test("the tables 3c retired are gone, with their enums and the reputation column", () => {
    for (const name of ["reports", "strikes", "transparency_log"]) expect(byName.has(name), name).toBe(false);
    for (const name of ["targetType", "reportStatus", "caseAction", "appealStatus", "reports", "strikes", "transparencyLog"]) {
      expect(Object.keys(schema), name).not.toContain(name);
    }
    expect(byName.get("profiles")!.columns.map((c) => c.name)).not.toContain("reputation");
  });
  test("audit_log policies allow only insert and select", () => {
    const kinds = byName.get("audit_log")!.policies.map((p) => p.for).sort();
    expect(kinds).toEqual(["insert", "select"]);
  });
});

describe("identity and auth 1a", () => {
  test("users carry role, age, terms, onboarding and TOTP replay columns", () => {
    const cols = byName.get("users")!.columns;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["role", "age_confirmed_at", "terms_version", "terms_accepted_at", "onboarded_at", "password_changed_at", "totp_last_step"]),
    );
    expect(cols.find((c) => c.name === "role")?.notNull).toBe(true);
  });
  test("email codes are bound to a unique flow id", () => {
    const cfg = byName.get("email_codes")!;
    expect(cfg.columns.find((c) => c.name === "flow_id")?.notNull).toBe(true);
    expect(cfg.indexes.find((i) => i.config.name === "email_codes_flow_idx")?.config.unique).toBe(true);
  });
  test("auth_events policies allow only insert and select", () => {
    expect(byName.get("auth_events")?.policies.map((p) => p.for).sort()).toEqual(["insert", "select"]);
  });
  test("email code purposes include reauth", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("reauth");
  });
});

describe("posting and feed 2a", () => {
  test("posts and profiles carry non-negative counters, and posts a deletion time", () => {
    const posts = byName.get("posts")!;
    const postCols = posts.columns.map((c) => c.name);
    expect(postCols).toEqual(expect.arrayContaining(["like_count", "repost_count", "reply_count", "quote_count", "deleted_at"]));
    for (const name of ["like_count", "repost_count", "reply_count", "quote_count"]) {
      expect(posts.columns.find((c) => c.name === name)?.notNull, name).toBe(true);
    }
    expect(posts.checks.map((c) => c.name)).toContain("posts_counts_nonnegative");
    const profiles = byName.get("profiles")!;
    expect(profiles.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["follower_count", "following_count", "post_count"]));
    expect(profiles.checks.map((c) => c.name)).toContain("profiles_counts_nonnegative");
  });
  test("per-account engagement lists and quote lookups have indexes", () => {
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const idx = byName.get(name)!.indexes.find((i) => i.config.name === `${name}_user_created_idx`);
      expect(idx?.config.columns.length, name).toBe(2);
    }
    expect(byName.get("posts")!.indexes.map((i) => i.config.name)).toContain("posts_quote_of_idx");
  });
});

describe("images 2b", () => {
  test("post_media has no path column, and its attachment and dimension columns are optional", () => {
    const cols = byName.get("post_media")!.columns;
    expect(cols.map((c) => c.name)).not.toContain("path");
    for (const name of ["post_id", "position", "width", "height", "blurhash"]) {
      expect(cols.find((c) => c.name === name)?.notNull, name).toBe(false);
    }
  });
  test("every upload has an owner, a status and a creation time; a failure has a reason", () => {
    const cols = byName.get("post_media")!.columns;
    for (const name of ["owner_id", "status", "created_at"]) expect(cols.find((c) => c.name === name)?.notNull, name).toBe(true);
    expect(cols.find((c) => c.name === "error")?.notNull).toBe(false);
    expect(cols.find((c) => c.name === "status")?.default).toBe("processing");
    expect(schema.mediaStatus.enumValues).toEqual(["processing", "ready", "failed"]);
  });
  test("the database itself refuses a ready image without dimensions and an attached image that is incomplete", () => {
    const cfg = byName.get("post_media")!;
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(["post_media_alt_len", "post_media_attached_is_complete", "post_media_ready_has_dims"]);
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual(["post_media_owner_created_idx", "post_media_post_position_idx", "post_media_status_created_idx"]);
    expect(cfg.indexes.find((i) => i.config.name === "post_media_post_position_idx")?.config.unique).toBe(true);
  });
});

describe("account lifecycle 1b", () => {
  test("handle_history reserves every lowercase handle a profile ever had, and goes with the profile", () => {
    const cfg = byName.get("handle_history")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(cfg.columns.map((c) => c.name)).toEqual(["handle_lower", "profile_id", "changed_at"]);
    expect(cfg.columns.find((c) => c.name === "handle_lower")?.primary).toBe(true);
    expect(cfg.columns.find((c) => c.name === "profile_id")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.notNull).toBe(true);
    expect(cfg.columns.find((c) => c.name === "changed_at")?.hasDefault).toBe(true);
    const fk = cfg.foreignKeys.map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));
    expect(fk).toEqual([{ table: "profiles", columns: ["id"], onDelete: "cascade" }]);
    expect(cfg.policies.map((p) => [p.name, p.for])).toEqual([["handle_history_api_all", "all"]]);
  });
  test("profiles record when the handle last changed; users record when their purge finished", () => {
    const handleChangedAt = byName.get("profiles")!.columns.find((c) => c.name === "handle_changed_at");
    expect(handleChangedAt).toBeDefined();
    expect(handleChangedAt?.notNull).toBe(false);
    const purgedAt = byName.get("users")!.columns.find((c) => c.name === "purged_at");
    expect(purgedAt).toBeDefined();
    expect(purgedAt?.notNull).toBe(false);
  });
  test("one phone per account: a unique index on phone_hash that leaves out the accounts without one", () => {
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_phone_hash_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["phone_hash"]);
    expect(idx?.config.where).toBeDefined();
  });
  test("email codes can be for deleting the account, and every account event of 1b has a type", () => {
    expect(schema.emailCodePurpose.enumValues).toContain("delete_account");
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("not_me"), values.indexOf("account_deleted") + 1)).toEqual([
      "not_me",
      "profile_updated",
      "handle_changed",
      "email_changed",
      "badge_verified",
      "badge_removed",
      "export_created",
      "account_deleted",
    ]);
  });
});

describe("passkeys 1c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** The foreign keys of one local column: the table and columns they point at and what a delete there does. */
  const foreignKeys = (table: string, name: string) =>
    byName
      .get(table)!
      .foreignKeys.filter((k) => k.reference().columns.some((c) => c.name === name))
      .map((k) => ({ table: getTableConfig(k.reference().foreignTable).name, columns: k.reference().foreignColumns.map((c) => c.name), onDelete: k.onDelete }));

  test("bytea is the bytea SQL type and hands Buffers both ways", () => {
    const table = pgTable("bytea_probe", { value: bytea("value") });
    const probe = getTableConfig(table).columns[0]!;
    expect(probe.getSQLType()).toBe("bytea");
    const bytes = Buffer.from([0, 1, 254, 255]);
    expect(probe.mapToDriverValue(bytes)).toEqual(bytes);
    // postgres.js already parses bytea into a Buffer; a driver that answers a plain Uint8Array gets one too.
    const read = probe.mapFromDriverValue(new Uint8Array([0, 1, 254, 255]));
    expect(Buffer.isBuffer(read)).toBe(true);
    expect(read).toEqual(bytes);
    expect(probe.mapFromDriverValue(bytes)).toEqual(bytes);
  });

  test("users carry an optional WebAuthn user handle in bytea, unique among the accounts that have one", () => {
    const handle = column("users", "webauthn_user_id");
    expect(handle?.getSQLType()).toBe("bytea");
    expect(handle?.notNull).toBe(false);
    expect(handle?.hasDefault).toBe(false);
    const idx = byName.get("users")!.indexes.find((i) => i.config.name === "users_webauthn_user_id_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["webauthn_user_id"]);
    expect(idx?.config.where).toBeDefined();
  });

  test("passkeys record the AAGUID, the backup and verification flags, the creating device and a suspected copy", () => {
    expect(column("passkeys", "aaguid")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "aaguid")?.notNull).toBe(false);
    for (const name of ["backup_eligible", "uv_initialized"]) {
      expect(column("passkeys", name)?.getSQLType(), name).toBe("boolean");
      expect(column("passkeys", name)?.notNull, name).toBe(true);
      expect(column("passkeys", name)?.default, name).toBe(false);
    }
    expect(column("passkeys", "created_device_id")?.getSQLType()).toBe("uuid");
    expect(column("passkeys", "created_device_id")?.notNull).toBe(false);
    expect(foreignKeys("passkeys", "created_device_id")).toEqual([{ table: "devices", columns: ["id"], onDelete: "set null" }]);
    expect(column("passkeys", "suspect_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("passkeys", "suspect_at")?.notNull).toBe(false);
    // One row per credential: the index the foundation created stays.
    const idx = byName.get("passkeys")!.indexes.find((i) => i.config.name === "passkeys_credential_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["credential_id"]);
  });

  test("sessions carry a random handle that is unique, the factors they proved and the passkey that started them", () => {
    const handle = column("sessions", "handle");
    expect(handle?.getSQLType()).toBe("uuid");
    expect(handle?.notNull).toBe(true);
    expect(handle?.hasDefault).toBe(true);
    const idx = byName.get("sessions")!.indexes.find((i) => i.config.name === "sessions_handle_idx");
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => (c as { name?: string }).name)).toEqual(["handle"]);
    const factors = column("sessions", "factors");
    expect(factors?.getSQLType()).toBe("jsonb");
    expect(factors?.notNull).toBe(true);
    expect(factors?.hasDefault).toBe(true);
    expect(column("sessions", "passkey_id")?.notNull).toBe(false);
    expect(foreignKeys("sessions", "passkey_id")).toEqual([{ table: "passkeys", columns: ["id"], onDelete: "set null" }]);
  });

  test("adding, removing and a counter regression of a passkey are security events", () => {
    const values = schema.authEventType.enumValues;
    // The slice ends at 1c's last value: 3a appends the staff events after it.
    expect(values.slice(values.indexOf("account_deleted"), values.indexOf("passkey_counter_regression") + 1)).toEqual([
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_counter_regression",
    ]);
  });
});

describe("explore 2c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  /** Every foreign key of a table by its local column: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  const indexColumns = (config: { columns: unknown[] }) => config.columns.map((c) => (c as { name?: string }).name);

  test("profiles carry the author's Explore switch, on by default", () => {
    const flag = column("profiles", "show_in_explore");
    expect(flag?.getSQLType()).toBe("boolean");
    expect(flag?.notNull).toBe(true);
    expect(flag?.default).toBe(true);
  });

  test("explore_runs numbers each ranking with an identity and records its time, formula, counts and duration", () => {
    const cfg = byName.get("explore_runs")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(shape("explore_runs")).toEqual([
      ["generation", "integer", true],
      ["as_of", "timestamp with time zone", true],
      ["formula", "smallint", true],
      ["candidates", "integer", true],
      ["items", "integer", true],
      ["took_ms", "integer", true],
    ]);
    const generation = column("explore_runs", "generation");
    expect(generation?.primary).toBe(true);
    // Always generated: an insert cannot choose its generation, so the numbers come from the sequence alone.
    expect(generation?.generatedIdentity?.type).toBe("always");
    // The refresh writes every other value itself, the refresh time included, which tests move.
    expect(cfg.columns.filter((c) => c.hasDefault).map((c) => c.name)).toEqual(["generation"]);
    expect(cfg.foreignKeys).toEqual([]);
  });

  test("explore_items holds a ranking's posts by position, each post once, and goes with its ranking, its post or its author", () => {
    const cfg = byName.get("explore_items")!;
    expect(cfg.schema).toBeUndefined(); // public
    // No score or count is stored: the position is the order.
    expect(shape("explore_items")).toEqual([
      ["generation", "integer", true],
      ["position", "integer", true],
      ["post_id", "uuid", true],
      ["author_id", "uuid", true],
    ]);
    expect(cfg.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["generation", "position"]]);
    expect(cfg.indexes.map((i) => [i.config.name, indexColumns(i.config), i.config.unique])).toEqual([["explore_items_generation_post_idx", ["generation", "post_id"], true]]);
    expect(foreignKeys("explore_items")).toEqual({
      generation: { table: "explore_runs", columns: ["generation"], onDelete: "cascade" },
      post_id: { table: "posts", columns: ["id"], onDelete: "cascade" },
      author_id: { table: "profiles", columns: ["id"], onDelete: "cascade" },
    });
  });

  test("both tables have row level security and one full-access policy for the API role", () => {
    // The loop under "row level security" covers them too; this pins the policy each one has.
    for (const name of ["explore_runs", "explore_items"]) {
      const cfg = byName.get(name)!;
      expect(cfg.enableRLS, name).toBe(true);
      expect(cfg.policies.map((p) => [p.name, p.for, p.to]), name).toEqual([[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("likes and reposts have a BRIN index on created_at for the refresh's window; bookmarks, which Explore never reads, has none", () => {
    for (const name of ["likes", "reposts"]) {
      const brin = byName.get(name)!.indexes.filter((i) => i.config.method === "brin");
      expect(brin.map((i) => [i.config.name, indexColumns(i.config), i.config.unique, i.config.where]), name).toEqual([[`${name}_created_brin`, ["created_at"], false, undefined]]);
    }
    expect(byName.get("bookmarks")!.indexes.filter((i) => i.config.method === "brin")).toEqual([]);
    // The factory's other indexes stay the same on all three tables.
    for (const name of ["likes", "reposts", "bookmarks"]) {
      const others = byName.get(name)!.indexes.filter((i) => i.config.method !== "brin");
      expect(others.map((i) => [i.config.name, i.config.method]).sort(), name).toEqual([
        [`${name}_post_idx`, "btree"],
        [`${name}_user_created_idx`, "btree"],
      ]);
    }
  });
});

describe("staff console 3a", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  /** Every foreign key of a table by its local columns: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  /** Every index as its name, its columns and whether it is unique, by name. */
  const indexes = (table: string) =>
    byName
      .get(table)!
      .indexes.map((i) => [i.config.name, i.config.columns.map((c) => (c as { name?: string }).name), i.config.unique])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const uniques = (table: string) => byName.get(table)!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name)]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);

  test("the seven staff events close the auth event type, after 1c's passkey events", () => {
    const values = schema.authEventType.enumValues;
    expect(values.slice(values.indexOf("passkey_counter_regression") + 1)).toEqual([
      "staff_enrollment_issued",
      "staff_key_added",
      "staff_key_revoked",
      "staff_key_counter_regression",
      "staff_sign_in",
      "staff_signed_out",
      "staff_session_revoked",
    ]);
  });

  test("the three staff tables live in the auth schema, with row level security and one policy for the auth role", () => {
    for (const name of ["staff_keys", "staff_enrollments", "staff_sessions"]) {
      const cfg = byName.get(name)!;
      expect(cfg.schema, name).toBe("auth");
      expect(cfg.enableRLS, name).toBe(true);
      expect(policies(name), name).toEqual([[`${name}_auth_all`, "all", authRole]]);
    }
  });

  test("a staff key records its credential, its origin and relying party ID, its dates and whether it was revoked or suspect", () => {
    expect(shape("staff_keys")).toEqual([
      ["id", "uuid", true],
      ["user_id", "uuid", true],
      ["credential_id", "text", true],
      ["public_key", "text", true],
      ["counter", "bigint", true],
      ["transports", "text[]", true],
      ["name", "text", true],
      ["aaguid", "uuid", false],
      ["origin", "text", true],
      ["rp_id", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["last_used_at", "timestamp with time zone", false],
      ["revoked_at", "timestamp with time zone", false],
      ["suspect_at", "timestamp with time zone", false],
    ]);
    // No user handle of its own: staff registrations use the account's webauthn_user_id.
    expect(column("staff_keys", "user_handle")).toBeUndefined();
    // The development cleaner deletes accounts as the superuser; a key must stop that delete, never go with it.
    expect(foreignKeys("staff_keys")).toEqual({ user_id: { table: "users", columns: ["id"], onDelete: "restrict" } });
    expect(indexes("staff_keys")).toEqual([
      ["staff_keys_credential_idx", ["credential_id"], true],
      ["staff_keys_user_idx", ["user_id"], false],
    ]);
    // The pair the staff sessions' foreign key names.
    expect(uniques("staff_keys")).toEqual([["staff_keys_id_user_id_unique", ["id", "user_id"]]]);
    expect(checks("staff_keys")).toEqual(["staff_keys_suspect_is_revoked"]);
  });

  test("an enrolment keeps only its token's hash, the console it was issued for, its expiry and when it was used", () => {
    expect(shape("staff_enrollments")).toEqual([
      ["id", "uuid", true],
      ["user_id", "uuid", true],
      ["token_hash", "text", true],
      ["origin", "text", true],
      ["rp_id", "text", true],
      ["created_at", "timestamp with time zone", true],
      ["expires_at", "timestamp with time zone", true],
      ["used_at", "timestamp with time zone", false],
    ]);
    expect(foreignKeys("staff_enrollments")).toEqual({ user_id: { table: "users", columns: ["id"], onDelete: "cascade" } });
    expect(indexes("staff_enrollments")).toEqual([
      ["staff_enrollments_token_hash_idx", ["token_hash"], true],
      ["staff_enrollments_user_idx", ["user_id"], false],
    ]);
  });

  test("a staff session keeps its token's hash, a unique handle, its key and account together, both expiries and the browser label", () => {
    expect(shape("staff_sessions")).toEqual([
      ["id", "text", true],
      ["handle", "uuid", true],
      ["user_id", "uuid", true],
      ["key_id", "uuid", true],
      ["created_at", "timestamp with time zone", true],
      ["last_used_at", "timestamp with time zone", true],
      ["idle_expires_at", "timestamp with time zone", true],
      ["absolute_expires_at", "timestamp with time zone", true],
      ["revoked_at", "timestamp with time zone", false],
      ["browser", "text", true],
    ]);
    expect(column("staff_sessions", "id")?.primary).toBe(true);
    expect(column("staff_sessions", "handle")?.hasDefault).toBe(true);
    // The key's foreign key names the account as well, so a session's key always belongs to its account.
    expect(foreignKeys("staff_sessions")).toEqual({
      user_id: { table: "users", columns: ["id"], onDelete: "cascade" },
      "key_id,user_id": { table: "staff_keys", columns: ["id", "user_id"], onDelete: "cascade" },
    });
    expect(indexes("staff_sessions")).toEqual([
      ["staff_sessions_handle_idx", ["handle"], true],
      ["staff_sessions_user_idx", ["user_id"], false],
    ]);
    expect(checks("staff_sessions")).toEqual(["staff_sessions_lifetime"]);
  });

  test("audit_log gains the staff session's handle, the key, the action's hash and the step-up, all optional", () => {
    const added = [
      ["staff_session", "uuid"],
      ["key_id", "uuid"],
      ["action_hash", "text"],
      ["step_up", "jsonb"],
    ] as const;
    for (const [name, type] of added) {
      expect(column("audit_log", name)?.getSQLType(), name).toBe(type);
      expect(column("audit_log", name)?.notNull, name).toBe(false);
      expect(column("audit_log", name)?.hasDefault, name).toBe(false);
    }
    expect(checks("audit_log")).toEqual(["audit_log_step_up_complete"]);
  });

  test("audit_log's chain columns are not null, with placeholder defaults that the trigger always overwrites", () => {
    const chain = [
      ["chain_version", "smallint", 0],
      ["chain_seq", "bigint", 0],
      ["prev_hash", "text", ""],
      ["hash", "text", ""],
    ] as const;
    for (const [name, type, placeholder] of chain) {
      expect(column("audit_log", name)?.getSQLType(), name).toBe(type);
      expect(column("audit_log", name)?.notNull, name).toBe(true);
      expect(column("audit_log", name)?.default, name).toBe(placeholder);
    }
    // One index serves the viewer and audit-verify; there is none on (created_at, id).
    expect(indexes("audit_log")).toEqual([["audit_log_chain_seq_idx", ["chain_seq"], true]]);
  });

  test("audit_head holds one row, the newest place and hash, which the API role may only read", () => {
    const cfg = byName.get("audit_head")!;
    expect(cfg.schema).toBeUndefined(); // public
    expect(shape("audit_head")).toEqual([
      ["id", "smallint", true],
      ["seq", "bigint", true],
      ["hash", "text", true],
    ]);
    expect(column("audit_head", "id")?.primary).toBe(true);
    expect(cfg.columns.filter((c) => c.hasDefault)).toEqual([]);
    expect(checks("audit_head")).toEqual(["audit_head_single_row"]);
    expect(cfg.enableRLS).toBe(true);
    expect(policies("audit_head")).toEqual([["audit_head_api_select", "select", apiRole]]);
  });
});

describe("moderation cases 3c", () => {
  const column = (table: string, name: string) => byName.get(table)!.columns.find((c) => c.name === name);
  /** Name, SQL type and not-null of every column, in order. */
  const shape = (table: string) => byName.get(table)!.columns.map((c) => [c.name, c.getSQLType(), c.notNull]);
  const checks = (table: string) => byName.get(table)!.checks.map((c) => c.name).sort();
  const policies = (table: string) => byName.get(table)!.policies.map((p) => [p.name, p.for, p.to]);
  const index = (table: string, name: string) => byName.get(table)!.indexes.find((i) => i.config.name === name)?.config;
  const indexColumns = (config: { columns: unknown[] } | undefined) => config?.columns.map((c) => (c as { name?: string }).name);
  /** An index's predicate as the SQL the migration holds. */
  const predicate = (config: { where?: SQL } | undefined) => (config?.where ? new PgDialect().sqlToQuery(config.where).sql : undefined);
  /** Every foreign key of a table by its local columns: the table and columns it points at and what a delete there does. */
  const foreignKeys = (table: string) =>
    Object.fromEntries(
      byName.get(table)!.foreignKeys.map((k) => {
        const ref = k.reference();
        return [ref.columns.map((c) => c.name).join(","), { table: getTableConfig(ref.foreignTable).name, columns: ref.foreignColumns.map((c) => c.name), onDelete: k.onDelete }];
      }),
    );
  /** The columns declared unique by themselves, each with the name of its constraint. */
  const uniques = (table: string) =>
    byName
      .get(table)!
      .columns.filter((c) => c.isUnique)
      .map((c) => [c.uniqueName, [c.name]])
      .sort();

  /** A check's expression as the migration holds it. */
  const checkSql = (table: string, name: string) => new PgDialect().sqlToQuery(byName.get(table)!.checks.find((c) => c.name === name)!.value).sql;

  const MODERATION_TABLES = ["cases", "intakes", "intake_items", "decisions", "decision_actions", "seal_posts", "appeals", "staff_texts", "evidence_snapshots", "case_access_log", "moderation_limits", "media_holds"];
  const AUTH_TABLES = ["notifier_contacts", "notifier_confirmations", "notifier_suppressions", "staff_personal_accounts"];

  test("the twelve moderation tables are public, with row level security and one policy for the API role", () => {
    for (const name of MODERATION_TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBeUndefined(); // public
      expect(cfg!.enableRLS, name).toBe(true);
      // The grants do the restricting (migration 0015); moderation_limits is read only, so its one policy is a SELECT one.
      expect(policies(name), name).toEqual(name === "moderation_limits" ? [["moderation_limits_api_select", "select", apiRole]] : [[`${name}_api_all`, "all", apiRole]]);
    }
  });

  test("no moderation table has a column named like an email or an address", () => {
    for (const name of MODERATION_TABLES) {
      for (const c of byName.get(name)!.columns) expect(c.name, `${name}.${c.name}`).not.toMatch(/email|address/i);
    }
  });

  test("xid8 is the xid8 SQL type and hands the transaction id over as a string", () => {
    const table = pgTable("xid8_probe", { value: xid8("value") });
    const probe = getTableConfig(table).columns[0]!;
    expect(probe.getSQLType()).toBe("xid8");
    // A 64-bit counter: a string keeps every digit, where a JavaScript number would not.
    expect(probe.mapFromDriverValue("18446744073709551615")).toBe("18446744073709551615");
    expect(probe.mapToDriverValue("773")).toBe("773");
  });

  test("one open case a target: the partial unique index, the queue's index and the target's index", () => {
    const open = index("cases", "cases_one_open_per_target");
    expect(open?.unique).toBe(true);
    expect(indexColumns(open)).toEqual(["target_type", "target_id"]);
    expect(predicate(open)).toBe("closed_at is null");
    const queue = index("cases", "cases_queue_idx");
    expect(queue?.unique).toBe(false);
    expect(indexColumns(queue)).toEqual(["lane", "oldest_open_at"]);
    expect(predicate(queue)).toBe("closed_at is null");
    expect(indexColumns(index("cases", "cases_target_idx"))).toEqual(["target_type", "target_id", "opened_at"]);
    expect(checks("cases")).toEqual(["cases_closed_answered", "cases_lane", "cases_seq_order"]);
    expect(column("cases", "id")?.hasDefault).toBe(true);
    // No foreign key on the target: it names two tables.
    expect(foreignKeys("cases")).toEqual({});
  });

  test("an item's partial unique indexes: one target a notice, one re-examination an item, one item per reporter, case and ground", () => {
    const target = index("intake_items", "intake_items_target_once");
    expect(target?.unique).toBe(true);
    expect(indexColumns(target)).toEqual(["intake_id", "target_type", "target_id"]);
    expect(predicate(target)).toBe("reexamines_item_id is null");

    const reexamines = index("intake_items", "intake_items_reexamines_once");
    expect(reexamines?.unique).toBe(true);
    expect(indexColumns(reexamines)).toEqual(["reexamines_item_id"]);
    expect(predicate(reexamines)).toBe("reexamines_item_id is not null");

    const reporter = index("intake_items", "intake_items_reporter_once");
    expect(reporter?.unique).toBe(true);
    expect(indexColumns(reporter)).toEqual(["case_id", "reporter_account_id", "alleges_illegal"]);
    expect(predicate(reporter)).toBe("reexamines_item_id is null");

    const seq = index("intake_items", "intake_items_case_seq_idx");
    expect(seq?.unique).toBe(true);
    expect(indexColumns(seq)).toEqual(["case_id", "seq"]);
    expect(seq?.where).toBeUndefined();

    // The freeze's probe, and the release's.
    const suspect = index("intake_items", "intake_items_suspect_open_idx");
    expect(indexColumns(suspect)).toEqual(["case_id"]);
    expect(predicate(suspect)).toBe("suspect and answered_by is null");
    expect(predicate(index("intake_items", "intake_items_revision_idx"))).toBe("revision_pending_at is not null");
    expect(indexColumns(index("intake_items", "intake_items_answered_by_idx"))).toEqual(["answered_by"]);
  });

  test("an item records whether it is suspect and the handle an account was named by, and the database holds both halves of that", () => {
    const suspect = column("intake_items", "suspect");
    expect(suspect?.getSQLType()).toBe("boolean");
    expect(suspect?.notNull).toBe(true);
    // The trigger forces it; the default is there so that no insert must name a forced column.
    expect(suspect?.default).toBe(false);
    const named = column("intake_items", "named_handle");
    expect(named?.getSQLType()).toBe("text");
    expect(named?.notNull).toBe(false);
    expect(checks("intake_items")).toEqual([
      "intake_items_case",
      "intake_items_lane",
      "intake_items_named_handle",
      "intake_items_position",
      "intake_items_shown",
      "intake_items_statement",
      "intake_items_statement_len",
    ]);
    expect(foreignKeys("intake_items")).toEqual({
      intake_id: { table: "intakes", columns: ["id"], onDelete: "restrict" },
      case_id: { table: "cases", columns: ["id"], onDelete: "restrict" },
      answered_by: { table: "decisions", columns: ["id"], onDelete: "no action" },
      reexamines_item_id: { table: "intake_items", columns: ["id"], onDelete: "no action" },
    });
  });

  test("no check lets a row through on a null: a statement always has its digest, a salt its form, and the two comparisons with a nullable value are null-safe", () => {
    // A CHECK passes when its expression is null, so `digest = encode(...)` alone would accept a statement with no digest.
    for (const [table, name] of [
      ["intake_items", "intake_items_statement"],
      ["appeals", "appeals_statement"],
    ] as const) {
      expect(checkSql(table, name), name).toContain(`"${table}"."statement_digest" is not null and "${table}"."statement_digest" = encode(sha256(`);
      expect(checkSql(table, name), name).toContain(`"${table}"."statement_salt" ~ '^[0-9a-f]{64}$'`);
    }
    expect(checkSql("staff_texts", "staff_texts_digest")).toContain(`"staff_texts"."salt" ~ '^[0-9a-f]{64}$' and "staff_texts"."digest" = encode(sha256(`);
    expect(checkSql("intake_items", "intake_items_case")).toBe(
      `("intake_items"."case_id" is null) = ("intake_items"."seq" is null) and ("intake_items"."case_id" is not null or "intake_items"."outcome" is not distinct from 'not_available')`,
    );
    expect(checkSql("decisions", "decisions_keyword")).toBe(`"decisions"."category_keyword" is null or "decisions"."ground" is not distinct from 'illegal'`);
  });

  test("every check of intakes, by name", () => {
    expect(checks("intakes")).toEqual([
      "intakes_category",
      "intakes_category_keyword",
      "intakes_cited_law_len",
      "intakes_contact_signed_out",
      "intakes_csam",
      "intakes_erased",
      "intakes_explanation_len",
      "intakes_finding",
      "intakes_finding_legal",
      "intakes_has_ground",
      "intakes_illegal_elements",
      "intakes_illegal_not_tc",
      "intakes_lookup",
      "intakes_r2_finding_only",
      "intakes_ref",
      "intakes_reporter_signed_in",
      "intakes_rule_id",
    ]);
    // The public reference and the token's hash each name one notice.
    expect(uniques("intakes")).toEqual([
      ["intakes_lookup_hash_unique", ["lookup_hash"]],
      ["intakes_ref_unique", ["ref"]],
    ]);
    expect(foreignKeys("intakes")).toEqual({
      reporter_id: { table: "profiles", columns: ["id"], onDelete: "set null" },
      finding_by: { table: "profiles", columns: ["id"], onDelete: "restrict" },
    });
    // The notifier's contact lives in the auth schema; the public row holds only its id, with no foreign key.
    expect(column("intakes", "contact_id")?.getSQLType()).toBe("uuid");
    expect(predicate(index("intakes", "intakes_unerased_idx"))).toBe("erased_at is null");
  });

  test("every check of decisions, by name, and one review an appeal", () => {
    expect(checks("decisions")).toEqual([
      "decisions_automated_decision",
      "decisions_category",
      "decisions_category_keyword",
      "decisions_digests",
      "decisions_ground_law",
      "decisions_ground_rule",
      "decisions_interim",
      "decisions_keyword",
      "decisions_law_no_rule",
      "decisions_restricted",
      "decisions_reversal_plain",
      "decisions_review_target",
      "decisions_rule_id",
      "decisions_territorial_scope",
    ]);
    const once = index("decisions", "decisions_appeal_once");
    expect(once?.unique).toBe(true);
    expect(indexColumns(once)).toEqual(["appeal_id"]);
    expect(predicate(once)).toBe("appeal_id is not null");
    expect(foreignKeys("decisions")).toEqual({
      case_id: { table: "cases", columns: ["id"], onDelete: "restrict" },
      reviews_decision_id: { table: "decisions", columns: ["id"], onDelete: "no action" },
      appeal_id: { table: "appeals", columns: ["id"], onDelete: "no action" },
      snapshot_id: { table: "evidence_snapshots", columns: ["id"], onDelete: "restrict" },
      decided_by: { table: "profiles", columns: ["id"], onDelete: "restrict" },
    });
  });

  test("the columns of decisions that the database forces: their types, and which carry a default", () => {
    // [name, SQL type, not null, default]; undefined where the column has none and the trigger of 0016 alone fills it.
    const forced = [
      ["appeal_id", "uuid", false, undefined],
      ["answers_from_seq", "integer", false, undefined],
      ["source", "decision_source", true, undefined],
      ["automated_detection", "boolean", true, false],
      ["automated_decision", "text", true, "not_automated"],
      ["territorial_scope", "text", true, "worldwide"],
      ["decided_at", "timestamp with time zone", true, undefined],
      ["xact", "xid8", true, undefined],
      ["puid", "text", true, undefined],
      ["informed_at", "timestamp with time zone", true, undefined],
      ["suspect", "boolean", true, undefined],
      ["unseen", "boolean", true, false],
      ["needs_admin", "boolean", true, undefined],
      ["ended_interim", "boolean", true, undefined],
      ["author_mail", "delivery_state", true, "none"],
      ["author_mail_at", "timestamp with time zone", false, undefined],
    ] as const;
    for (const [name, type, notNull, fallback] of forced) {
      const c = column("decisions", name);
      expect(c?.getSQLType(), name).toBe(type);
      expect(c?.notNull, name).toBe(notNull);
      expect(c?.default, name).toBe(fallback);
    }
    // The Transparency Database's platform id: one per decision, never the internal id.
    expect(uniques("decisions")).toEqual([["decisions_puid_unique", ["puid"]]]);
  });

  test("the ledger: a measure once a decision, lifted at most once, and the columns the database forces", () => {
    expect(shape("decision_actions")).toEqual([
      ["id", "uuid", true],
      ["decision_id", "uuid", true],
      ["kind", "action_kind", true],
      ["media_id", "uuid", false],
      ["subject_account_id", "uuid", true],
      ["post_id", "uuid", false],
      ["reverses_action_id", "uuid", false],
      ["no_effect", "text", false],
      ["created_at", "timestamp with time zone", true],
    ]);
    // None of the forced columns has a default: the trigger of 0016 alone fills them.
    for (const name of ["subject_account_id", "post_id", "reverses_action_id", "no_effect", "created_at"]) expect(column("decision_actions", name)?.hasDefault, name).toBe(false);
    const once = byName.get("decision_actions")!.uniqueConstraints.map((u) => [u.getName(), u.columns.map((c) => c.name), u.nullsNotDistinct]);
    expect(once).toEqual([["decision_actions_once", ["decision_id", "kind", "media_id"], true]]);
    const reversed = index("decision_actions", "decision_actions_reversed_once");
    expect(reversed?.unique).toBe(true);
    expect(indexColumns(reversed)).toEqual(["reverses_action_id"]);
    expect(predicate(reversed)).toBe("reverses_action_id is not null");
    expect(checks("decision_actions")).toEqual(["decision_actions_no_effect"]);
    expect(foreignKeys("decision_actions")).toEqual({
      decision_id: { table: "decisions", columns: ["id"], onDelete: "restrict" },
      reverses_action_id: { table: "decision_actions", columns: ["id"], onDelete: "no action" },
    });
    expect(schema.actionKind.enumValues).toEqual([
      "withhold",
      "remove",
      "seal_media",
      "withhold_media",
      "remove_media",
      "reset_display_name",
      "reset_bio",
      "restore",
      "unseal_media",
      "restore_media",
      "restore_display_name",
      "restore_bio",
    ]);
  });

  test("seal_posts lists the posts of a seal with their image counts, keyed by measure and post", () => {
    expect(shape("seal_posts")).toEqual([
      ["action_id", "uuid", true],
      ["post_id", "uuid", true],
      ["images", "smallint", true],
    ]);
    expect(byName.get("seal_posts")!.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["action_id", "post_id"]]);
    // No foreign key on the post, as a case's target has none.
    expect(foreignKeys("seal_posts")).toEqual({ action_id: { table: "decision_actions", columns: ["id"], onDelete: "restrict" } });
    expect(indexColumns(index("seal_posts", "seal_posts_post_idx"))).toEqual(["post_id"]);
    expect(checks("seal_posts")).toEqual(["seal_posts_images"]);
  });

  test("decisions record whether they were taken under suspicion and with the images out of sight", () => {
    expect(column("decisions", "suspect")?.getSQLType()).toBe("boolean");
    expect(column("decisions", "suspect")?.notNull).toBe(true);
    expect(column("decisions", "unseen")?.getSQLType()).toBe("boolean");
    expect(column("decisions", "unseen")?.notNull).toBe(true);
  });

  test("one appeal a decision", () => {
    const once = index("appeals", "appeals_once");
    expect(once?.unique).toBe(true);
    expect(indexColumns(once)).toEqual(["decision_id"]);
    expect(once?.where).toBeUndefined();
    expect(predicate(index("appeals", "appeals_pending_idx"))).toBe("answered_by is null");
    expect(predicate(index("appeals", "appeals_statement_idx"))).toBe("statement is not null");
    expect(checks("appeals")).toEqual(["appeals_statement", "appeals_statement_len"]);
    expect(foreignKeys("appeals")).toEqual({
      decision_id: { table: "decisions", columns: ["id"], onDelete: "restrict" },
      answered_by: { table: "decisions", columns: ["id"], onDelete: "no action" },
    });
  });

  test("posts gain a moderation level and an erasure time; post_state keeps its four values", () => {
    const level = column("posts", "moderation_level");
    expect(level?.getSQLType()).toBe("moderation_level");
    expect(level?.notNull).toBe(true);
    expect(level?.default).toBe("visible");
    expect(schema.moderationLevel.enumValues).toEqual(["visible", "withheld", "removed"]);
    expect(column("posts", "erased_at")?.getSQLType()).toBe("timestamp with time zone");
    expect(column("posts", "erased_at")?.notNull).toBe(false);
    // A seal is a state of images: no reader of posts learns a new state.
    expect(schema.postState.enumValues).toEqual(["visible", "withheld", "removed", "deleted_by_author"]);
  });

  test("post_media gains its own moderation state, the time a hold retains it until and an erasure time", () => {
    const state = column("post_media", "moderation_state");
    expect(state?.getSQLType()).toBe("media_moderation_state");
    expect(state?.notNull).toBe(true);
    expect(state?.default).toBe("visible");
    // Only an image is ever sealed.
    expect(schema.mediaModerationState.enumValues).toEqual(["visible", "withheld", "removed", "sealed"]);
    for (const name of ["hold_until", "erased_at"]) {
      expect(column("post_media", name)?.getSQLType(), name).toBe("timestamp with time zone");
      expect(column("post_media", name)?.notNull, name).toBe(false);
      expect(column("post_media", name)?.hasDefault, name).toBe(false);
    }
  });

  test("media_holds keeps a case's hold on an image row and goes with the row", () => {
    expect(shape("media_holds")).toEqual([
      ["id", "bigint", true],
      ["media_id", "uuid", true],
      ["case_id", "uuid", true],
      ["held_at", "timestamp with time zone", true],
      ["until", "timestamp with time zone", false],
      ["released_at", "timestamp with time zone", false],
    ]);
    expect(column("media_holds", "id")?.generatedIdentity?.type).toBe("always");
    expect(foreignKeys("media_holds")).toEqual({
      media_id: { table: "post_media", columns: ["id"], onDelete: "cascade" },
      case_id: { table: "cases", columns: ["id"], onDelete: "restrict" },
    });
    expect(predicate(index("media_holds", "media_holds_media_idx"))).toBe("released_at is null");
    expect(predicate(index("media_holds", "media_holds_case_idx"))).toBe("released_at is null");
  });

  test("staff texts and snapshots are held to their digests and erasable; the access log numbers its rows", () => {
    expect(checks("staff_texts")).toEqual(["staff_texts_digest", "staff_texts_text_len"]);
    expect(uniques("staff_texts")).toEqual([["staff_texts_digest_unique", ["digest"]]]);
    expect(predicate(index("staff_texts", "staff_texts_open_idx"))).toBe("confirmed_at is null and erased_at is null");
    expect(checks("evidence_snapshots")).toEqual(["evidence_erased"]);
    expect(column("evidence_snapshots", "media")?.getSQLType()).toBe("jsonb");
    expect(column("evidence_snapshots", "post_state")?.getSQLType()).toBe("post_state");
    expect(indexColumns(index("evidence_snapshots", "evidence_snapshots_target_idx"))).toEqual(["target_type", "target_id"]);
    expect(predicate(index("evidence_snapshots", "evidence_snapshots_unerased_idx"))).toBe("erased_at is null");
    expect(column("case_access_log", "id")?.generatedIdentity?.type).toBe("always");
    expect(predicate(index("case_access_log", "case_access_log_reveals_idx"))).toBe("kind = 'identity_revealed'");
    expect(checks("moderation_limits")).toEqual(["moderation_limits_single_row"]);
  });

  test("the four new auth tables live in the auth schema, each with row level security and one policy", () => {
    for (const name of AUTH_TABLES) {
      const cfg = byName.get(name);
      expect(cfg, name).toBeDefined();
      expect(cfg!.schema, name).toBe("auth");
      expect(cfg!.enableRLS, name).toBe(true);
    }
    for (const name of ["notifier_contacts", "notifier_confirmations", "notifier_suppressions"]) {
      expect(policies(name), name).toEqual([[`${name}_auth_all`, "all", authRole]]);
    }
    // The auth role holds nothing on the staff links (migration 0015 revokes all); its one policy lets it see no row.
    const none = byName.get("staff_personal_accounts")!.policies;
    expect(none.map((p) => [p.name, p.for, p.to])).toEqual([["staff_personal_accounts_auth_none", "select", authRole]]);
    expect(new PgDialect().sqlToQuery(none[0]!.using!).sql).toBe("false");
  });

  test("a notifier's contact is kept encrypted, with a keyed hash of the address and the day it is forgotten", () => {
    expect(shape("notifier_contacts")).toEqual([
      ["id", "uuid", true],
      ["name_enc", "text", false],
      ["email_enc", "text", false],
      ["email_hash", "text", false],
      ["mail_token_enc", "text", false],
      ["created_at", "timestamp with time zone", true],
      ["forget_after", "timestamp with time zone", true],
    ]);
    // The moderation module chooses the id: the public intake row names it before the contact is stored.
    expect(column("notifier_contacts", "id")?.primary).toBe(true);
    expect(column("notifier_contacts", "id")?.hasDefault).toBe(false);
    expect(shape("notifier_confirmations")).toEqual([
      ["email_hash", "text", true],
      ["confirmed_at", "timestamp with time zone", true],
      ["expires_at", "timestamp with time zone", true],
    ]);
    expect(column("notifier_confirmations", "email_hash")?.primary).toBe(true);
    expect(shape("notifier_suppressions")).toEqual([
      ["email_hash", "text", true],
      ["created_at", "timestamp with time zone", true],
    ]);
    expect(column("notifier_suppressions", "email_hash")?.primary).toBe(true);
  });

  test("a staff link pairs a staff account with a personal account that is not the same one, and stops either from being deleted", () => {
    expect(shape("staff_personal_accounts")).toEqual([
      ["staff_user_id", "uuid", true],
      ["personal_user_id", "uuid", true],
      ["linked_at", "timestamp with time zone", true],
    ]);
    expect(byName.get("staff_personal_accounts")!.primaryKeys.map((k) => k.columns.map((c) => c.name))).toEqual([["staff_user_id", "personal_user_id"]]);
    expect(foreignKeys("staff_personal_accounts")).toEqual({
      staff_user_id: { table: "users", columns: ["id"], onDelete: "restrict" },
      personal_user_id: { table: "users", columns: ["id"], onDelete: "restrict" },
    });
    expect(checks("staff_personal_accounts")).toEqual(["staff_personal_accounts_differ"]);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:  ❯ test/media.test.ts (14 tests | 1 failed) 49ms
packages/contracts test:  Test Files  3 failed | 7 passed (10)
packages/contracts test:       Tests  1 failed | 140 passed (141)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/01-ground.md 3
```

Expected: 23 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/src/canonical.ts`

```ts
// The canonical text and the hashes that the step-up actions (staff.ts) and the moderation digests (moderation.ts) are
// built on. The API, audit-verify, text-verify and the console all call these, so each writes the same text and the same
// hash. The package's index does not export this module: its callers are the two files above.

/**
 * JSON with every object's keys sorted and no whitespace. Keys are sorted by UTF-16 code units (Array.prototype.sort's
 * order), and strings and numbers are written as JSON.stringify writes them, so the API, audit-verify and the console write
 * the same text. Anything JSON cannot carry is refused rather than dropped or changed, as JSON.stringify would.
 */
export function sortedJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("a canonical text holds only JSON values: a number must be finite");
    return JSON.stringify(value);
  }
  // Array.from visits holes too, so a sparse array is refused as undefined.
  if (Array.isArray(value)) return `[${Array.from(value, sortedJson).join(",")}]`;
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`a canonical text holds only JSON values, not ${value instanceof Object ? value.constructor.name : typeof value}`);
}

/**
 * The parts of the Web Crypto and Encoding APIs the hashes below use. Browsers and Node (from 19) both have them as
 * globals; the contracts are compiled without the DOM's or Node's types, so only these members are declared.
 */
interface WebPlatform {
  crypto: { subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(text: string): Uint8Array };
}

const platform = () => globalThis as unknown as WebPlatform;

/** A text's UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return new (platform().TextEncoder)().encode(text);
}

/** The sha256 of the bytes given. */
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await platform().crypto.subtle.digest("SHA-256", data));
}

/** The sha256 of a text's UTF-8 bytes. */
export async function sha256(text: string): Promise<Uint8Array> {
  return sha256Bytes(utf8(text));
}

/** Bytes as lower-case hex, the one spelling PostgreSQL's encode(..., 'hex') writes. */
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

### Create `packages/contracts/src/moderation.ts`

```ts
import { hex, sha256, sha256Bytes, sortedJson, utf8 } from "./canonical";

// Moderation cases (3c design, section 10): the constants and digests that the database, the API, the console, the app,
// the mails and the terms share. Each is the one source its words and numbers are taken from. This module imports
// nothing from staff.ts, and the index evaluates it first, so staff.ts can read these constants while it loads; an import
// the other way round would be a cycle that fails at load.

// ---------------------------------------------------------------- rules, categories and keywords

/** The rulebook's rule ids. @korbat/rules holds the rules themselves; the contracts never import it. */
export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
export type RuleId = (typeof RULE_IDS)[number];

/**
 * The 16 categories of the Commission's Transparency Database (read 2026-10-02), which every intake and decision carries.
 * The migration's CHECK lists are written from this constant, and a database test holds them to it. A value the
 * Commission removes stays here: a kept row may hold it, and only the lists offered for new input drop it.
 */
export const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
] as const;
export type TdbCategory = (typeof TDB_CATEGORIES)[number];

/** The two categories a notifier never chooses: a rule-only report gets the first, a notifier who is not sure the second. */
type UnofferedCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";
export type TdbFormCategory = Exclude<TdbCategory, UnofferedCategory>;

/** The 14 categories the illegal-ground form shows. */
export const TDB_FORM_CATEGORIES: readonly TdbFormCategory[] = TDB_CATEGORIES.filter(
  (category): category is TdbFormCategory => category !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
);

/**
 * The four choices of the path for child sexual abuse material and the Transparency Database keyword each stores. "abuse"
 * stores none: the database has no keyword for it.
 */
export const CSAM_KEYWORDS = {
  csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
  deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
  grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
  abuse: null,
} as const;
export type CsamKeywordChoice = keyof typeof CSAM_KEYWORDS;

/** The keywords a decision on the law may carry: in 3c only the Transparency Database's "Terrorist content". */
export const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"] as const;
export type DecisionKeyword = (typeof DECISION_KEYWORDS)[number];

/** The category the composer presets for a decision under each rule. */
export const RULE_DEFAULT_CATEGORY = {
  R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  R5: "STATEMENT_CATEGORY_VIOLENCE",
  R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
} as const satisfies Record<RuleId, TdbCategory>;

// ---------------------------------------------------------------- lanes

/** The queue's lanes: 0 is the most urgent. A case takes the most severe lane of its unanswered items. */
export type Lane = 0 | 1 | 2;

/** R2 and R5 are urgent; R3 and R4 come next; R1 and R6 last. */
const RULE_LANES: Record<RuleId, Lane> = { R1: 2, R2: 0, R3: 1, R4: 1, R5: 0, R6: 2 };

/** The categories that are not in lane 2: violence, public security and self-harm are urgent; six more come next. */
const CATEGORY_LANES: Partial<Record<TdbCategory, Lane>> = {
  STATEMENT_CATEGORY_VIOLENCE: 0,
  STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY: 0,
  STATEMENT_CATEGORY_SELF_HARM: 0,
  STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE: 1,
  STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN: 1,
  STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH: 1,
  STATEMENT_CATEGORY_PROTECTION_OF_MINORS: 1,
  STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE: 1,
};

/**
 * The lane of an intake's items, from its ground alone: nothing is weighted. The CSAM path is urgent whatever else is
 * said. Otherwise it is the more severe of the cited rule's lane and, on a notice that alleges illegality, the category's:
 * only there is the category a claim about the content, where on a rule report or a finding it is korbat's own
 * classification for the Transparency Database.
 */
export function laneFor(input: { ruleId: RuleId | null; allegesIllegal: boolean; csam: boolean; category: TdbCategory }): Lane {
  if (input.csam) return 0;
  const byRule: Lane = input.ruleId === null ? 2 : RULE_LANES[input.ruleId];
  const byCategory: Lane = input.allegesIllegal ? (CATEGORY_LANES[input.category] ?? 2) : 2;
  return byRule < byCategory ? byRule : byCategory;
}

// ---------------------------------------------------------------- limits and periods

/**
 * What one sender may send, published in the terms: intakes an hour and a day per network signed out and per account
 * signed in, the targets one notice names, and the bounds of its two texts in characters (the migration's CHECKs hold
 * the same numbers).
 */
export const NOTICE_LIMITS = {
  signedOut: { perHour: 5, perDay: 20 },
  signedIn: { perHour: 10, perDay: 50 },
  maxTargets: 10,
  explanationMax: 2000,
  citedLawMax: 300,
} as const;

/** A notice on the CSAM path names at most one account: one such target reaches every image on the account's posts. */
export const CSAM_NOTICE_MAX_ACCOUNTS = 1;

/** How many months back a case page counts earlier answers to reports of this kind about the same target or author. */
export const SUSPECT_EARLIER_MONTHS = 12;

/** How many rows of a seal's list the case answer carries. */
export const SEAL_LIST_MAX = 500;

/** The author's appeal and the re-examination window, in calendar months (appealDeadline, and appeal_deadline in SQL). */
export const APPEAL_MONTHS = 6;

/** Appeals a day per account, and re-examinations a day per account or network. */
export const DAILY_LIMITS = { appeals: 5, reexaminations: 5 } as const;

/**
 * How long 3c keeps each kind of data (the design's section 6.6), published in the terms. Each is a design choice, not a
 * legal figure.
 */
export const RETENTION = {
  /** Content restricted under R4 is erased once the restriction is final: this long after its author was told, or at the answer to their appeal. */
  r4FinalMonths: APPEAL_MONTHS,
  /** An intake's record (its texts and who sent it) goes this long after its last release. */
  intakeDays: 30,
  /** A reset field's old value stays readable this long after a lift that comes before the case's copies are erased. */
  resetValueDays: 30,
  /** A case's evidence waits this long after the case's newest snapshot or draft text. */
  evidenceHours: 24,
  /** Statements are erased this long after the account's deletion. */
  statementMonths: 12,
  /** The access log, and the reveal reasons its rows name. */
  accessLogMonths: 12,
  /** A notifier's contact goes this long after the last day korbat owed the notice something, */
  contactMonths: 6,
  /** and at most this long after the notice when nothing moved that day. */
  contactMaxMonths: 13,
  /** A notifier's confirmation of an address. */
  confirmationDays: 30,
  /** Backups are deleted this long after each was taken. No code of 3c enforces it: the README tells the operator. */
  backupDays: 30,
  /** An unconfirmed staff text is deleted after this long. */
  draftHours: 24,
  /** A mail still unsent this long after it was due is given up. */
  mailGiveUpDays: 5,
} as const;

// ---------------------------------------------------------------- measures

/** The ledger's kinds, in the order of the database's action_kind: the seven measures, then the five reversals. */
export const ACTION_KINDS = [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What a measure acts on: a post, one image of it, every image its case reaches, or one of an account's two fields. */
export type MeasureTarget = "post" | "image" | "images" | "display_name" | "bio";

export interface MeasureSpec {
  /** A decision taken while deciding (interim) may hold it. */
  interim: boolean;
  /** A decision that decides the case (final) may hold it. */
  final: boolean;
  /** For a reversal, the measures it lifts (it names exactly one row of them); null for a measure. */
  lifts: readonly ActionKind[] | null;
  target: MeasureTarget;
  /** The words for it in the composer, the statement and the terms. */
  label: string;
}

/**
 * Every kind of the ledger: whether it is taken while deciding, when the case is decided, or is a reversal; its target;
 * and its label. A post or one image is withheld only while deciding and removed only when the case is decided; a seal
 * and a field reset are either. A reversal is neither: the database's triggers say which decision may hold one.
 */
export const MEASURES = {
  withhold: { interim: true, final: false, lifts: null, target: "post", label: "Withhold the post" },
  remove: { interim: false, final: true, lifts: null, target: "post", label: "Remove" },
  seal_media: { interim: true, final: true, lifts: null, target: "images", label: "Seal the images this case reaches" },
  withhold_media: { interim: true, final: false, lifts: null, target: "image", label: "Withhold one image" },
  remove_media: { interim: false, final: true, lifts: null, target: "image", label: "Remove one image" },
  reset_display_name: { interim: true, final: true, lifts: null, target: "display_name", label: "Reset display name" },
  reset_bio: { interim: true, final: true, lifts: null, target: "bio", label: "Reset bio" },
  restore: { interim: false, final: false, lifts: ["withhold", "remove"], target: "post", label: "Lift the restriction of the post" },
  unseal_media: { interim: false, final: false, lifts: ["seal_media"], target: "images", label: "Lift the seal" },
  restore_media: { interim: false, final: false, lifts: ["withhold_media", "remove_media"], target: "image", label: "Lift the restriction of one image" },
  restore_display_name: { interim: false, final: false, lifts: ["reset_display_name"], target: "display_name", label: "Lift the reset of the display name" },
  restore_bio: { interim: false, final: false, lifts: ["reset_bio"], target: "bio", label: "Lift the reset of the bio" },
} as const satisfies Record<ActionKind, MeasureSpec>;

// ---------------------------------------------------------------- digests

/** Names the rule a text's digest is made by; a later rule gets a later tag. */
export const TEXT_DIGEST_TAG = "korbat.text.v1";

const SALT_HEX = /^[0-9a-f]{64}$/;

/** Whether every surrogate in the text is half of a pair: only then has it UTF-8 bytes. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * The salted digest of a free text (a staff text, a statement): the lower-case hex sha256 of the tag's bytes, a line
 * feed, the salt's 32 bytes and the text's UTF-8 bytes. The API, the console and text-verify call it, and the database's
 * CHECKs compute the same, so a stored text is always the one its digest names. The salt keeps a short text from being
 * confirmed by hashing guesses. A malformed salt or text is refused, never changed: TextEncoder would otherwise hash a
 * lone surrogate as another character.
 */
export async function textDigest(saltHex: string, text: string): Promise<string> {
  if (!SALT_HEX.test(saltHex)) throw new TypeError("a text digest's salt is 32 bytes as 64 lower-case hex characters");
  if (!isWellFormed(text)) throw new TypeError("a text digest is taken over a well-formed text: a lone surrogate has no UTF-8 bytes");
  const tag = utf8(TEXT_DIGEST_TAG);
  const body = utf8(text);
  const bytes = new Uint8Array(tag.length + 1 + 32 + body.length);
  bytes.set(tag, 0);
  bytes[tag.length] = 0x0a;
  for (let i = 0; i < 32; i++) bytes[tag.length + 1 + i] = Number.parseInt(saltHex.slice(2 * i, 2 * i + 2), 16);
  bytes.set(body, tag.length + 33);
  return hex(await sha256Bytes(bytes));
}

/** Names the rule a snapshot's digest is made by. */
export const SNAPSHOT_DIGEST_TAG = "korbat.snapshot.v1";

/**
 * What a snapshot's digest covers: its salt and everything it copied. A post's snapshot leaves the three profile fields
 * null, an account's the post's. Each image is its id, alt text and size, in position order; an alt text is null for an
 * image whose content was erased.
 */
export interface SnapshotDigestInput {
  salt: string;
  targetType: "post" | "account";
  targetId: string;
  /** When the snapshot was taken, as Date.prototype.toISOString writes it. */
  takenAt: string;
  authorHandle: string;
  postState: "visible" | "withheld" | "removed" | "deleted_by_author" | null;
  /** As Date.prototype.toISOString writes it. */
  postCreatedAt: string | null;
  replyToId: string | null;
  quoteOfId: string | null;
  body: string | null;
  media: { id: string; alt: string | null; width: number; height: number }[] | null;
  displayName: string | null;
  bio: string | null;
  handle: string | null;
}

/** A time as toISOString writes it: UTC, to the millisecond. Any other spelling of the same instant would hash differently. */
const ISO_MILLIS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/;

function isoTime(name: string, value: string): string {
  if (!ISO_MILLIS.test(value)) throw new TypeError(`a snapshot's ${name} is a UTC time to the millisecond, as toISOString writes it`);
  return value;
}

/**
 * The text a snapshot's digest is taken over: the sorted JSON of version 1 and the snapshot's members, each picked by
 * name, so that whatever else an answer carries, and in whatever order, the API and the console write the same text.
 */
export function snapshotText(snapshot: SnapshotDigestInput): string {
  return sortedJson({
    v: 1,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    takenAt: isoTime("takenAt", snapshot.takenAt),
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt === null ? null : isoTime("postCreatedAt", snapshot.postCreatedAt),
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media === null ? null : snapshot.media.map((image) => ({ id: image.id, alt: image.alt, width: image.width, height: image.height })),
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  });
}

/** A snapshot's digest: the lower-case hex sha256 of the tag, a line feed and snapshotText, in UTF-8. */
export async function snapshotDigest(snapshot: SnapshotDigestInput): Promise<string> {
  return hex(await sha256(`${SNAPSHOT_DIGEST_TAG}\n${snapshotText(snapshot)}`));
}

/**
 * The end of the author's appeal window and of the re-examination window: APPEAL_MONTHS calendar months after the person
 * was told, in UTC, at the same time of day. A day the target month lacks becomes that month's last day (31 August gives
 * the end of February). PostgreSQL's appeal_deadline computes the same; a test holds the two equal over every month end.
 */
export function appealDeadline(informedAt: Date): Date {
  const year = informedAt.getUTCFullYear();
  const month = informedAt.getUTCMonth() + APPEAL_MONTHS;
  // Day 0 of the month after the target month is the target month's last day; Date.UTC carries a month past 11 into the year.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(informedAt.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, informedAt.getUTCHours(), informedAt.getUTCMinutes(), informedAt.getUTCSeconds(), informedAt.getUTCMilliseconds()));
}
```

### Create `packages/db/migrations/0014_old_vapor.sql`

```sql
DROP POLICY "appeals_api_all" ON "appeals" CASCADE;--> statement-breakpoint
DROP TABLE "appeals" CASCADE;--> statement-breakpoint
DROP POLICY "cases_api_all" ON "cases" CASCADE;--> statement-breakpoint
DROP TABLE "cases" CASCADE;--> statement-breakpoint
DROP POLICY "reports_api_all" ON "reports" CASCADE;--> statement-breakpoint
DROP TABLE "reports" CASCADE;--> statement-breakpoint
DROP POLICY "strikes_api_all" ON "strikes" CASCADE;--> statement-breakpoint
DROP TABLE "strikes" CASCADE;--> statement-breakpoint
DROP POLICY "transparency_api_all" ON "transparency_log" CASCADE;--> statement-breakpoint
DROP TABLE "transparency_log" CASCADE;--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "reputation";--> statement-breakpoint
DROP TYPE "public"."appeal_status";--> statement-breakpoint
DROP TYPE "public"."case_action";--> statement-breakpoint
DROP TYPE "public"."report_status";--> statement-breakpoint
DROP TYPE "public"."target_type";
```

### Create `packages/db/migrations/0015_greedy_zuras.sql`

```sql
CREATE TYPE "public"."media_moderation_state" AS ENUM('visible', 'withheld', 'removed', 'sealed');--> statement-breakpoint
CREATE TYPE "public"."moderation_level" AS ENUM('visible', 'withheld', 'removed');--> statement-breakpoint
CREATE TYPE "public"."access_kind" AS ENUM('case_opened', 'image_viewed', 'identity_revealed');--> statement-breakpoint
CREATE TYPE "public"."action_kind" AS ENUM('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio', 'restore', 'unseal_media', 'restore_media', 'restore_display_name', 'restore_bio');--> statement-breakpoint
CREATE TYPE "public"."appeal_result" AS ENUM('kept', 'partly_reversed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."decision_ground" AS ENUM('incompatible', 'illegal');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('interim', 'final', 'review', 'correction');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('restricted', 'no_violation', 'not_evident', 'kept', 'partly_reversed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."decision_source" AS ENUM('notice', 'report', 'own_initiative');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('pending', 'sent', 'folded', 'suppressed', 'no_address', 'none', 'failed');--> statement-breakpoint
CREATE TYPE "public"."intake_channel" AS ENUM('signed_in', 'signed_out', 'staff');--> statement-breakpoint
CREATE TYPE "public"."intake_kind" AS ENUM('user', 'finding');--> statement-breakpoint
CREATE TYPE "public"."item_outcome" AS ENUM('restricted_rule', 'restricted_legal', 'no_violation', 'not_evident', 'not_available', 'partly_reversed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."moderation_target" AS ENUM('post', 'account');--> statement-breakpoint
CREATE TYPE "public"."staff_text_kind" AS ENUM('facts', 'reason', 'legal_reference', 'review_reason', 'reveal_reason', 'note', 'seal_declined');--> statement-breakpoint
CREATE TABLE "auth"."notifier_confirmations" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."notifier_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."notifier_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_enc" text,
	"email_enc" text,
	"email_hash" text,
	"mail_token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forget_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."notifier_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."notifier_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."notifier_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."staff_personal_accounts" (
	"staff_user_id" uuid NOT NULL,
	"personal_user_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_personal_accounts_staff_user_id_personal_user_id_pk" PRIMARY KEY("staff_user_id","personal_user_id"),
	CONSTRAINT "staff_personal_accounts_differ" CHECK ("auth"."staff_personal_accounts"."staff_user_id" <> "auth"."staff_personal_accounts"."personal_user_id")
);
--> statement-breakpoint
ALTER TABLE "auth"."staff_personal_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"appellant_account_id" uuid NOT NULL,
	"statement" text,
	"statement_salt" text,
	"statement_digest" text,
	"filed_at" timestamp with time zone NOT NULL,
	"answered_by" uuid,
	"result" "appeal_result",
	"answered_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "appeals_statement_len" CHECK (char_length("appeals"."statement") <= 2000),
	CONSTRAINT "appeals_statement" CHECK (("appeals"."statement" is null) = ("appeals"."statement_salt" is null) and ("appeals"."statement" is null or ("appeals"."erased_at" is null and "appeals"."statement_salt" ~ '^[0-9a-f]{64}$' and "appeals"."statement_digest" is not null and "appeals"."statement_digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("appeals"."statement_salt", 'hex') || convert_to("appeals"."statement", 'UTF8')), 'hex'))) and ("appeals"."statement" is not null or "appeals"."statement_digest" is null or "appeals"."erased_at" is not null) and ("appeals"."statement_digest" is null or "appeals"."statement_digest" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "appeals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "case_access_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_access_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"staff_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "access_kind" NOT NULL,
	"media_id" uuid,
	"intake_item_id" uuid,
	"text_id" uuid,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"lane" smallint DEFAULT 2 NOT NULL,
	"intake_seq" integer DEFAULT 0 NOT NULL,
	"answered_seq" integer DEFAULT 0 NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"oldest_open_at" timestamp with time zone,
	"last_decided_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "cases_lane" CHECK ("cases"."lane" between 0 and 2),
	CONSTRAINT "cases_seq_order" CHECK ("cases"."answered_seq" <= "cases"."intake_seq"),
	CONSTRAINT "cases_closed_answered" CHECK ("cases"."closed_at" is null or "cases"."answered_seq" = "cases"."intake_seq")
);
--> statement-breakpoint
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decision_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"kind" "action_kind" NOT NULL,
	"media_id" uuid,
	"subject_account_id" uuid NOT NULL,
	"post_id" uuid,
	"reverses_action_id" uuid,
	"no_effect" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decision_actions_once" UNIQUE NULLS NOT DISTINCT("decision_id","kind","media_id"),
	CONSTRAINT "decision_actions_no_effect" CHECK ("decision_actions"."no_effect" in ('already', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "decision_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "decision_kind" NOT NULL,
	"reviews_decision_id" uuid,
	"appeal_id" uuid,
	"seen_state_version" integer NOT NULL,
	"through_seq" integer DEFAULT 0 NOT NULL,
	"answers_from_seq" integer,
	"outcome" "decision_outcome" NOT NULL,
	"ground" "decision_ground",
	"rule_id" text,
	"rules_version" smallint NOT NULL,
	"redress_version" smallint NOT NULL,
	"category" text NOT NULL,
	"category_keyword" text,
	"source" "decision_source" NOT NULL,
	"automated_detection" boolean DEFAULT false NOT NULL,
	"automated_decision" text DEFAULT 'not_automated' NOT NULL,
	"territorial_scope" text DEFAULT 'worldwide' NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_digest" text NOT NULL,
	"facts_digest" text,
	"reason_digest" text,
	"legal_reference_digest" text,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"xact" "xid8" NOT NULL,
	"puid" text NOT NULL,
	"informed_at" timestamp with time zone NOT NULL,
	"suspect" boolean NOT NULL,
	"unseen" boolean DEFAULT false NOT NULL,
	"needs_admin" boolean NOT NULL,
	"ended_interim" boolean NOT NULL,
	"author_mail" "delivery_state" DEFAULT 'none' NOT NULL,
	"author_mail_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "decisions_puid_unique" UNIQUE("puid"),
	CONSTRAINT "decisions_rule_id" CHECK ("decisions"."rule_id" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')),
	CONSTRAINT "decisions_category" CHECK ("decisions"."category" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')),
	CONSTRAINT "decisions_category_keyword" CHECK ("decisions"."category_keyword" in ('KEYWORD_TERRORIST_CONTENT')),
	CONSTRAINT "decisions_automated_decision" CHECK ("decisions"."automated_decision" in ('fully', 'partially', 'not_automated')),
	CONSTRAINT "decisions_territorial_scope" CHECK ("decisions"."territorial_scope" = 'worldwide'),
	CONSTRAINT "decisions_review_target" CHECK (("decisions"."kind" in ('review', 'correction')) = ("decisions"."reviews_decision_id" is not null) and ("decisions"."kind" = 'review') = ("decisions"."appeal_id" is not null)),
	CONSTRAINT "decisions_interim" CHECK ("decisions"."kind" <> 'interim' or "decisions"."through_seq" = 0),
	CONSTRAINT "decisions_ground_rule" CHECK ("decisions"."ground" is distinct from 'incompatible' or "decisions"."rule_id" is not null),
	CONSTRAINT "decisions_ground_law" CHECK ("decisions"."ground" is distinct from 'illegal' or "decisions"."legal_reference_digest" is not null),
	CONSTRAINT "decisions_restricted" CHECK ("decisions"."outcome" <> 'restricted' or ("decisions"."ground" is not null and "decisions"."facts_digest" is not null and "decisions"."reason_digest" is not null)),
	CONSTRAINT "decisions_digests" CHECK (("decisions"."facts_digest" is null or "decisions"."facts_digest" ~ '^[0-9a-f]{64}$') and ("decisions"."reason_digest" is null or "decisions"."reason_digest" ~ '^[0-9a-f]{64}$') and ("decisions"."legal_reference_digest" is null or "decisions"."legal_reference_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "decisions_keyword" CHECK ("decisions"."category_keyword" is null or "decisions"."ground" is not distinct from 'illegal'),
	CONSTRAINT "decisions_law_no_rule" CHECK ("decisions"."ground" is distinct from 'illegal' or "decisions"."rule_id" is null),
	CONSTRAINT "decisions_reversal_plain" CHECK ("decisions"."kind" not in ('review', 'correction') or ("decisions"."ground" is null and "decisions"."rule_id" is null and "decisions"."category_keyword" is null and "decisions"."facts_digest" is null and "decisions"."legal_reference_digest" is null))
);
--> statement-breakpoint
ALTER TABLE "decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"author_handle" text NOT NULL,
	"post_state" "post_state",
	"post_created_at" timestamp with time zone,
	"reply_to_id" uuid,
	"quote_of_id" uuid,
	"body" text,
	"media" jsonb,
	"display_name" text,
	"bio" text,
	"handle" text,
	"salt" text,
	"digest" text NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "evidence_erased" CHECK ("evidence_snapshots"."erased_at" is null or ("evidence_snapshots"."body" is null and "evidence_snapshots"."media" is null and "evidence_snapshots"."display_name" is null and "evidence_snapshots"."bio" is null and "evidence_snapshots"."salt" is null))
);
--> statement-breakpoint
ALTER TABLE "evidence_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"target_type" "moderation_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"media_id" uuid,
	"named_handle" text,
	"case_id" uuid,
	"seq" integer,
	"lane" smallint NOT NULL,
	"reporter_account_id" uuid,
	"alleges_illegal" boolean DEFAULT false NOT NULL,
	"suspect" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"outcome" "item_outcome",
	"answered_by" uuid,
	"outcome_sent_at" timestamp with time zone,
	"shown_outcome" "item_outcome",
	"revision_pending_at" timestamp with time zone,
	"revised_sent_at" timestamp with time zone,
	"outcome_mail" "delivery_state" DEFAULT 'none' NOT NULL,
	"reexamines_item_id" uuid,
	"statement" text,
	"statement_salt" text,
	"statement_digest" text,
	"erased_at" timestamp with time zone,
	CONSTRAINT "intake_items_position" CHECK ("intake_items"."position" between 1 and 20),
	CONSTRAINT "intake_items_lane" CHECK ("intake_items"."lane" between 0 and 2),
	CONSTRAINT "intake_items_case" CHECK (("intake_items"."case_id" is null) = ("intake_items"."seq" is null) and ("intake_items"."case_id" is not null or "intake_items"."outcome" is not distinct from 'not_available')),
	CONSTRAINT "intake_items_shown" CHECK ("intake_items"."shown_outcome" is null or "intake_items"."outcome_sent_at" is not null),
	CONSTRAINT "intake_items_named_handle" CHECK (("intake_items"."target_type" = 'account') = ("intake_items"."named_handle" is not null)),
	CONSTRAINT "intake_items_statement_len" CHECK (char_length("intake_items"."statement") <= 2000),
	CONSTRAINT "intake_items_statement" CHECK (("intake_items"."statement_digest" is null or "intake_items"."reexamines_item_id" is not null) and ("intake_items"."statement" is null) = ("intake_items"."statement_salt" is null) and ("intake_items"."statement" is null or ("intake_items"."erased_at" is null and "intake_items"."statement_salt" ~ '^[0-9a-f]{64}$' and "intake_items"."statement_digest" is not null and "intake_items"."statement_digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("intake_items"."statement_salt", 'hex') || convert_to("intake_items"."statement", 'UTF8')), 'hex'))) and ("intake_items"."statement" is not null or "intake_items"."statement_digest" is null or "intake_items"."erased_at" is not null) and ("intake_items"."statement_digest" is null or "intake_items"."statement_digest" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "intake_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "intake_kind" NOT NULL,
	"ref" text NOT NULL,
	"lookup_hash" text,
	"channel" "intake_channel" NOT NULL,
	"reporter_id" uuid,
	"finding_by" uuid,
	"contact_id" uuid,
	"rule_id" text,
	"alleges_illegal" boolean DEFAULT false NOT NULL,
	"csam" boolean DEFAULT false NOT NULL,
	"category" text NOT NULL,
	"category_keyword" text,
	"cited_law" text,
	"explanation" text,
	"bona_fide" boolean DEFAULT false NOT NULL,
	"automated_processing" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"receipt" "delivery_state" DEFAULT 'none' NOT NULL,
	"receipt_sent_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "intakes_ref_unique" UNIQUE("ref"),
	CONSTRAINT "intakes_lookup_hash_unique" UNIQUE("lookup_hash"),
	CONSTRAINT "intakes_ref" CHECK ("intakes"."ref" ~ '^N-[A-Z2-7]{10}$'),
	CONSTRAINT "intakes_rule_id" CHECK ("intakes"."rule_id" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')),
	CONSTRAINT "intakes_category" CHECK ("intakes"."category" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')),
	CONSTRAINT "intakes_category_keyword" CHECK ("intakes"."category_keyword" in ('KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL', 'KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE', 'KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS')),
	CONSTRAINT "intakes_cited_law_len" CHECK (char_length("intakes"."cited_law") <= 300),
	CONSTRAINT "intakes_explanation_len" CHECK (char_length("intakes"."explanation") <= 2000),
	CONSTRAINT "intakes_has_ground" CHECK ("intakes"."rule_id" is not null or "intakes"."alleges_illegal" or "intakes"."csam"),
	CONSTRAINT "intakes_illegal_elements" CHECK ("intakes"."kind" <> 'user' or not "intakes"."alleges_illegal" or "intakes"."csam" or ("intakes"."bona_fide" and ("intakes"."explanation" is not null or "intakes"."erased_at" is not null))),
	CONSTRAINT "intakes_finding_legal" CHECK ("intakes"."kind" <> 'finding' or not "intakes"."alleges_illegal"),
	CONSTRAINT "intakes_illegal_not_tc" CHECK (not "intakes"."alleges_illegal" or "intakes"."category" <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'),
	CONSTRAINT "intakes_csam" CHECK (not "intakes"."csam" or ("intakes"."category" = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and "intakes"."reporter_id" is null and "intakes"."contact_id" is null)),
	CONSTRAINT "intakes_contact_signed_out" CHECK ("intakes"."contact_id" is null or "intakes"."channel" = 'signed_out'),
	CONSTRAINT "intakes_reporter_signed_in" CHECK ("intakes"."reporter_id" is null or "intakes"."channel" = 'signed_in'),
	CONSTRAINT "intakes_finding" CHECK (("intakes"."kind" = 'finding') = ("intakes"."finding_by" is not null) and ("intakes"."kind" = 'finding') = ("intakes"."channel" = 'staff')),
	CONSTRAINT "intakes_lookup" CHECK (("intakes"."lookup_hash" is not null) = ("intakes"."channel" = 'signed_out' or "intakes"."csam")),
	CONSTRAINT "intakes_erased" CHECK ("intakes"."erased_at" is null or ("intakes"."explanation" is null and "intakes"."cited_law" is null)),
	CONSTRAINT "intakes_r2_finding_only" CHECK ("intakes"."rule_id" is distinct from 'R2' or "intakes"."kind" = 'finding')
);
--> statement-breakpoint
ALTER TABLE "intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media_holds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "media_holds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"media_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"until" timestamp with time zone,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moderation_limits" (
	"id" smallint PRIMARY KEY NOT NULL,
	"decisions_per_hour" integer NOT NULL,
	"decisions_per_day" integer NOT NULL,
	"case_opens_per_day" integer NOT NULL,
	"findings_per_day" integer NOT NULL,
	"reveals_per_day" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "moderation_limits_single_row" CHECK ("moderation_limits"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "moderation_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seal_posts" (
	"action_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"images" smallint NOT NULL,
	CONSTRAINT "seal_posts_action_id_post_id_pk" PRIMARY KEY("action_id","post_id"),
	CONSTRAINT "seal_posts_images" CHECK ("seal_posts"."images" > 0)
);
--> statement-breakpoint
ALTER TABLE "seal_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "staff_text_kind" NOT NULL,
	"text" text,
	"salt" text,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decision_id" uuid,
	"confirmed_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "staff_texts_digest_unique" UNIQUE("digest"),
	CONSTRAINT "staff_texts_text_len" CHECK (char_length("staff_texts"."text") <= 5000),
	CONSTRAINT "staff_texts_digest" CHECK (("staff_texts"."text" is null) = ("staff_texts"."salt" is null) and ("staff_texts"."text" is null) = ("staff_texts"."erased_at" is not null) and ("staff_texts"."text" is null or ("staff_texts"."salt" ~ '^[0-9a-f]{64}$' and "staff_texts"."digest" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode("staff_texts"."salt", 'hex') || convert_to("staff_texts"."text", 'UTF8')), 'hex'))))
);
--> statement-breakpoint
ALTER TABLE "staff_texts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "moderation_state" "media_moderation_state" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_level" "moderation_level" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."staff_personal_accounts" ADD CONSTRAINT "staff_personal_accounts_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."staff_personal_accounts" ADD CONSTRAINT "staff_personal_accounts_personal_user_id_users_id_fk" FOREIGN KEY ("personal_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_answered_by_decisions_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_log" ADD CONSTRAINT "case_access_log_staff_id_profiles_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_access_log" ADD CONSTRAINT "case_access_log_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_reverses_action_id_decision_actions_id_fk" FOREIGN KEY ("reverses_action_id") REFERENCES "public"."decision_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_reviews_decision_id_decisions_id_fk" FOREIGN KEY ("reviews_decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_appeal_id_appeals_id_fk" FOREIGN KEY ("appeal_id") REFERENCES "public"."appeals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_snapshot_id_evidence_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."evidence_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_snapshots" ADD CONSTRAINT "evidence_snapshots_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_answered_by_decisions_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_reexamines_item_id_intake_items_id_fk" FOREIGN KEY ("reexamines_item_id") REFERENCES "public"."intake_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_finding_by_profiles_id_fk" FOREIGN KEY ("finding_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_holds" ADD CONSTRAINT "media_holds_media_id_post_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."post_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_holds" ADD CONSTRAINT "media_holds_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seal_posts" ADD CONSTRAINT "seal_posts_action_id_decision_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."decision_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_texts" ADD CONSTRAINT "staff_texts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_texts" ADD CONSTRAINT "staff_texts_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_texts" ADD CONSTRAINT "staff_texts_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_once" ON "appeals" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "appeals_pending_idx" ON "appeals" USING btree ("decision_id") WHERE answered_by is null;--> statement-breakpoint
CREATE INDEX "appeals_statement_idx" ON "appeals" USING btree ("decision_id") WHERE statement is not null;--> statement-breakpoint
CREATE INDEX "case_access_log_staff_idx" ON "case_access_log" USING btree ("staff_id","at");--> statement-breakpoint
CREATE INDEX "case_access_log_case_idx" ON "case_access_log" USING btree ("case_id","at");--> statement-breakpoint
CREATE INDEX "case_access_log_reveals_idx" ON "case_access_log" USING btree ("at") WHERE kind = 'identity_revealed';--> statement-breakpoint
CREATE UNIQUE INDEX "cases_one_open_per_target" ON "cases" USING btree ("target_type","target_id") WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX "cases_queue_idx" ON "cases" USING btree ("lane","oldest_open_at") WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX "cases_target_idx" ON "cases" USING btree ("target_type","target_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_actions_reversed_once" ON "decision_actions" USING btree ("reverses_action_id") WHERE reverses_action_id is not null;--> statement-breakpoint
CREATE INDEX "decision_actions_post_kind_idx" ON "decision_actions" USING btree ("post_id","kind");--> statement-breakpoint
CREATE INDEX "decision_actions_subject_kind_idx" ON "decision_actions" USING btree ("subject_account_id","kind");--> statement-breakpoint
CREATE INDEX "decisions_case_decided_idx" ON "decisions" USING btree ("case_id","decided_at");--> statement-breakpoint
CREATE INDEX "decisions_decided_by_idx" ON "decisions" USING btree ("decided_by","decided_at");--> statement-breakpoint
CREATE INDEX "decisions_reviews_idx" ON "decisions" USING btree ("reviews_decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_appeal_once" ON "decisions" USING btree ("appeal_id") WHERE appeal_id is not null;--> statement-breakpoint
CREATE INDEX "evidence_snapshots_case_taken_idx" ON "evidence_snapshots" USING btree ("case_id","taken_at");--> statement-breakpoint
CREATE INDEX "evidence_snapshots_target_idx" ON "evidence_snapshots" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "evidence_snapshots_unerased_idx" ON "evidence_snapshots" USING btree ("case_id") WHERE erased_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_target_once" ON "intake_items" USING btree ("intake_id","target_type","target_id") WHERE reexamines_item_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_reexamines_once" ON "intake_items" USING btree ("reexamines_item_id") WHERE reexamines_item_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_case_seq_idx" ON "intake_items" USING btree ("case_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_items_reporter_once" ON "intake_items" USING btree ("case_id","reporter_account_id","alleges_illegal") WHERE reexamines_item_id is null;--> statement-breakpoint
CREATE INDEX "intake_items_answered_by_idx" ON "intake_items" USING btree ("answered_by");--> statement-breakpoint
CREATE INDEX "intake_items_suspect_open_idx" ON "intake_items" USING btree ("case_id") WHERE suspect and answered_by is null;--> statement-breakpoint
CREATE INDEX "intake_items_revision_idx" ON "intake_items" USING btree ("revision_pending_at") WHERE revision_pending_at is not null;--> statement-breakpoint
CREATE INDEX "intakes_reporter_idx" ON "intakes" USING btree ("reporter_id","received_at");--> statement-breakpoint
CREATE INDEX "intakes_finding_idx" ON "intakes" USING btree ("finding_by","received_at");--> statement-breakpoint
CREATE INDEX "intakes_unerased_idx" ON "intakes" USING btree ("received_at") WHERE erased_at is null;--> statement-breakpoint
CREATE INDEX "media_holds_media_idx" ON "media_holds" USING btree ("media_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "media_holds_case_idx" ON "media_holds" USING btree ("case_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "seal_posts_post_idx" ON "seal_posts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "staff_texts_open_idx" ON "staff_texts" USING btree ("case_id","author_id") WHERE confirmed_at is null and erased_at is null;--> statement-breakpoint
CREATE POLICY "notifier_confirmations_auth_all" ON "auth"."notifier_confirmations" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "notifier_contacts_auth_all" ON "auth"."notifier_contacts" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "notifier_suppressions_auth_all" ON "auth"."notifier_suppressions" AS PERMISSIVE FOR ALL TO "korbat_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_personal_accounts_auth_none" ON "auth"."staff_personal_accounts" AS PERMISSIVE FOR SELECT TO "korbat_auth" USING (false);--> statement-breakpoint
CREATE POLICY "appeals_api_all" ON "appeals" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "case_access_log_api_all" ON "case_access_log" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "cases_api_all" ON "cases" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "decision_actions_api_all" ON "decision_actions" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "decisions_api_all" ON "decisions" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "evidence_snapshots_api_all" ON "evidence_snapshots" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "intake_items_api_all" ON "intake_items" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "intakes_api_all" ON "intakes" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "media_holds_api_all" ON "media_holds" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "moderation_limits_api_select" ON "moderation_limits" AS PERMISSIVE FOR SELECT TO "korbat_api" USING (true);--> statement-breakpoint
CREATE POLICY "seal_posts_api_all" ON "seal_posts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "staff_texts_api_all" ON "staff_texts" AS PERMISSIVE FOR ALL TO "korbat_api" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Everything below is written by hand (3c design, section 6.1), in the order the design gives. drizzle's migrator runs every
-- pending migration in one transaction, so a failure anywhere leaves no moderation table behind. Every function is owned by
-- the migrator, pins its search path, names every object schema-qualified and has EXECUTE taken from PUBLIC: a trigger
-- function fires for every role all the same, and the few that a role calls directly are granted to that role alone.
-- Errors carry their code as the message under SQLSTATE P0001 unless a SQLSTATE is named.
--
-- 1. The grants. 0001's default privileges gave the API role SELECT, INSERT, UPDATE and DELETE on every new public table
-- (never TRUNCATE, which each revoke names all the same). The moderation tables are append-only for it: it inserts and
-- reads, and the derived columns move only through migrator-owned triggers and functions.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."cases", "public"."intakes", "public"."intake_items", "public"."decisions", "public"."decision_actions", "public"."appeals", "public"."staff_texts", "public"."evidence_snapshots", "public"."case_access_log", "public"."media_holds" FROM korbat_api;--> statement-breakpoint
-- A seal's list is written only by a trigger, from the image rows it locked: the API role reads it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."seal_posts" FROM korbat_api;--> statement-breakpoint
-- The limits on staff are raised only by `staff.js limits`, as the migrator.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."moderation_limits" FROM korbat_api;--> statement-breakpoint
-- What the API role may still change: the state of the three kinds of mail it sends.
GRANT UPDATE ("receipt", "receipt_sent_at") ON "public"."intakes" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("outcome_mail") ON "public"."intake_items" TO korbat_api;--> statement-breakpoint
GRANT UPDATE ("author_mail", "author_mail_at") ON "public"."decisions" TO korbat_api;--> statement-breakpoint
-- post_media: the API role loses the table's UPDATE and gets back every column but the three that migrator-owned functions
-- write (moderation_state, hold_until, erased_at). Its updates name only the columns they set, so they keep working.
REVOKE UPDATE ON "public"."post_media" FROM korbat_api;--> statement-breakpoint
GRANT UPDATE ("status", "error", "post_id", "position", "width", "height", "blurhash", "alt_text", "nsfw_score") ON "public"."post_media" TO korbat_api;--> statement-breakpoint
-- posts: the same, for the seven columns the API writes; never moderation_level or erased_at.
REVOKE UPDATE ON "public"."posts" FROM korbat_api;--> statement-breakpoint
GRANT UPDATE ("body", "state", "deleted_at", "like_count", "repost_count", "reply_count", "quote_count") ON "public"."posts" TO korbat_api;--> statement-breakpoint
-- No code deletes a post or a profile, and now the API role cannot: a cascade into image rows is only ever the migrator's
-- or the superuser's, and the keep trigger below refuses one that meets a retained row.
REVOKE DELETE ON "public"."posts", "public"."profiles" FROM korbat_api;--> statement-breakpoint
-- 2. The forced-field triggers. Each is plain and writes only the row being inserted: whatever an insert supplied for a
-- forced column, the row gets the database's value, so the API role can neither choose nor forge it.
--
-- A case starts open and empty, in the least urgent lane: every column but id and the target is forced.
CREATE FUNCTION "public"."cases_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.opened_at := now();
  NEW.lane := 2;
  NEW.intake_seq := 0;
  NEW.answered_seq := 0;
  NEW.state_version := 0;
  NEW.oldest_open_at := NULL;
  NEW.last_decided_at := NULL;
  NEW.closed_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."cases_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "cases_insert" BEFORE INSERT ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."cases_insert"();--> statement-breakpoint
-- An intake is received now and not erased; its receipt is pending when there is someone to mail (a notifier's contact, or
-- a signed-in reporter who alleged illegality) and none otherwise.
CREATE FUNCTION "public"."intakes_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.received_at := now();
  NEW.erased_at := NULL;
  NEW.receipt_sent_at := NULL;
  NEW.receipt := CASE WHEN NEW.contact_id IS NOT NULL OR (NEW.reporter_id IS NOT NULL AND NEW.alleges_illegal)
                      THEN 'pending'::public.delivery_state ELSE 'none'::public.delivery_state END;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intakes_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "intakes_insert" BEFORE INSERT ON "public"."intakes" FOR EACH ROW EXECUTE FUNCTION "public"."intakes_insert"();--> statement-breakpoint
-- A staff text is saved unconfirmed: only a confirmed decision, or a confirmed reveal, names it afterwards.
CREATE FUNCTION "public"."staff_texts_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.created_at := now();
  NEW.decision_id := NULL;
  NEW.confirmed_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."staff_texts_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "staff_texts_insert" BEFORE INSERT ON "public"."staff_texts" FOR EACH ROW EXECUTE FUNCTION "public"."staff_texts_insert"();--> statement-breakpoint
-- A snapshot is taken at its transaction's start, to the millisecond, as JavaScript reads times: the API reads the same
-- value in the same transaction before it computes the digest, which covers the time.
CREATE FUNCTION "public"."evidence_snapshots_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.taken_at := date_trunc('milliseconds', now());
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."evidence_snapshots_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "evidence_snapshots_insert" BEFORE INSERT ON "public"."evidence_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."evidence_snapshots_insert"();--> statement-breakpoint
CREATE FUNCTION "public"."case_access_log_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.at := now();
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."case_access_log_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "case_access_log_insert" BEFORE INSERT ON "public"."case_access_log" FOR EACH ROW EXECUTE FUNCTION "public"."case_access_log_insert"();--> statement-breakpoint
-- An image row is born on no post, visible, unheld and unerased. INSERT stays a table privilege (an insert names every
-- column), so this trigger is what keeps the three columns out of the API role's hands at insert, as the column grants do
-- at update. A row that names a post is refused (moderation_column), for every role, the migrator included: an image is
-- put on a post only by attach's update, which post_media_guard below checks against the post's author, so no insert
-- can place one on a post its owner did not write.
CREATE FUNCTION "public"."post_media_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  NEW.moderation_state := 'visible';
  NEW.hold_until := NULL;
  NEW.erased_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_insert" BEFORE INSERT ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_insert"();--> statement-breakpoint
CREATE FUNCTION "public"."media_holds_insert"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.held_at := now();
  NEW.released_at := NULL;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_holds_insert"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "media_holds_insert" BEFORE INSERT ON "public"."media_holds" FOR EACH ROW EXECUTE FUNCTION "public"."media_holds_insert"();--> statement-breakpoint
-- 3. The end of the author's appeal window and of the re-examination window: six calendar months after the person was
-- told. PostgreSQL clamps month arithmetic to the month's last day (31 August plus six months is 28 or 29 February), and
-- the UTC zone keeps the result independent of the session's. The contracts' appealDeadline computes the same.
CREATE FUNCTION "public"."appeal_deadline"(informed timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ((appeal_deadline.informed AT TIME ZONE 'UTC') + interval '6 months') AT TIME ZONE 'UTC'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."appeal_deadline"(timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."appeal_deadline"(timestamptz) TO korbat_api;--> statement-breakpoint
-- The attach trigger: every item lands in exactly one open case, as a database fact under concurrency. It runs as its
-- owner, since the API role holds no UPDATE on cases. In this order:
--   1. It forces the columns the API must not choose. suspect is the intake's "on the CSAM path, or a finding citing R2"; a
--      notice on the law alone has no rule, and suspect is then false, never null.
--   2. A re-examination is checked under a lock on its intake (FOR KEY SHARE: it waits for an erasure of the intake, which
--      takes the row FOR UPDATE), in a statement of its own after the lock, and against clock_timestamp(), never now(),
--      which is the transaction's start. It takes the target, the handle, the position and the lane of the item it
--      re-examines, whatever the insert supplied. A re-examination is not re-examined, except one about a post that is not
--      suspect and that a decision answered while nobody could open the post's images (decisions.unseen): that answer does
--      not spend the one request.
--   3. Without a case the item is answered at once and only as not_available: the CHECK intake_items_case holds the
--      same, null-safely, and the refusal here names it. With a case it takes the next number under the case's row lock;
--      a case that is closed, or that is about another target, matches no row, and the insert fails with
--      serialization_failure, so the intake's transaction is retried into a new case.
CREATE FUNCTION "public"."intake_items_attach"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  intake public.intakes;
  original public.intake_items;
BEGIN
  NEW.created_at := now();
  NEW.answered_by := NULL;
  NEW.outcome_sent_at := NULL;
  NEW.shown_outcome := NULL;
  NEW.revision_pending_at := NULL;
  NEW.revised_sent_at := NULL;
  NEW.erased_at := NULL;
  IF NEW.reexamines_item_id IS NOT NULL THEN
    PERFORM 1 FROM public.intakes n WHERE n.id = NEW.intake_id FOR KEY SHARE;
  END IF;
  -- A statement of its own: after the lock above it sees an erasure that committed while the lock waited.
  SELECT n.* INTO intake FROM public.intakes n WHERE n.id = NEW.intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'an intake item names an intake that does not exist' USING ERRCODE = '23503';
  END IF;
  NEW.reporter_account_id := intake.reporter_id;
  NEW.alleges_illegal := intake.alleges_illegal;
  NEW.suspect := intake.csam OR coalesce(intake.rule_id = 'R2', false);
  NEW.outcome_mail := CASE WHEN intake.contact_id IS NOT NULL OR (intake.reporter_id IS NOT NULL AND intake.alleges_illegal)
                           THEN 'pending'::public.delivery_state ELSE 'none'::public.delivery_state END;

  IF NEW.reexamines_item_id IS NOT NULL THEN
    SELECT o.* INTO original
      FROM public.intake_items o
      LEFT JOIN public.decisions d ON d.id = o.answered_by
     WHERE o.id = NEW.reexamines_item_id
       AND o.intake_id = NEW.intake_id
       AND (o.reexamines_item_id IS NULL OR (o.target_type = 'post' AND NOT o.suspect AND d.unseen))
       AND o.answered_by IS NOT NULL
       AND o.outcome IN ('no_violation', 'not_evident')
       AND o.outcome_sent_at IS NOT NULL
       AND clock_timestamp() < public.appeal_deadline(o.outcome_sent_at);
    IF NOT FOUND OR intake.erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'reexamination_not_open';
    END IF;
    NEW.target_type := original.target_type;
    NEW.target_id := original.target_id;
    NEW.named_handle := original.named_handle;
    NEW.position := original.position;
    NEW.lane := original.lane;
  END IF;
  IF NEW.target_type = 'post' THEN
    NEW.named_handle := NULL;
  END IF;

  IF NEW.case_id IS NULL THEN
    NEW.seq := NULL;
    IF NEW.outcome IS DISTINCT FROM 'not_available' THEN
      RAISE EXCEPTION 'an item without a case is stored only as not_available (intake_items_case)'
        USING ERRCODE = '23514', TABLE = 'intake_items', CONSTRAINT = 'intake_items_case';
    END IF;
    RETURN NEW;
  END IF;
  NEW.outcome := NULL;
  UPDATE public.cases c
     SET intake_seq = c.intake_seq + 1,
         lane = CASE WHEN c.answered_seq = c.intake_seq THEN NEW.lane ELSE least(c.lane, NEW.lane) END,
         oldest_open_at = coalesce(c.oldest_open_at, now())
   WHERE c.id = NEW.case_id AND c.closed_at IS NULL AND c.target_type = NEW.target_type AND c.target_id = NEW.target_id
  RETURNING c.intake_seq INTO NEW.seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_closed' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intake_items_attach"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "intake_items_attach" BEFORE INSERT ON "public"."intake_items" FOR EACH ROW EXECUTE FUNCTION "public"."intake_items_attach"();--> statement-breakpoint
-- A post's card shows the images of the post it quotes, so a suspect item about a post that quotes another is a report
-- about both: the intake adds an item for the quoted post, at its origin's position plus 10. This constraint trigger holds
-- that rule at commit, so that no later intake path can forget the quoted post. It refuses (quote_item_missing) unless:
--   (a) a suspect item about a post, at a position up to 10, that is no re-examination and whose post quotes another, has
--       beside it in its intake an item on that post that is no re-examination;
--   (b) an item at a position above 10 that is no re-examination has, in its intake at its position minus 10, a suspect
--       item about a post that quotes the item's own target;
--   (c) a re-examination of a suspect item about a post, whose intake holds an added item on the post it quotes, leaves no
--       such added item open to re-examination: it is unanswered, or was not answered "no action", or is not released,
--       or its window has passed, or a re-examination of it exists, this transaction's included.
-- An item without a case (a link that names no row) passes. No retry repairs a missing item, so the code is a defect of the
-- caller, not one of the retried SQLSTATEs. It reads the post by its key and the intake's items through
-- intake_items_target_once, as its owner.
CREATE FUNCTION "public"."intake_items_quote"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  origin public.intake_items;
  quoted uuid;
BEGIN
  IF NEW.case_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.reexamines_item_id IS NULL THEN
    IF NEW.position <= 10 THEN
      IF NEW.suspect AND NEW.target_type = 'post' THEN
        SELECT p.quote_of_id INTO quoted FROM public.posts p WHERE p.id = NEW.target_id;
        IF quoted IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.intake_items i
           WHERE i.intake_id = NEW.intake_id AND i.target_type = 'post' AND i.target_id = quoted AND i.reexamines_item_id IS NULL
        ) THEN
          RAISE EXCEPTION 'quote_item_missing';
        END IF;
      END IF;
    ELSIF NEW.target_type <> 'post' OR NOT EXISTS (
      SELECT 1 FROM public.intake_items o
        JOIN public.posts p ON p.id = o.target_id
       WHERE o.intake_id = NEW.intake_id AND o.reexamines_item_id IS NULL AND o.position = NEW.position - 10
         AND o.suspect AND o.target_type = 'post' AND p.quote_of_id = NEW.target_id
    ) THEN
      RAISE EXCEPTION 'quote_item_missing';
    END IF;
    RETURN NULL;
  END IF;
  SELECT o.* INTO origin FROM public.intake_items o WHERE o.id = NEW.reexamines_item_id;
  IF FOUND AND origin.suspect AND origin.target_type = 'post' THEN
    SELECT p.quote_of_id INTO quoted FROM public.posts p WHERE p.id = origin.target_id;
    IF quoted IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.intake_items a
       WHERE a.intake_id = NEW.intake_id AND a.target_type = 'post' AND a.target_id = quoted AND a.reexamines_item_id IS NULL AND a.position > 10
         AND a.answered_by IS NOT NULL AND a.outcome IN ('no_violation', 'not_evident') AND a.outcome_sent_at IS NOT NULL
         AND clock_timestamp() < public.appeal_deadline(a.outcome_sent_at)
         AND NOT EXISTS (SELECT 1 FROM public.intake_items r WHERE r.reexamines_item_id = a.id)
    ) THEN
      RAISE EXCEPTION 'quote_item_missing';
    END IF;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."intake_items_quote"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "intake_items_quote" AFTER INSERT ON "public"."intake_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."intake_items_quote"();--> statement-breakpoint
-- The one definition of "in force": every ledger row of a measure kind that no row reverses and, when its decision was taken
-- while deciding (interim), whose case is still open. A seal taken while deciding is a measure of the suspicion, not of
-- the case: it is in force while its case holds an unanswered suspect item that arrived no later than the seal's decision,
-- so it ends by itself when an admin answers the suspect items, also while another item keeps the case open, and a suspect
-- item that arrives after it ended never brings it back (the post is frozen again through the new item, and a person
-- seals again). The view runs with its reader's rights. It names no value of post_state, and every enum value it names
-- is created by this migration, so it means the same on a database upgraded from 0013 as on a fresh one.
CREATE VIEW "public"."measures_in_force" WITH (security_invoker = true) AS
SELECT a.id, a.kind, a.post_id, a.media_id, a.subject_account_id, d.id AS decision_id, d.kind AS decision_kind, d.case_id
  FROM public.decision_actions a
  JOIN public.decisions d ON d.id = a.decision_id
 WHERE a.kind IN ('withhold', 'remove', 'seal_media', 'withhold_media', 'remove_media', 'reset_display_name', 'reset_bio')
   AND NOT EXISTS (SELECT 1 FROM public.decision_actions r WHERE r.reverses_action_id = a.id)
   AND (d.kind <> 'interim'
     OR CASE WHEN a.kind = 'seal_media'
          THEN EXISTS (SELECT 1 FROM public.intake_items i
                        WHERE i.case_id = d.case_id AND i.suspect AND i.answered_by IS NULL AND i.created_at <= d.decided_at)
          ELSE EXISTS (SELECT 1 FROM public.cases c WHERE c.id = d.case_id AND c.closed_at IS NULL)
        END);--> statement-breakpoint
-- 0001's default privileges cover views too; the API role reads this one and nothing more.
REVOKE ALL ON "public"."measures_in_force" FROM korbat_api;--> statement-breakpoint
GRANT SELECT ON "public"."measures_in_force" TO korbat_api;--> statement-breakpoint
-- The one definition of the freeze: a post is frozen while an open case about it, or about its author's account, holds an
-- unanswered suspect item, or a seal in force lists it. It reads no posts row, because inside a cascade from a deleted post
-- that row is already gone for the trigger's statement: the caller hands it the post and its author. Each of its three arms
-- is driven by an index (cases_one_open_per_target, then intake_items_suspect_open_idx only when a case was found;
-- seal_posts_post_idx), so a post nobody reported costs three index probes. In the database only post_frozen and the keep
-- trigger's function name it.
CREATE FUNCTION "public"."frozen_for"(post uuid, author uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'post' AND c.target_id = frozen_for.post)
    OR EXISTS (
      SELECT 1 FROM public.cases c
      JOIN public.intake_items i ON i.case_id = c.id AND i.suspect AND i.answered_by IS NULL
      WHERE c.closed_at IS NULL AND c.target_type = 'account' AND c.target_id = frozen_for.author)
    OR EXISTS (
      SELECT 1 FROM public.seal_posts s
      JOIN public.measures_in_force m ON m.id = s.action_id
      WHERE s.post_id = frozen_for.post)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."frozen_for"(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."frozen_for"(uuid, uuid) TO korbat_api;--> statement-breakpoint
-- That definition for the callers that have a post and not its author.
CREATE FUNCTION "public"."post_frozen"(post uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.frozen_for(post_frozen.post, (SELECT p.author_id FROM public.posts p WHERE p.id = post_frozen.post))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_frozen"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."post_frozen"(uuid) TO korbat_api;--> statement-breakpoint
-- Gate K: no image row of a frozen post, and no row a case's hold retains, is deleted, by any delete path present or
-- future. The function runs as its owner, so its read of the freeze depends on no grant or row policy of the deleting
-- role. It tests the row's own columns first, so the sweeper's deletes of uploads on no post never read the predicate: such
-- a row is retained only while a hold stands. For a row on a post it refuses to run outside READ COMMITTED
-- (read_committed_only), since under any other level its read would see the transaction's old snapshot. The row is
-- locked before a BEFORE DELETE row trigger fires, and the read below is a statement of its own, which takes a fresh
-- snapshot: a delete that waited for an intake's row locks therefore reads the suspect item that intake committed. A filter
-- inside the deleting statement would not, so no deleter relies on one. A retained row is skipped on a direct delete (the
-- trigger answers NULL, RETURNING omits the row, and no deletion is requested for its files); inside a cascade, where
-- skipping would silently break the foreign key, the delete is refused (restrict_violation). The image's owner stands for
-- the post's author: post_media_guard below makes them the same by construction.
CREATE FUNCTION "public"."post_media_keep"() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  retained boolean;
BEGIN
  IF OLD.post_id IS NULL THEN
    retained := coalesce(OLD.hold_until > now(), false);
  ELSE
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'read_committed_only' USING ERRCODE = '25000';
    END IF;
    IF OLD.hold_until > now() THEN
      retained := true;
    ELSE
      SELECT public.frozen_for(OLD.post_id, OLD.owner_id) INTO retained;
    END IF;
  END IF;
  IF retained THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION 'post_media row % is retained', OLD.id USING ERRCODE = '23001';
    END IF;
    RETURN NULL;
  END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_keep"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_keep" BEFORE DELETE ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_keep"();--> statement-breakpoint
-- An image stays on its post, with the content it was posted with. For every role, the migrator included: an image never
-- leaves its post (so nothing detaches it into the sweeper's reach), an upload goes only onto a post of its owner, and the
-- owner never changes; with the insert trigger above, which takes no row that names a post, the owner of an attached row
-- is its post's author, which is what lets the keep trigger pass the owner as the author. And unless the migrator's own
-- functions run it: the alt text, the position, the size and the blurhash of an attached row never change, since on an
-- account's case the alt texts on the kept rows are the only copy of them (an erasure, which runs as the migrator, may
-- still blank what it erases). The function is plain: current_user is the role that ran the statement, and the API role
-- can neither become the migrator nor disable the trigger.
CREATE FUNCTION "public"."post_media_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF OLD.post_id IS NOT NULL THEN
    IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
    IF current_user <> 'korbat_migrate' AND (NEW.alt_text IS DISTINCT FROM OLD.alt_text OR NEW.position IS DISTINCT FROM OLD.position
        OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.blurhash IS DISTINCT FROM OLD.blurhash) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = NEW.post_id AND p.author_id IS DISTINCT FROM NEW.owner_id) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_media_guard"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "post_media_guard" BEFORE UPDATE OF "post_id", "owner_id", "alt_text", "position", "width", "height", "blurhash" ON "public"."post_media" FOR EACH ROW EXECUTE FUNCTION "public"."post_media_guard"();--> statement-breakpoint
-- A hold keeps the image's row: post_media.hold_until is the latest end of the image's unreleased holds (infinity for a
-- hold without an end), and the keep trigger retains a row while that lies ahead. Three statements, in this order: lock
-- the image's row; then, in a statement of its own, read the holds, which under READ COMMITTED takes its snapshot after
-- the lock was granted and so sees every hold committed meanwhile; then write. One UPDATE whose subquery reads the holds is
-- not enough: a release that waits for a new hold's row lock re-checks only the image's row and keeps its subquery's old
-- snapshot, which left an image unheld under an unreleased hold.
CREATE FUNCTION "public"."media_holds_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  latest timestamptz;
BEGIN
  PERFORM 1 FROM public.post_media m WHERE m.id = NEW.media_id FOR NO KEY UPDATE;
  SELECT max(coalesce(h.until, 'infinity'::timestamptz)) INTO latest
    FROM public.media_holds h WHERE h.media_id = NEW.media_id AND h.released_at IS NULL;
  UPDATE public.post_media m SET hold_until = latest WHERE m.id = NEW.media_id;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."media_holds_apply"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "media_holds_apply" AFTER INSERT OR UPDATE ON "public"."media_holds" FOR EACH ROW EXECUTE FUNCTION "public"."media_holds_apply"();--> statement-breakpoint
-- 4. The auth tables. 0001's default privileges gave the auth role every write on new auth tables. A notifier's contact is
-- never re-encrypted or pointed at another address: the auth role stores, reads and deletes it, and moves only the day
-- it is forgotten. A suppression is inserted, read and deleted. Confirmations keep the default privileges. The staff
-- links are written only by `staff.js link` and `unlink`, as the migrator, and read only by migrator-owned definer
-- functions: the auth role holds nothing on them.
REVOKE UPDATE ON "auth"."notifier_contacts" FROM korbat_auth;--> statement-breakpoint
GRANT UPDATE ("forget_after") ON "auth"."notifier_contacts" TO korbat_auth;--> statement-breakpoint
REVOKE UPDATE ON "auth"."notifier_suppressions" FROM korbat_auth;--> statement-breakpoint
REVOKE ALL ON "auth"."staff_personal_accounts" FROM korbat_auth;--> statement-breakpoint
-- 5. The limits on staff: 60 decisions an hour and 300 a day, 400 case opens, 50 findings and 10 reveals a day. Every
-- reader falls back to these numbers when the row is missing.
INSERT INTO "public"."moderation_limits" ("id", "decisions_per_hour", "decisions_per_day", "case_opens_per_day", "findings_per_day", "reveals_per_day", "updated_at")
VALUES (1, 60, 300, 400, 50, 10, now());
```

### Create `packages/db/migrations/meta/0014_snapshot.json`

```json
{
  "id": "174d11c9-212e-43a3-9930-a94f072c47a5",
  "prevId": "fd8f0c6a-241b-4a31-a2e3-dc304f104d38",
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "auth.auth_events": {
      "name": "auth_events",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "type": {
          "name": "type",
          "type": "auth_event_type",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "auth_events_user_created_idx": {
          "name": "auth_events_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "auth_events_user_id_users_id_fk": {
          "name": "auth_events_user_id_users_id_fk",
          "tableFrom": "auth_events",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "auth_events_auth_insert": {
          "name": "auth_events_auth_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_auth"
          ],
          "withCheck": "true"
        },
        "auth_events_auth_select": {
          "name": "auth_events_auth_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.devices": {
      "name": "devices",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_hash": {
          "name": "device_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "label": {
          "name": "label",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "platform": {
          "name": "platform",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "first_seen_at": {
          "name": "first_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_seen_at": {
          "name": "last_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "devices_user_idx": {
          "name": "devices_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "devices_ip_hash_idx": {
          "name": "devices_ip_hash_idx",
          "columns": [
            {
              "expression": "ip_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "devices_user_id_users_id_fk": {
          "name": "devices_user_id_users_id_fk",
          "tableFrom": "devices",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "devices_auth_all": {
          "name": "devices_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.email_codes": {
      "name": "email_codes",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "code_hash": {
          "name": "code_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "purpose": {
          "name": "purpose",
          "type": "email_code_purpose",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "attempts": {
          "name": "attempts",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "consumed_at": {
          "name": "consumed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "flow_id": {
          "name": "flow_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "email_codes_email_idx": {
          "name": "email_codes_email_idx",
          "columns": [
            {
              "expression": "email",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "email_codes_flow_idx": {
          "name": "email_codes_flow_idx",
          "columns": [
            {
              "expression": "flow_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "email_codes_user_id_users_id_fk": {
          "name": "email_codes_user_id_users_id_fk",
          "tableFrom": "email_codes",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "email_codes_auth_all": {
          "name": "email_codes_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.passkeys": {
      "name": "passkeys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "backed_up": {
          "name": "backed_up",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "backup_eligible": {
          "name": "backup_eligible",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "uv_initialized": {
          "name": "uv_initialized",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_device_id": {
          "name": "created_device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "passkeys_credential_idx": {
          "name": "passkeys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "passkeys_user_idx": {
          "name": "passkeys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "passkeys_user_id_users_id_fk": {
          "name": "passkeys_user_id_users_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "passkeys_created_device_id_devices_id_fk": {
          "name": "passkeys_created_device_id_devices_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "created_device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "passkeys_auth_all": {
          "name": "passkeys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.sessions": {
      "name": "sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reauth_at": {
          "name": "reauth_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "factors": {
          "name": "factors",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "passkey_id": {
          "name": "passkey_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "sessions_user_idx": {
          "name": "sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "sessions_handle_idx": {
          "name": "sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "sessions_user_id_users_id_fk": {
          "name": "sessions_user_id_users_id_fk",
          "tableFrom": "sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_device_id_devices_id_fk": {
          "name": "sessions_device_id_devices_id_fk",
          "tableFrom": "sessions",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_passkey_id_passkeys_id_fk": {
          "name": "sessions_passkey_id_passkeys_id_fk",
          "tableFrom": "sessions",
          "tableTo": "passkeys",
          "schemaTo": "auth",
          "columnsFrom": [
            "passkey_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "sessions_auth_all": {
          "name": "sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_enrollments": {
      "name": "staff_enrollments",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "token_hash": {
          "name": "token_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "used_at": {
          "name": "used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_enrollments_token_hash_idx": {
          "name": "staff_enrollments_token_hash_idx",
          "columns": [
            {
              "expression": "token_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_enrollments_user_idx": {
          "name": "staff_enrollments_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_enrollments_user_id_users_id_fk": {
          "name": "staff_enrollments_user_id_users_id_fk",
          "tableFrom": "staff_enrollments",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_enrollments_auth_all": {
          "name": "staff_enrollments_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_keys": {
      "name": "staff_keys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_keys_credential_idx": {
          "name": "staff_keys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_keys_user_idx": {
          "name": "staff_keys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_keys_user_id_users_id_fk": {
          "name": "staff_keys_user_id_users_id_fk",
          "tableFrom": "staff_keys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_keys_id_user_id_unique": {
          "name": "staff_keys_id_user_id_unique",
          "nullsNotDistinct": false,
          "columns": [
            "id",
            "user_id"
          ]
        }
      },
      "policies": {
        "staff_keys_auth_all": {
          "name": "staff_keys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_keys_suspect_is_revoked": {
          "name": "staff_keys_suspect_is_revoked",
          "value": "\"auth\".\"staff_keys\".\"suspect_at\" is null or \"auth\".\"staff_keys\".\"revoked_at\" is not null"
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_sessions": {
      "name": "staff_sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "idle_expires_at": {
          "name": "idle_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "browser": {
          "name": "browser",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "staff_sessions_handle_idx": {
          "name": "staff_sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_sessions_user_idx": {
          "name": "staff_sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_sessions_user_id_users_id_fk": {
          "name": "staff_sessions_user_id_users_id_fk",
          "tableFrom": "staff_sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "staff_sessions_key_user_fk": {
          "name": "staff_sessions_key_user_fk",
          "tableFrom": "staff_sessions",
          "tableTo": "staff_keys",
          "schemaTo": "auth",
          "columnsFrom": [
            "key_id",
            "user_id"
          ],
          "columnsTo": [
            "id",
            "user_id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_sessions_auth_all": {
          "name": "staff_sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_sessions_lifetime": {
          "name": "staff_sessions_lifetime",
          "value": "\"auth\".\"staff_sessions\".\"absolute_expires_at\" <= \"auth\".\"staff_sessions\".\"created_at\" + interval '12 hours' and \"auth\".\"staff_sessions\".\"idle_expires_at\" <= \"auth\".\"staff_sessions\".\"absolute_expires_at\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.users": {
      "name": "users",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "email_verified_at": {
          "name": "email_verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "phone_hash": {
          "name": "phone_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "password_hash": {
          "name": "password_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_secret_enc": {
          "name": "totp_secret_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_enabled_at": {
          "name": "totp_enabled_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "recovery_codes_hash": {
          "name": "recovery_codes_hash",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "failed_logins": {
          "name": "failed_logins",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "locked_until": {
          "name": "locked_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "role": {
          "name": "role",
          "type": "user_role",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true,
          "default": "'user'"
        },
        "age_confirmed_at": {
          "name": "age_confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "terms_version": {
          "name": "terms_version",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "terms_accepted_at": {
          "name": "terms_accepted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "onboarded_at": {
          "name": "onboarded_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "password_changed_at": {
          "name": "password_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "totp_last_step": {
          "name": "totp_last_step",
          "type": "bigint",
          "primaryKey": false,
          "notNull": false
        },
        "purged_at": {
          "name": "purged_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "webauthn_user_id": {
          "name": "webauthn_user_id",
          "type": "bytea",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "users_email_lower_idx": {
          "name": "users_email_lower_idx",
          "columns": [
            {
              "expression": "lower(\"email\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_phone_hash_idx": {
          "name": "users_phone_hash_idx",
          "columns": [
            {
              "expression": "phone_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "phone_hash is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_webauthn_user_id_idx": {
          "name": "users_webauthn_user_id_idx",
          "columns": [
            {
              "expression": "webauthn_user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "webauthn_user_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "users_auth_all": {
          "name": "users_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.handle_history": {
      "name": "handle_history",
      "schema": "",
      "columns": {
        "handle_lower": {
          "name": "handle_lower",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "profile_id": {
          "name": "profile_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "changed_at": {
          "name": "changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "handle_history_profile_id_profiles_id_fk": {
          "name": "handle_history_profile_id_profiles_id_fk",
          "tableFrom": "handle_history",
          "tableTo": "profiles",
          "columnsFrom": [
            "profile_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "handle_history_api_all": {
          "name": "handle_history_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.profiles": {
      "name": "profiles",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "avatar_path": {
          "name": "avatar_path",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "verified_at": {
          "name": "verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "follower_count": {
          "name": "follower_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "following_count": {
          "name": "following_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "post_count": {
          "name": "post_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "handle_changed_at": {
          "name": "handle_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "show_in_explore": {
          "name": "show_in_explore",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": true
        }
      },
      "indexes": {
        "profiles_handle_lower_idx": {
          "name": "profiles_handle_lower_idx",
          "columns": [
            {
              "expression": "lower(\"handle\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "profiles_api_all": {
          "name": "profiles_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "profiles_counts_nonnegative": {
          "name": "profiles_counts_nonnegative",
          "value": "\"profiles\".\"follower_count\" >= 0 and \"profiles\".\"following_count\" >= 0 and \"profiles\".\"post_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.blocks": {
      "name": "blocks",
      "schema": "",
      "columns": {
        "blocker_id": {
          "name": "blocker_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "blocked_id": {
          "name": "blocked_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "blocks_to_created_idx": {
          "name": "blocks_to_created_idx",
          "columns": [
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "blocks_from_created_idx": {
          "name": "blocks_from_created_idx",
          "columns": [
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "blocks_blocker_id_profiles_id_fk": {
          "name": "blocks_blocker_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocker_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "blocks_blocked_id_profiles_id_fk": {
          "name": "blocks_blocked_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocked_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "blocks_blocker_id_blocked_id_pk": {
          "name": "blocks_blocker_id_blocked_id_pk",
          "columns": [
            "blocker_id",
            "blocked_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "blocks_api_all": {
          "name": "blocks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "blocks_not_self": {
          "name": "blocks_not_self",
          "value": "\"blocks\".\"blocker_id\" <> \"blocks\".\"blocked_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.bookmarks": {
      "name": "bookmarks",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "bookmarks_post_idx": {
          "name": "bookmarks_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "bookmarks_user_created_idx": {
          "name": "bookmarks_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "bookmarks_user_id_profiles_id_fk": {
          "name": "bookmarks_user_id_profiles_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "bookmarks_post_id_posts_id_fk": {
          "name": "bookmarks_post_id_posts_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "bookmarks_user_id_post_id_pk": {
          "name": "bookmarks_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "bookmarks_api_all": {
          "name": "bookmarks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_items": {
      "name": "explore_items",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "explore_items_generation_post_idx": {
          "name": "explore_items_generation_post_idx",
          "columns": [
            {
              "expression": "generation",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "explore_items_generation_explore_runs_generation_fk": {
          "name": "explore_items_generation_explore_runs_generation_fk",
          "tableFrom": "explore_items",
          "tableTo": "explore_runs",
          "columnsFrom": [
            "generation"
          ],
          "columnsTo": [
            "generation"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "explore_items_post_id_posts_id_fk": {
          "name": "explore_items_post_id_posts_id_fk",
          "tableFrom": "explore_items",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "explore_items_author_id_profiles_id_fk": {
          "name": "explore_items_author_id_profiles_id_fk",
          "tableFrom": "explore_items",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "explore_items_generation_position_pk": {
          "name": "explore_items_generation_position_pk",
          "columns": [
            "generation",
            "position"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "explore_items_api_all": {
          "name": "explore_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_runs": {
      "name": "explore_runs",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "type": "always",
            "name": "explore_runs_generation_seq",
            "schema": "public",
            "increment": "1",
            "startWith": "1",
            "minValue": "1",
            "maxValue": "2147483647",
            "cache": "1",
            "cycle": false
          }
        },
        "as_of": {
          "name": "as_of",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "formula": {
          "name": "formula",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "candidates": {
          "name": "candidates",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "items": {
          "name": "items",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "took_ms": {
          "name": "took_ms",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "explore_runs_api_all": {
          "name": "explore_runs_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.follows": {
      "name": "follows",
      "schema": "",
      "columns": {
        "follower_id": {
          "name": "follower_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "followee_id": {
          "name": "followee_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "follows_to_created_idx": {
          "name": "follows_to_created_idx",
          "columns": [
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "follows_from_created_idx": {
          "name": "follows_from_created_idx",
          "columns": [
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "follows_follower_id_profiles_id_fk": {
          "name": "follows_follower_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "follower_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "follows_followee_id_profiles_id_fk": {
          "name": "follows_followee_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "followee_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "follows_follower_id_followee_id_pk": {
          "name": "follows_follower_id_followee_id_pk",
          "columns": [
            "follower_id",
            "followee_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "follows_api_all": {
          "name": "follows_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "follows_not_self": {
          "name": "follows_not_self",
          "value": "\"follows\".\"follower_id\" <> \"follows\".\"followee_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.likes": {
      "name": "likes",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "likes_post_idx": {
          "name": "likes_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_user_created_idx": {
          "name": "likes_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_created_brin": {
          "name": "likes_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "brin",
          "with": {}
        }
      },
      "foreignKeys": {
        "likes_user_id_profiles_id_fk": {
          "name": "likes_user_id_profiles_id_fk",
          "tableFrom": "likes",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "likes_post_id_posts_id_fk": {
          "name": "likes_post_id_posts_id_fk",
          "tableFrom": "likes",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "likes_user_id_post_id_pk": {
          "name": "likes_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "likes_api_all": {
          "name": "likes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.mutes": {
      "name": "mutes",
      "schema": "",
      "columns": {
        "muter_id": {
          "name": "muter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "muted_id": {
          "name": "muted_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "mutes_to_created_idx": {
          "name": "mutes_to_created_idx",
          "columns": [
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "mutes_from_created_idx": {
          "name": "mutes_from_created_idx",
          "columns": [
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "mutes_muter_id_profiles_id_fk": {
          "name": "mutes_muter_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "mutes_muted_id_profiles_id_fk": {
          "name": "mutes_muted_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muted_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "mutes_muter_id_muted_id_pk": {
          "name": "mutes_muter_id_muted_id_pk",
          "columns": [
            "muter_id",
            "muted_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "mutes_api_all": {
          "name": "mutes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "mutes_not_self": {
          "name": "mutes_not_self",
          "value": "\"mutes\".\"muter_id\" <> \"mutes\".\"muted_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.post_media": {
      "name": "post_media",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "owner_id": {
          "name": "owner_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "media_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'processing'"
        },
        "error": {
          "name": "error",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "width": {
          "name": "width",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "height": {
          "name": "height",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "blurhash": {
          "name": "blurhash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alt_text": {
          "name": "alt_text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "nsfw_score": {
          "name": "nsfw_score",
          "type": "real",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "post_media_post_position_idx": {
          "name": "post_media_post_position_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "position",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_owner_created_idx": {
          "name": "post_media_owner_created_idx",
          "columns": [
            {
              "expression": "owner_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_status_created_idx": {
          "name": "post_media_status_created_idx",
          "columns": [
            {
              "expression": "status",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "post_media_owner_id_profiles_id_fk": {
          "name": "post_media_owner_id_profiles_id_fk",
          "tableFrom": "post_media",
          "tableTo": "profiles",
          "columnsFrom": [
            "owner_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "post_media_post_id_posts_id_fk": {
          "name": "post_media_post_id_posts_id_fk",
          "tableFrom": "post_media",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "post_media_api_all": {
          "name": "post_media_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "post_media_ready_has_dims": {
          "name": "post_media_ready_has_dims",
          "value": "\"post_media\".\"status\" <> 'ready' or (\"post_media\".\"width\" is not null and \"post_media\".\"height\" is not null and \"post_media\".\"blurhash\" is not null)"
        },
        "post_media_attached_is_complete": {
          "name": "post_media_attached_is_complete",
          "value": "\"post_media\".\"post_id\" is null or (\"post_media\".\"status\" = 'ready' and \"post_media\".\"position\" between 0 and 3 and \"post_media\".\"alt_text\" is not null)"
        },
        "post_media_alt_len": {
          "name": "post_media_alt_len",
          "value": "char_length(\"post_media\".\"alt_text\") <= 1000"
        }
      },
      "isRLSEnabled": true
    },
    "public.posts": {
      "name": "posts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "state": {
          "name": "state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "like_count": {
          "name": "like_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "repost_count": {
          "name": "repost_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "reply_count": {
          "name": "reply_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "quote_count": {
          "name": "quote_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "posts_author_created_idx": {
          "name": "posts_author_created_idx",
          "columns": [
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_created_id_idx": {
          "name": "posts_created_id_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_reply_to_created_idx": {
          "name": "posts_reply_to_created_idx",
          "columns": [
            {
              "expression": "reply_to_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_latest_idx": {
          "name": "posts_latest_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "reply_to_id is null and state = 'visible'",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_quote_of_idx": {
          "name": "posts_quote_of_idx",
          "columns": [
            {
              "expression": "quote_of_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "posts_author_id_profiles_id_fk": {
          "name": "posts_author_id_profiles_id_fk",
          "tableFrom": "posts",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "posts_reply_to_id_posts_id_fk": {
          "name": "posts_reply_to_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "reply_to_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        },
        "posts_quote_of_id_posts_id_fk": {
          "name": "posts_quote_of_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "quote_of_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "posts_api_all": {
          "name": "posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "posts_body_len": {
          "name": "posts_body_len",
          "value": "char_length(\"posts\".\"body\") <= 1000"
        },
        "posts_counts_nonnegative": {
          "name": "posts_counts_nonnegative",
          "value": "\"posts\".\"like_count\" >= 0 and \"posts\".\"repost_count\" >= 0 and \"posts\".\"reply_count\" >= 0 and \"posts\".\"quote_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.reposts": {
      "name": "reposts",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reposts_post_idx": {
          "name": "reposts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_user_created_idx": {
          "name": "reposts_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_created_brin": {
          "name": "reposts_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "brin",
          "with": {}
        }
      },
      "foreignKeys": {
        "reposts_user_id_profiles_id_fk": {
          "name": "reposts_user_id_profiles_id_fk",
          "tableFrom": "reposts",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "reposts_post_id_posts_id_fk": {
          "name": "reposts_post_id_posts_id_fk",
          "tableFrom": "reposts",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "reposts_user_id_post_id_pk": {
          "name": "reposts_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "reposts_api_all": {
          "name": "reposts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.audit_head": {
      "name": "audit_head",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "seq": {
          "name": "seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_head_api_select": {
          "name": "audit_head_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_head_single_row": {
          "name": "audit_head_single_row",
          "value": "\"audit_head\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.audit_log": {
      "name": "audit_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "actor_id": {
          "name": "actor_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "target_id": {
          "name": "target_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "request_id": {
          "name": "request_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "staff_session": {
          "name": "staff_session",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "action_hash": {
          "name": "action_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "step_up": {
          "name": "step_up",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "chain_version": {
          "name": "chain_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "chain_seq": {
          "name": "chain_seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "prev_hash": {
          "name": "prev_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        }
      },
      "indexes": {
        "audit_log_chain_seq_idx": {
          "name": "audit_log_chain_seq_idx",
          "columns": [
            {
              "expression": "chain_seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_log_api_insert": {
          "name": "audit_log_api_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_api"
          ],
          "withCheck": "true"
        },
        "audit_log_api_select": {
          "name": "audit_log_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_log_step_up_complete": {
          "name": "audit_log_step_up_complete",
          "value": "(\"audit_log\".\"action_hash\" is null) = (\"audit_log\".\"step_up\" is null) and (\"audit_log\".\"action_hash\" is null or \"audit_log\".\"key_id\" is not null)"
        }
      },
      "isRLSEnabled": true
    }
  },
  "enums": {
    "auth.auth_event_type": {
      "name": "auth_event_type",
      "schema": "auth",
      "values": [
        "signup",
        "signin_success",
        "signin_failure",
        "mfa_enabled",
        "mfa_disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
        "password_set",
        "password_changed",
        "session_revoked",
        "sessions_revoked_all",
        "account_locked",
        "new_device",
        "not_me",
        "profile_updated",
        "handle_changed",
        "email_changed",
        "badge_verified",
        "badge_removed",
        "export_created",
        "account_deleted",
        "passkey_added",
        "passkey_removed",
        "passkey_counter_regression",
        "staff_enrollment_issued",
        "staff_key_added",
        "staff_key_revoked",
        "staff_key_counter_regression",
        "staff_sign_in",
        "staff_signed_out",
        "staff_session_revoked"
      ]
    },
    "auth.email_code_purpose": {
      "name": "email_code_purpose",
      "schema": "auth",
      "values": [
        "signup",
        "login",
        "change_email",
        "recovery",
        "reauth",
        "delete_account"
      ]
    },
    "auth.user_role": {
      "name": "user_role",
      "schema": "auth",
      "values": [
        "user",
        "moderator",
        "admin"
      ]
    },
    "public.media_status": {
      "name": "media_status",
      "schema": "public",
      "values": [
        "processing",
        "ready",
        "failed"
      ]
    },
    "public.post_state": {
      "name": "post_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "deleted_by_author"
      ]
    }
  },
  "schemas": {
    "auth": "auth"
  },
  "sequences": {},
  "roles": {},
  "policies": {},
  "views": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

### Create `packages/db/migrations/meta/0015_snapshot.json`

```json
{
  "id": "ab53200f-3d13-4501-83d9-7beab82e74d8",
  "prevId": "174d11c9-212e-43a3-9930-a94f072c47a5",
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "auth.auth_events": {
      "name": "auth_events",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "type": {
          "name": "type",
          "type": "auth_event_type",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "auth_events_user_created_idx": {
          "name": "auth_events_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "auth_events_user_id_users_id_fk": {
          "name": "auth_events_user_id_users_id_fk",
          "tableFrom": "auth_events",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "auth_events_auth_insert": {
          "name": "auth_events_auth_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_auth"
          ],
          "withCheck": "true"
        },
        "auth_events_auth_select": {
          "name": "auth_events_auth_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.devices": {
      "name": "devices",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_hash": {
          "name": "device_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "label": {
          "name": "label",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "platform": {
          "name": "platform",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "first_seen_at": {
          "name": "first_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_seen_at": {
          "name": "last_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "devices_user_idx": {
          "name": "devices_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "devices_ip_hash_idx": {
          "name": "devices_ip_hash_idx",
          "columns": [
            {
              "expression": "ip_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "devices_user_id_users_id_fk": {
          "name": "devices_user_id_users_id_fk",
          "tableFrom": "devices",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "devices_auth_all": {
          "name": "devices_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.email_codes": {
      "name": "email_codes",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "code_hash": {
          "name": "code_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "purpose": {
          "name": "purpose",
          "type": "email_code_purpose",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "attempts": {
          "name": "attempts",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "consumed_at": {
          "name": "consumed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "flow_id": {
          "name": "flow_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "email_codes_email_idx": {
          "name": "email_codes_email_idx",
          "columns": [
            {
              "expression": "email",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "email_codes_flow_idx": {
          "name": "email_codes_flow_idx",
          "columns": [
            {
              "expression": "flow_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "email_codes_user_id_users_id_fk": {
          "name": "email_codes_user_id_users_id_fk",
          "tableFrom": "email_codes",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "email_codes_auth_all": {
          "name": "email_codes_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.notifier_confirmations": {
      "name": "notifier_confirmations",
      "schema": "auth",
      "columns": {
        "email_hash": {
          "name": "email_hash",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "confirmed_at": {
          "name": "confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "notifier_confirmations_auth_all": {
          "name": "notifier_confirmations_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.notifier_contacts": {
      "name": "notifier_contacts",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "name_enc": {
          "name": "name_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "email_enc": {
          "name": "email_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "email_hash": {
          "name": "email_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "mail_token_enc": {
          "name": "mail_token_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "forget_after": {
          "name": "forget_after",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "notifier_contacts_auth_all": {
          "name": "notifier_contacts_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.notifier_suppressions": {
      "name": "notifier_suppressions",
      "schema": "auth",
      "columns": {
        "email_hash": {
          "name": "email_hash",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "notifier_suppressions_auth_all": {
          "name": "notifier_suppressions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.passkeys": {
      "name": "passkeys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "backed_up": {
          "name": "backed_up",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "backup_eligible": {
          "name": "backup_eligible",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "uv_initialized": {
          "name": "uv_initialized",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_device_id": {
          "name": "created_device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "passkeys_credential_idx": {
          "name": "passkeys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "passkeys_user_idx": {
          "name": "passkeys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "passkeys_user_id_users_id_fk": {
          "name": "passkeys_user_id_users_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "passkeys_created_device_id_devices_id_fk": {
          "name": "passkeys_created_device_id_devices_id_fk",
          "tableFrom": "passkeys",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "created_device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "passkeys_auth_all": {
          "name": "passkeys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.sessions": {
      "name": "sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reauth_at": {
          "name": "reauth_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "factors": {
          "name": "factors",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "passkey_id": {
          "name": "passkey_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "sessions_user_idx": {
          "name": "sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "sessions_handle_idx": {
          "name": "sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "sessions_user_id_users_id_fk": {
          "name": "sessions_user_id_users_id_fk",
          "tableFrom": "sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_device_id_devices_id_fk": {
          "name": "sessions_device_id_devices_id_fk",
          "tableFrom": "sessions",
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsFrom": [
            "device_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "sessions_passkey_id_passkeys_id_fk": {
          "name": "sessions_passkey_id_passkeys_id_fk",
          "tableFrom": "sessions",
          "tableTo": "passkeys",
          "schemaTo": "auth",
          "columnsFrom": [
            "passkey_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "sessions_auth_all": {
          "name": "sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_enrollments": {
      "name": "staff_enrollments",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "token_hash": {
          "name": "token_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "used_at": {
          "name": "used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_enrollments_token_hash_idx": {
          "name": "staff_enrollments_token_hash_idx",
          "columns": [
            {
              "expression": "token_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_enrollments_user_idx": {
          "name": "staff_enrollments_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_enrollments_user_id_users_id_fk": {
          "name": "staff_enrollments_user_id_users_id_fk",
          "tableFrom": "staff_enrollments",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_enrollments_auth_all": {
          "name": "staff_enrollments_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_keys": {
      "name": "staff_keys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_keys_credential_idx": {
          "name": "staff_keys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_keys_user_idx": {
          "name": "staff_keys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_keys_user_id_users_id_fk": {
          "name": "staff_keys_user_id_users_id_fk",
          "tableFrom": "staff_keys",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_keys_id_user_id_unique": {
          "name": "staff_keys_id_user_id_unique",
          "nullsNotDistinct": false,
          "columns": [
            "id",
            "user_id"
          ]
        }
      },
      "policies": {
        "staff_keys_auth_all": {
          "name": "staff_keys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_keys_suspect_is_revoked": {
          "name": "staff_keys_suspect_is_revoked",
          "value": "\"auth\".\"staff_keys\".\"suspect_at\" is null or \"auth\".\"staff_keys\".\"revoked_at\" is not null"
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_personal_accounts": {
      "name": "staff_personal_accounts",
      "schema": "auth",
      "columns": {
        "staff_user_id": {
          "name": "staff_user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "personal_user_id": {
          "name": "personal_user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "linked_at": {
          "name": "linked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "staff_personal_accounts_staff_user_id_users_id_fk": {
          "name": "staff_personal_accounts_staff_user_id_users_id_fk",
          "tableFrom": "staff_personal_accounts",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "staff_user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "staff_personal_accounts_personal_user_id_users_id_fk": {
          "name": "staff_personal_accounts_personal_user_id_users_id_fk",
          "tableFrom": "staff_personal_accounts",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "personal_user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "staff_personal_accounts_staff_user_id_personal_user_id_pk": {
          "name": "staff_personal_accounts_staff_user_id_personal_user_id_pk",
          "columns": [
            "staff_user_id",
            "personal_user_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "staff_personal_accounts_auth_none": {
          "name": "staff_personal_accounts_auth_none",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "false"
        }
      },
      "checkConstraints": {
        "staff_personal_accounts_differ": {
          "name": "staff_personal_accounts_differ",
          "value": "\"auth\".\"staff_personal_accounts\".\"staff_user_id\" <> \"auth\".\"staff_personal_accounts\".\"personal_user_id\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_sessions": {
      "name": "staff_sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "idle_expires_at": {
          "name": "idle_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "browser": {
          "name": "browser",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "staff_sessions_handle_idx": {
          "name": "staff_sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "staff_sessions_user_idx": {
          "name": "staff_sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_sessions_user_id_users_id_fk": {
          "name": "staff_sessions_user_id_users_id_fk",
          "tableFrom": "staff_sessions",
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "staff_sessions_key_user_fk": {
          "name": "staff_sessions_key_user_fk",
          "tableFrom": "staff_sessions",
          "tableTo": "staff_keys",
          "schemaTo": "auth",
          "columnsFrom": [
            "key_id",
            "user_id"
          ],
          "columnsTo": [
            "id",
            "user_id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_sessions_auth_all": {
          "name": "staff_sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_sessions_lifetime": {
          "name": "staff_sessions_lifetime",
          "value": "\"auth\".\"staff_sessions\".\"absolute_expires_at\" <= \"auth\".\"staff_sessions\".\"created_at\" + interval '12 hours' and \"auth\".\"staff_sessions\".\"idle_expires_at\" <= \"auth\".\"staff_sessions\".\"absolute_expires_at\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.users": {
      "name": "users",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "email_verified_at": {
          "name": "email_verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "phone_hash": {
          "name": "phone_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "password_hash": {
          "name": "password_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_secret_enc": {
          "name": "totp_secret_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_enabled_at": {
          "name": "totp_enabled_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "recovery_codes_hash": {
          "name": "recovery_codes_hash",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "failed_logins": {
          "name": "failed_logins",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "locked_until": {
          "name": "locked_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "role": {
          "name": "role",
          "type": "user_role",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true,
          "default": "'user'"
        },
        "age_confirmed_at": {
          "name": "age_confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "terms_version": {
          "name": "terms_version",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "terms_accepted_at": {
          "name": "terms_accepted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "onboarded_at": {
          "name": "onboarded_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "password_changed_at": {
          "name": "password_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "totp_last_step": {
          "name": "totp_last_step",
          "type": "bigint",
          "primaryKey": false,
          "notNull": false
        },
        "purged_at": {
          "name": "purged_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "webauthn_user_id": {
          "name": "webauthn_user_id",
          "type": "bytea",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "users_email_lower_idx": {
          "name": "users_email_lower_idx",
          "columns": [
            {
              "expression": "lower(\"email\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_phone_hash_idx": {
          "name": "users_phone_hash_idx",
          "columns": [
            {
              "expression": "phone_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "phone_hash is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "users_webauthn_user_id_idx": {
          "name": "users_webauthn_user_id_idx",
          "columns": [
            {
              "expression": "webauthn_user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "webauthn_user_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "users_auth_all": {
          "name": "users_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.handle_history": {
      "name": "handle_history",
      "schema": "",
      "columns": {
        "handle_lower": {
          "name": "handle_lower",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "profile_id": {
          "name": "profile_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "changed_at": {
          "name": "changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "handle_history_profile_id_profiles_id_fk": {
          "name": "handle_history_profile_id_profiles_id_fk",
          "tableFrom": "handle_history",
          "tableTo": "profiles",
          "columnsFrom": [
            "profile_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "handle_history_api_all": {
          "name": "handle_history_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.profiles": {
      "name": "profiles",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "avatar_path": {
          "name": "avatar_path",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "verified_at": {
          "name": "verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "follower_count": {
          "name": "follower_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "following_count": {
          "name": "following_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "post_count": {
          "name": "post_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "handle_changed_at": {
          "name": "handle_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "show_in_explore": {
          "name": "show_in_explore",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": true
        }
      },
      "indexes": {
        "profiles_handle_lower_idx": {
          "name": "profiles_handle_lower_idx",
          "columns": [
            {
              "expression": "lower(\"handle\")",
              "asc": true,
              "isExpression": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "profiles_api_all": {
          "name": "profiles_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "profiles_counts_nonnegative": {
          "name": "profiles_counts_nonnegative",
          "value": "\"profiles\".\"follower_count\" >= 0 and \"profiles\".\"following_count\" >= 0 and \"profiles\".\"post_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.blocks": {
      "name": "blocks",
      "schema": "",
      "columns": {
        "blocker_id": {
          "name": "blocker_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "blocked_id": {
          "name": "blocked_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "blocks_to_created_idx": {
          "name": "blocks_to_created_idx",
          "columns": [
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "blocks_from_created_idx": {
          "name": "blocks_from_created_idx",
          "columns": [
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "blocks_blocker_id_profiles_id_fk": {
          "name": "blocks_blocker_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocker_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "blocks_blocked_id_profiles_id_fk": {
          "name": "blocks_blocked_id_profiles_id_fk",
          "tableFrom": "blocks",
          "tableTo": "profiles",
          "columnsFrom": [
            "blocked_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "blocks_blocker_id_blocked_id_pk": {
          "name": "blocks_blocker_id_blocked_id_pk",
          "columns": [
            "blocker_id",
            "blocked_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "blocks_api_all": {
          "name": "blocks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "blocks_not_self": {
          "name": "blocks_not_self",
          "value": "\"blocks\".\"blocker_id\" <> \"blocks\".\"blocked_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.bookmarks": {
      "name": "bookmarks",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "bookmarks_post_idx": {
          "name": "bookmarks_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "bookmarks_user_created_idx": {
          "name": "bookmarks_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "bookmarks_user_id_profiles_id_fk": {
          "name": "bookmarks_user_id_profiles_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "bookmarks_post_id_posts_id_fk": {
          "name": "bookmarks_post_id_posts_id_fk",
          "tableFrom": "bookmarks",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "bookmarks_user_id_post_id_pk": {
          "name": "bookmarks_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "bookmarks_api_all": {
          "name": "bookmarks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_items": {
      "name": "explore_items",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "explore_items_generation_post_idx": {
          "name": "explore_items_generation_post_idx",
          "columns": [
            {
              "expression": "generation",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "explore_items_generation_explore_runs_generation_fk": {
          "name": "explore_items_generation_explore_runs_generation_fk",
          "tableFrom": "explore_items",
          "tableTo": "explore_runs",
          "columnsFrom": [
            "generation"
          ],
          "columnsTo": [
            "generation"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "explore_items_post_id_posts_id_fk": {
          "name": "explore_items_post_id_posts_id_fk",
          "tableFrom": "explore_items",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "explore_items_author_id_profiles_id_fk": {
          "name": "explore_items_author_id_profiles_id_fk",
          "tableFrom": "explore_items",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "explore_items_generation_position_pk": {
          "name": "explore_items_generation_position_pk",
          "columns": [
            "generation",
            "position"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "explore_items_api_all": {
          "name": "explore_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_runs": {
      "name": "explore_runs",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "type": "always",
            "name": "explore_runs_generation_seq",
            "schema": "public",
            "increment": "1",
            "startWith": "1",
            "minValue": "1",
            "maxValue": "2147483647",
            "cache": "1",
            "cycle": false
          }
        },
        "as_of": {
          "name": "as_of",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "formula": {
          "name": "formula",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "candidates": {
          "name": "candidates",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "items": {
          "name": "items",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "took_ms": {
          "name": "took_ms",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "explore_runs_api_all": {
          "name": "explore_runs_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.follows": {
      "name": "follows",
      "schema": "",
      "columns": {
        "follower_id": {
          "name": "follower_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "followee_id": {
          "name": "followee_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "follows_to_created_idx": {
          "name": "follows_to_created_idx",
          "columns": [
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "follows_from_created_idx": {
          "name": "follows_from_created_idx",
          "columns": [
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "follows_follower_id_profiles_id_fk": {
          "name": "follows_follower_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "follower_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "follows_followee_id_profiles_id_fk": {
          "name": "follows_followee_id_profiles_id_fk",
          "tableFrom": "follows",
          "tableTo": "profiles",
          "columnsFrom": [
            "followee_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "follows_follower_id_followee_id_pk": {
          "name": "follows_follower_id_followee_id_pk",
          "columns": [
            "follower_id",
            "followee_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "follows_api_all": {
          "name": "follows_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "follows_not_self": {
          "name": "follows_not_self",
          "value": "\"follows\".\"follower_id\" <> \"follows\".\"followee_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.likes": {
      "name": "likes",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "likes_post_idx": {
          "name": "likes_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_user_created_idx": {
          "name": "likes_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "likes_created_brin": {
          "name": "likes_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "brin",
          "with": {}
        }
      },
      "foreignKeys": {
        "likes_user_id_profiles_id_fk": {
          "name": "likes_user_id_profiles_id_fk",
          "tableFrom": "likes",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "likes_post_id_posts_id_fk": {
          "name": "likes_post_id_posts_id_fk",
          "tableFrom": "likes",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "likes_user_id_post_id_pk": {
          "name": "likes_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "likes_api_all": {
          "name": "likes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.mutes": {
      "name": "mutes",
      "schema": "",
      "columns": {
        "muter_id": {
          "name": "muter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "muted_id": {
          "name": "muted_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "mutes_to_created_idx": {
          "name": "mutes_to_created_idx",
          "columns": [
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "mutes_from_created_idx": {
          "name": "mutes_from_created_idx",
          "columns": [
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "mutes_muter_id_profiles_id_fk": {
          "name": "mutes_muter_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "mutes_muted_id_profiles_id_fk": {
          "name": "mutes_muted_id_profiles_id_fk",
          "tableFrom": "mutes",
          "tableTo": "profiles",
          "columnsFrom": [
            "muted_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "mutes_muter_id_muted_id_pk": {
          "name": "mutes_muter_id_muted_id_pk",
          "columns": [
            "muter_id",
            "muted_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "mutes_api_all": {
          "name": "mutes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "mutes_not_self": {
          "name": "mutes_not_self",
          "value": "\"mutes\".\"muter_id\" <> \"mutes\".\"muted_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.post_media": {
      "name": "post_media",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "owner_id": {
          "name": "owner_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "media_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'processing'"
        },
        "error": {
          "name": "error",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "width": {
          "name": "width",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "height": {
          "name": "height",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "blurhash": {
          "name": "blurhash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alt_text": {
          "name": "alt_text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "nsfw_score": {
          "name": "nsfw_score",
          "type": "real",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "moderation_state": {
          "name": "moderation_state",
          "type": "media_moderation_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "hold_until": {
          "name": "hold_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "post_media_post_position_idx": {
          "name": "post_media_post_position_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "position",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_owner_created_idx": {
          "name": "post_media_owner_created_idx",
          "columns": [
            {
              "expression": "owner_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "post_media_status_created_idx": {
          "name": "post_media_status_created_idx",
          "columns": [
            {
              "expression": "status",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "post_media_owner_id_profiles_id_fk": {
          "name": "post_media_owner_id_profiles_id_fk",
          "tableFrom": "post_media",
          "tableTo": "profiles",
          "columnsFrom": [
            "owner_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "post_media_post_id_posts_id_fk": {
          "name": "post_media_post_id_posts_id_fk",
          "tableFrom": "post_media",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "post_media_api_all": {
          "name": "post_media_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "post_media_ready_has_dims": {
          "name": "post_media_ready_has_dims",
          "value": "\"post_media\".\"status\" <> 'ready' or (\"post_media\".\"width\" is not null and \"post_media\".\"height\" is not null and \"post_media\".\"blurhash\" is not null)"
        },
        "post_media_attached_is_complete": {
          "name": "post_media_attached_is_complete",
          "value": "\"post_media\".\"post_id\" is null or (\"post_media\".\"status\" = 'ready' and \"post_media\".\"position\" between 0 and 3 and \"post_media\".\"alt_text\" is not null)"
        },
        "post_media_alt_len": {
          "name": "post_media_alt_len",
          "value": "char_length(\"post_media\".\"alt_text\") <= 1000"
        }
      },
      "isRLSEnabled": true
    },
    "public.posts": {
      "name": "posts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "state": {
          "name": "state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "like_count": {
          "name": "like_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "repost_count": {
          "name": "repost_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "reply_count": {
          "name": "reply_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "quote_count": {
          "name": "quote_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "moderation_level": {
          "name": "moderation_level",
          "type": "moderation_level",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "posts_author_created_idx": {
          "name": "posts_author_created_idx",
          "columns": [
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_created_id_idx": {
          "name": "posts_created_id_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_reply_to_created_idx": {
          "name": "posts_reply_to_created_idx",
          "columns": [
            {
              "expression": "reply_to_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_latest_idx": {
          "name": "posts_latest_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "reply_to_id is null and state = 'visible'",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "posts_quote_of_idx": {
          "name": "posts_quote_of_idx",
          "columns": [
            {
              "expression": "quote_of_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "posts_author_id_profiles_id_fk": {
          "name": "posts_author_id_profiles_id_fk",
          "tableFrom": "posts",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "posts_reply_to_id_posts_id_fk": {
          "name": "posts_reply_to_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "reply_to_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        },
        "posts_quote_of_id_posts_id_fk": {
          "name": "posts_quote_of_id_posts_id_fk",
          "tableFrom": "posts",
          "tableTo": "posts",
          "columnsFrom": [
            "quote_of_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "posts_api_all": {
          "name": "posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "posts_body_len": {
          "name": "posts_body_len",
          "value": "char_length(\"posts\".\"body\") <= 1000"
        },
        "posts_counts_nonnegative": {
          "name": "posts_counts_nonnegative",
          "value": "\"posts\".\"like_count\" >= 0 and \"posts\".\"repost_count\" >= 0 and \"posts\".\"reply_count\" >= 0 and \"posts\".\"quote_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.reposts": {
      "name": "reposts",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reposts_post_idx": {
          "name": "reposts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_user_created_idx": {
          "name": "reposts_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "reposts_created_brin": {
          "name": "reposts_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "brin",
          "with": {}
        }
      },
      "foreignKeys": {
        "reposts_user_id_profiles_id_fk": {
          "name": "reposts_user_id_profiles_id_fk",
          "tableFrom": "reposts",
          "tableTo": "profiles",
          "columnsFrom": [
            "user_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "reposts_post_id_posts_id_fk": {
          "name": "reposts_post_id_posts_id_fk",
          "tableFrom": "reposts",
          "tableTo": "posts",
          "columnsFrom": [
            "post_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "reposts_user_id_post_id_pk": {
          "name": "reposts_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "reposts_api_all": {
          "name": "reposts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.appeals": {
      "name": "appeals",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "appellant_account_id": {
          "name": "appellant_account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_salt": {
          "name": "statement_salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_digest": {
          "name": "statement_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "filed_at": {
          "name": "filed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "answered_by": {
          "name": "answered_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "result": {
          "name": "result",
          "type": "appeal_result",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "answered_at": {
          "name": "answered_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "appeals_once": {
          "name": "appeals_once",
          "columns": [
            {
              "expression": "decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "appeals_pending_idx": {
          "name": "appeals_pending_idx",
          "columns": [
            {
              "expression": "decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "answered_by is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "appeals_statement_idx": {
          "name": "appeals_statement_idx",
          "columns": [
            {
              "expression": "decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "statement is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "appeals_decision_id_decisions_id_fk": {
          "name": "appeals_decision_id_decisions_id_fk",
          "tableFrom": "appeals",
          "tableTo": "decisions",
          "columnsFrom": [
            "decision_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "appeals_answered_by_decisions_id_fk": {
          "name": "appeals_answered_by_decisions_id_fk",
          "tableFrom": "appeals",
          "tableTo": "decisions",
          "columnsFrom": [
            "answered_by"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "appeals_api_all": {
          "name": "appeals_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "appeals_statement_len": {
          "name": "appeals_statement_len",
          "value": "char_length(\"appeals\".\"statement\") <= 2000"
        },
        "appeals_statement": {
          "name": "appeals_statement",
          "value": "(\"appeals\".\"statement\" is null) = (\"appeals\".\"statement_salt\" is null) and (\"appeals\".\"statement\" is null or (\"appeals\".\"erased_at\" is null and \"appeals\".\"statement_salt\" ~ '^[0-9a-f]{64}$' and \"appeals\".\"statement_digest\" is not null and \"appeals\".\"statement_digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"appeals\".\"statement_salt\", 'hex') || convert_to(\"appeals\".\"statement\", 'UTF8')), 'hex'))) and (\"appeals\".\"statement\" is not null or \"appeals\".\"statement_digest\" is null or \"appeals\".\"erased_at\" is not null) and (\"appeals\".\"statement_digest\" is null or \"appeals\".\"statement_digest\" ~ '^[0-9a-f]{64}$')"
        }
      },
      "isRLSEnabled": true
    },
    "public.case_access_log": {
      "name": "case_access_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigint",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "type": "always",
            "name": "case_access_log_id_seq",
            "schema": "public",
            "increment": "1",
            "startWith": "1",
            "minValue": "1",
            "maxValue": "9223372036854775807",
            "cache": "1",
            "cycle": false
          }
        },
        "staff_id": {
          "name": "staff_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "access_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "intake_item_id": {
          "name": "intake_item_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "text_id": {
          "name": "text_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "at": {
          "name": "at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "case_access_log_staff_idx": {
          "name": "case_access_log_staff_idx",
          "columns": [
            {
              "expression": "staff_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "case_access_log_case_idx": {
          "name": "case_access_log_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "case_access_log_reveals_idx": {
          "name": "case_access_log_reveals_idx",
          "columns": [
            {
              "expression": "at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "kind = 'identity_revealed'",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "case_access_log_staff_id_profiles_id_fk": {
          "name": "case_access_log_staff_id_profiles_id_fk",
          "tableFrom": "case_access_log",
          "tableTo": "profiles",
          "columnsFrom": [
            "staff_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "case_access_log_case_id_cases_id_fk": {
          "name": "case_access_log_case_id_cases_id_fk",
          "tableFrom": "case_access_log",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "case_access_log_api_all": {
          "name": "case_access_log_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.cases": {
      "name": "cases",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "target_type": {
          "name": "target_type",
          "type": "moderation_target",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "opened_at": {
          "name": "opened_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "lane": {
          "name": "lane",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 2
        },
        "intake_seq": {
          "name": "intake_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "answered_seq": {
          "name": "answered_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "state_version": {
          "name": "state_version",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "oldest_open_at": {
          "name": "oldest_open_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "last_decided_at": {
          "name": "last_decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "closed_at": {
          "name": "closed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "cases_one_open_per_target": {
          "name": "cases_one_open_per_target",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "closed_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "cases_queue_idx": {
          "name": "cases_queue_idx",
          "columns": [
            {
              "expression": "lane",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "oldest_open_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "closed_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "cases_target_idx": {
          "name": "cases_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "opened_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "cases_api_all": {
          "name": "cases_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "cases_lane": {
          "name": "cases_lane",
          "value": "\"cases\".\"lane\" between 0 and 2"
        },
        "cases_seq_order": {
          "name": "cases_seq_order",
          "value": "\"cases\".\"answered_seq\" <= \"cases\".\"intake_seq\""
        },
        "cases_closed_answered": {
          "name": "cases_closed_answered",
          "value": "\"cases\".\"closed_at\" is null or \"cases\".\"answered_seq\" = \"cases\".\"intake_seq\""
        }
      },
      "isRLSEnabled": true
    },
    "public.decision_actions": {
      "name": "decision_actions",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "action_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "subject_account_id": {
          "name": "subject_account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "reverses_action_id": {
          "name": "reverses_action_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "no_effect": {
          "name": "no_effect",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "decision_actions_reversed_once": {
          "name": "decision_actions_reversed_once",
          "columns": [
            {
              "expression": "reverses_action_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "reverses_action_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "decision_actions_post_kind_idx": {
          "name": "decision_actions_post_kind_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "kind",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "decision_actions_subject_kind_idx": {
          "name": "decision_actions_subject_kind_idx",
          "columns": [
            {
              "expression": "subject_account_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "kind",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "decision_actions_decision_id_decisions_id_fk": {
          "name": "decision_actions_decision_id_decisions_id_fk",
          "tableFrom": "decision_actions",
          "tableTo": "decisions",
          "columnsFrom": [
            "decision_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "decision_actions_reverses_action_id_decision_actions_id_fk": {
          "name": "decision_actions_reverses_action_id_decision_actions_id_fk",
          "tableFrom": "decision_actions",
          "tableTo": "decision_actions",
          "columnsFrom": [
            "reverses_action_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "decision_actions_once": {
          "name": "decision_actions_once",
          "nullsNotDistinct": true,
          "columns": [
            "decision_id",
            "kind",
            "media_id"
          ]
        }
      },
      "policies": {
        "decision_actions_api_all": {
          "name": "decision_actions_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "decision_actions_no_effect": {
          "name": "decision_actions_no_effect",
          "value": "\"decision_actions\".\"no_effect\" in ('already', 'deleted')"
        }
      },
      "isRLSEnabled": true
    },
    "public.decisions": {
      "name": "decisions",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "decision_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "reviews_decision_id": {
          "name": "reviews_decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "appeal_id": {
          "name": "appeal_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "seen_state_version": {
          "name": "seen_state_version",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "through_seq": {
          "name": "through_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "answers_from_seq": {
          "name": "answers_from_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "outcome": {
          "name": "outcome",
          "type": "decision_outcome",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "ground": {
          "name": "ground",
          "type": "decision_ground",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "rules_version": {
          "name": "rules_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "redress_version": {
          "name": "redress_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "category": {
          "name": "category",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "category_keyword": {
          "name": "category_keyword",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "source": {
          "name": "source",
          "type": "decision_source",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "automated_detection": {
          "name": "automated_detection",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "automated_decision": {
          "name": "automated_decision",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "'not_automated'"
        },
        "territorial_scope": {
          "name": "territorial_scope",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "'worldwide'"
        },
        "snapshot_id": {
          "name": "snapshot_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "snapshot_digest": {
          "name": "snapshot_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "facts_digest": {
          "name": "facts_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "reason_digest": {
          "name": "reason_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "legal_reference_digest": {
          "name": "legal_reference_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "decided_by": {
          "name": "decided_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "xact": {
          "name": "xact",
          "type": "xid8",
          "primaryKey": false,
          "notNull": true
        },
        "puid": {
          "name": "puid",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "informed_at": {
          "name": "informed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "suspect": {
          "name": "suspect",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "unseen": {
          "name": "unseen",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "needs_admin": {
          "name": "needs_admin",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "ended_interim": {
          "name": "ended_interim",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "author_mail": {
          "name": "author_mail",
          "type": "delivery_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "author_mail_at": {
          "name": "author_mail_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "redacted_at": {
          "name": "redacted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "decisions_case_decided_idx": {
          "name": "decisions_case_decided_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "decisions_decided_by_idx": {
          "name": "decisions_decided_by_idx",
          "columns": [
            {
              "expression": "decided_by",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "decisions_reviews_idx": {
          "name": "decisions_reviews_idx",
          "columns": [
            {
              "expression": "reviews_decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "decisions_appeal_once": {
          "name": "decisions_appeal_once",
          "columns": [
            {
              "expression": "appeal_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "appeal_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "decisions_case_id_cases_id_fk": {
          "name": "decisions_case_id_cases_id_fk",
          "tableFrom": "decisions",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "decisions_reviews_decision_id_decisions_id_fk": {
          "name": "decisions_reviews_decision_id_decisions_id_fk",
          "tableFrom": "decisions",
          "tableTo": "decisions",
          "columnsFrom": [
            "reviews_decision_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        },
        "decisions_appeal_id_appeals_id_fk": {
          "name": "decisions_appeal_id_appeals_id_fk",
          "tableFrom": "decisions",
          "tableTo": "appeals",
          "columnsFrom": [
            "appeal_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        },
        "decisions_snapshot_id_evidence_snapshots_id_fk": {
          "name": "decisions_snapshot_id_evidence_snapshots_id_fk",
          "tableFrom": "decisions",
          "tableTo": "evidence_snapshots",
          "columnsFrom": [
            "snapshot_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "decisions_decided_by_profiles_id_fk": {
          "name": "decisions_decided_by_profiles_id_fk",
          "tableFrom": "decisions",
          "tableTo": "profiles",
          "columnsFrom": [
            "decided_by"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "decisions_puid_unique": {
          "name": "decisions_puid_unique",
          "nullsNotDistinct": false,
          "columns": [
            "puid"
          ]
        }
      },
      "policies": {
        "decisions_api_all": {
          "name": "decisions_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "decisions_rule_id": {
          "name": "decisions_rule_id",
          "value": "\"decisions\".\"rule_id\" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')"
        },
        "decisions_category": {
          "name": "decisions_category",
          "value": "\"decisions\".\"category\" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')"
        },
        "decisions_category_keyword": {
          "name": "decisions_category_keyword",
          "value": "\"decisions\".\"category_keyword\" in ('KEYWORD_TERRORIST_CONTENT')"
        },
        "decisions_automated_decision": {
          "name": "decisions_automated_decision",
          "value": "\"decisions\".\"automated_decision\" in ('fully', 'partially', 'not_automated')"
        },
        "decisions_territorial_scope": {
          "name": "decisions_territorial_scope",
          "value": "\"decisions\".\"territorial_scope\" = 'worldwide'"
        },
        "decisions_review_target": {
          "name": "decisions_review_target",
          "value": "(\"decisions\".\"kind\" in ('review', 'correction')) = (\"decisions\".\"reviews_decision_id\" is not null) and (\"decisions\".\"kind\" = 'review') = (\"decisions\".\"appeal_id\" is not null)"
        },
        "decisions_interim": {
          "name": "decisions_interim",
          "value": "\"decisions\".\"kind\" <> 'interim' or \"decisions\".\"through_seq\" = 0"
        },
        "decisions_ground_rule": {
          "name": "decisions_ground_rule",
          "value": "\"decisions\".\"ground\" is distinct from 'incompatible' or \"decisions\".\"rule_id\" is not null"
        },
        "decisions_ground_law": {
          "name": "decisions_ground_law",
          "value": "\"decisions\".\"ground\" is distinct from 'illegal' or \"decisions\".\"legal_reference_digest\" is not null"
        },
        "decisions_restricted": {
          "name": "decisions_restricted",
          "value": "\"decisions\".\"outcome\" <> 'restricted' or (\"decisions\".\"ground\" is not null and \"decisions\".\"facts_digest\" is not null and \"decisions\".\"reason_digest\" is not null)"
        },
        "decisions_digests": {
          "name": "decisions_digests",
          "value": "(\"decisions\".\"facts_digest\" is null or \"decisions\".\"facts_digest\" ~ '^[0-9a-f]{64}$') and (\"decisions\".\"reason_digest\" is null or \"decisions\".\"reason_digest\" ~ '^[0-9a-f]{64}$') and (\"decisions\".\"legal_reference_digest\" is null or \"decisions\".\"legal_reference_digest\" ~ '^[0-9a-f]{64}$')"
        },
        "decisions_keyword": {
          "name": "decisions_keyword",
          "value": "\"decisions\".\"category_keyword\" is null or \"decisions\".\"ground\" is not distinct from 'illegal'"
        },
        "decisions_law_no_rule": {
          "name": "decisions_law_no_rule",
          "value": "\"decisions\".\"ground\" is distinct from 'illegal' or \"decisions\".\"rule_id\" is null"
        },
        "decisions_reversal_plain": {
          "name": "decisions_reversal_plain",
          "value": "\"decisions\".\"kind\" not in ('review', 'correction') or (\"decisions\".\"ground\" is null and \"decisions\".\"rule_id\" is null and \"decisions\".\"category_keyword\" is null and \"decisions\".\"facts_digest\" is null and \"decisions\".\"legal_reference_digest\" is null)"
        }
      },
      "isRLSEnabled": true
    },
    "public.evidence_snapshots": {
      "name": "evidence_snapshots",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "moderation_target",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "taken_at": {
          "name": "taken_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "author_handle": {
          "name": "author_handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "post_state": {
          "name": "post_state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "post_created_at": {
          "name": "post_created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "media": {
          "name": "media",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "salt": {
          "name": "salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "digest": {
          "name": "digest",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "evidence_snapshots_case_taken_idx": {
          "name": "evidence_snapshots_case_taken_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "taken_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "evidence_snapshots_target_idx": {
          "name": "evidence_snapshots_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "evidence_snapshots_unerased_idx": {
          "name": "evidence_snapshots_unerased_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "erased_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "evidence_snapshots_case_id_cases_id_fk": {
          "name": "evidence_snapshots_case_id_cases_id_fk",
          "tableFrom": "evidence_snapshots",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "evidence_snapshots_api_all": {
          "name": "evidence_snapshots_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "evidence_erased": {
          "name": "evidence_erased",
          "value": "\"evidence_snapshots\".\"erased_at\" is null or (\"evidence_snapshots\".\"body\" is null and \"evidence_snapshots\".\"media\" is null and \"evidence_snapshots\".\"display_name\" is null and \"evidence_snapshots\".\"bio\" is null and \"evidence_snapshots\".\"salt\" is null)"
        }
      },
      "isRLSEnabled": true
    },
    "public.intake_items": {
      "name": "intake_items",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "intake_id": {
          "name": "intake_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "moderation_target",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "named_handle": {
          "name": "named_handle",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "seq": {
          "name": "seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "lane": {
          "name": "lane",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "reporter_account_id": {
          "name": "reporter_account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "alleges_illegal": {
          "name": "alleges_illegal",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "suspect": {
          "name": "suspect",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "outcome": {
          "name": "outcome",
          "type": "item_outcome",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "answered_by": {
          "name": "answered_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "outcome_sent_at": {
          "name": "outcome_sent_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "shown_outcome": {
          "name": "shown_outcome",
          "type": "item_outcome",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "revision_pending_at": {
          "name": "revision_pending_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revised_sent_at": {
          "name": "revised_sent_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "outcome_mail": {
          "name": "outcome_mail",
          "type": "delivery_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "reexamines_item_id": {
          "name": "reexamines_item_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_salt": {
          "name": "statement_salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_digest": {
          "name": "statement_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "intake_items_target_once": {
          "name": "intake_items_target_once",
          "columns": [
            {
              "expression": "intake_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "reexamines_item_id is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intake_items_reexamines_once": {
          "name": "intake_items_reexamines_once",
          "columns": [
            {
              "expression": "reexamines_item_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "reexamines_item_id is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intake_items_case_seq_idx": {
          "name": "intake_items_case_seq_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intake_items_reporter_once": {
          "name": "intake_items_reporter_once",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "reporter_account_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "alleges_illegal",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "where": "reexamines_item_id is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intake_items_answered_by_idx": {
          "name": "intake_items_answered_by_idx",
          "columns": [
            {
              "expression": "answered_by",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intake_items_suspect_open_idx": {
          "name": "intake_items_suspect_open_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "suspect and answered_by is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intake_items_revision_idx": {
          "name": "intake_items_revision_idx",
          "columns": [
            {
              "expression": "revision_pending_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "revision_pending_at is not null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "intake_items_intake_id_intakes_id_fk": {
          "name": "intake_items_intake_id_intakes_id_fk",
          "tableFrom": "intake_items",
          "tableTo": "intakes",
          "columnsFrom": [
            "intake_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "intake_items_case_id_cases_id_fk": {
          "name": "intake_items_case_id_cases_id_fk",
          "tableFrom": "intake_items",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "intake_items_answered_by_decisions_id_fk": {
          "name": "intake_items_answered_by_decisions_id_fk",
          "tableFrom": "intake_items",
          "tableTo": "decisions",
          "columnsFrom": [
            "answered_by"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        },
        "intake_items_reexamines_item_id_intake_items_id_fk": {
          "name": "intake_items_reexamines_item_id_intake_items_id_fk",
          "tableFrom": "intake_items",
          "tableTo": "intake_items",
          "columnsFrom": [
            "reexamines_item_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "intake_items_api_all": {
          "name": "intake_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "intake_items_position": {
          "name": "intake_items_position",
          "value": "\"intake_items\".\"position\" between 1 and 20"
        },
        "intake_items_lane": {
          "name": "intake_items_lane",
          "value": "\"intake_items\".\"lane\" between 0 and 2"
        },
        "intake_items_case": {
          "name": "intake_items_case",
          "value": "(\"intake_items\".\"case_id\" is null) = (\"intake_items\".\"seq\" is null) and (\"intake_items\".\"case_id\" is not null or \"intake_items\".\"outcome\" is not distinct from 'not_available')"
        },
        "intake_items_shown": {
          "name": "intake_items_shown",
          "value": "\"intake_items\".\"shown_outcome\" is null or \"intake_items\".\"outcome_sent_at\" is not null"
        },
        "intake_items_named_handle": {
          "name": "intake_items_named_handle",
          "value": "(\"intake_items\".\"target_type\" = 'account') = (\"intake_items\".\"named_handle\" is not null)"
        },
        "intake_items_statement_len": {
          "name": "intake_items_statement_len",
          "value": "char_length(\"intake_items\".\"statement\") <= 2000"
        },
        "intake_items_statement": {
          "name": "intake_items_statement",
          "value": "(\"intake_items\".\"statement_digest\" is null or \"intake_items\".\"reexamines_item_id\" is not null) and (\"intake_items\".\"statement\" is null) = (\"intake_items\".\"statement_salt\" is null) and (\"intake_items\".\"statement\" is null or (\"intake_items\".\"erased_at\" is null and \"intake_items\".\"statement_salt\" ~ '^[0-9a-f]{64}$' and \"intake_items\".\"statement_digest\" is not null and \"intake_items\".\"statement_digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"intake_items\".\"statement_salt\", 'hex') || convert_to(\"intake_items\".\"statement\", 'UTF8')), 'hex'))) and (\"intake_items\".\"statement\" is not null or \"intake_items\".\"statement_digest\" is null or \"intake_items\".\"erased_at\" is not null) and (\"intake_items\".\"statement_digest\" is null or \"intake_items\".\"statement_digest\" ~ '^[0-9a-f]{64}$')"
        }
      },
      "isRLSEnabled": true
    },
    "public.intakes": {
      "name": "intakes",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "kind": {
          "name": "kind",
          "type": "intake_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "ref": {
          "name": "ref",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "lookup_hash": {
          "name": "lookup_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "channel": {
          "name": "channel",
          "type": "intake_channel",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "reporter_id": {
          "name": "reporter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "finding_by": {
          "name": "finding_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "contact_id": {
          "name": "contact_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alleges_illegal": {
          "name": "alleges_illegal",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "csam": {
          "name": "csam",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "category": {
          "name": "category",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "category_keyword": {
          "name": "category_keyword",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "cited_law": {
          "name": "cited_law",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "explanation": {
          "name": "explanation",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "bona_fide": {
          "name": "bona_fide",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "automated_processing": {
          "name": "automated_processing",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "received_at": {
          "name": "received_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "receipt": {
          "name": "receipt",
          "type": "delivery_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "receipt_sent_at": {
          "name": "receipt_sent_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "intakes_reporter_idx": {
          "name": "intakes_reporter_idx",
          "columns": [
            {
              "expression": "reporter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "received_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intakes_finding_idx": {
          "name": "intakes_finding_idx",
          "columns": [
            {
              "expression": "finding_by",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "received_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "intakes_unerased_idx": {
          "name": "intakes_unerased_idx",
          "columns": [
            {
              "expression": "received_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "erased_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "intakes_reporter_id_profiles_id_fk": {
          "name": "intakes_reporter_id_profiles_id_fk",
          "tableFrom": "intakes",
          "tableTo": "profiles",
          "columnsFrom": [
            "reporter_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "set null",
          "onUpdate": "no action"
        },
        "intakes_finding_by_profiles_id_fk": {
          "name": "intakes_finding_by_profiles_id_fk",
          "tableFrom": "intakes",
          "tableTo": "profiles",
          "columnsFrom": [
            "finding_by"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "intakes_ref_unique": {
          "name": "intakes_ref_unique",
          "nullsNotDistinct": false,
          "columns": [
            "ref"
          ]
        },
        "intakes_lookup_hash_unique": {
          "name": "intakes_lookup_hash_unique",
          "nullsNotDistinct": false,
          "columns": [
            "lookup_hash"
          ]
        }
      },
      "policies": {
        "intakes_api_all": {
          "name": "intakes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "intakes_ref": {
          "name": "intakes_ref",
          "value": "\"intakes\".\"ref\" ~ '^N-[A-Z2-7]{10}$'"
        },
        "intakes_rule_id": {
          "name": "intakes_rule_id",
          "value": "\"intakes\".\"rule_id\" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')"
        },
        "intakes_category": {
          "name": "intakes_category",
          "value": "\"intakes\".\"category\" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')"
        },
        "intakes_category_keyword": {
          "name": "intakes_category_keyword",
          "value": "\"intakes\".\"category_keyword\" in ('KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL', 'KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE', 'KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS')"
        },
        "intakes_cited_law_len": {
          "name": "intakes_cited_law_len",
          "value": "char_length(\"intakes\".\"cited_law\") <= 300"
        },
        "intakes_explanation_len": {
          "name": "intakes_explanation_len",
          "value": "char_length(\"intakes\".\"explanation\") <= 2000"
        },
        "intakes_has_ground": {
          "name": "intakes_has_ground",
          "value": "\"intakes\".\"rule_id\" is not null or \"intakes\".\"alleges_illegal\" or \"intakes\".\"csam\""
        },
        "intakes_illegal_elements": {
          "name": "intakes_illegal_elements",
          "value": "\"intakes\".\"kind\" <> 'user' or not \"intakes\".\"alleges_illegal\" or \"intakes\".\"csam\" or (\"intakes\".\"bona_fide\" and (\"intakes\".\"explanation\" is not null or \"intakes\".\"erased_at\" is not null))"
        },
        "intakes_finding_legal": {
          "name": "intakes_finding_legal",
          "value": "\"intakes\".\"kind\" <> 'finding' or not \"intakes\".\"alleges_illegal\""
        },
        "intakes_illegal_not_tc": {
          "name": "intakes_illegal_not_tc",
          "value": "not \"intakes\".\"alleges_illegal\" or \"intakes\".\"category\" <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'"
        },
        "intakes_csam": {
          "name": "intakes_csam",
          "value": "not \"intakes\".\"csam\" or (\"intakes\".\"category\" = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and \"intakes\".\"reporter_id\" is null and \"intakes\".\"contact_id\" is null)"
        },
        "intakes_contact_signed_out": {
          "name": "intakes_contact_signed_out",
          "value": "\"intakes\".\"contact_id\" is null or \"intakes\".\"channel\" = 'signed_out'"
        },
        "intakes_reporter_signed_in": {
          "name": "intakes_reporter_signed_in",
          "value": "\"intakes\".\"reporter_id\" is null or \"intakes\".\"channel\" = 'signed_in'"
        },
        "intakes_finding": {
          "name": "intakes_finding",
          "value": "(\"intakes\".\"kind\" = 'finding') = (\"intakes\".\"finding_by\" is not null) and (\"intakes\".\"kind\" = 'finding') = (\"intakes\".\"channel\" = 'staff')"
        },
        "intakes_lookup": {
          "name": "intakes_lookup",
          "value": "(\"intakes\".\"lookup_hash\" is not null) = (\"intakes\".\"channel\" = 'signed_out' or \"intakes\".\"csam\")"
        },
        "intakes_erased": {
          "name": "intakes_erased",
          "value": "\"intakes\".\"erased_at\" is null or (\"intakes\".\"explanation\" is null and \"intakes\".\"cited_law\" is null)"
        },
        "intakes_r2_finding_only": {
          "name": "intakes_r2_finding_only",
          "value": "\"intakes\".\"rule_id\" is distinct from 'R2' or \"intakes\".\"kind\" = 'finding'"
        }
      },
      "isRLSEnabled": true
    },
    "public.media_holds": {
      "name": "media_holds",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigint",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "type": "always",
            "name": "media_holds_id_seq",
            "schema": "public",
            "increment": "1",
            "startWith": "1",
            "minValue": "1",
            "maxValue": "9223372036854775807",
            "cache": "1",
            "cycle": false
          }
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "held_at": {
          "name": "held_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "until": {
          "name": "until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "released_at": {
          "name": "released_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "media_holds_media_idx": {
          "name": "media_holds_media_idx",
          "columns": [
            {
              "expression": "media_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "released_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "media_holds_case_idx": {
          "name": "media_holds_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "released_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "media_holds_media_id_post_media_id_fk": {
          "name": "media_holds_media_id_post_media_id_fk",
          "tableFrom": "media_holds",
          "tableTo": "post_media",
          "columnsFrom": [
            "media_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "media_holds_case_id_cases_id_fk": {
          "name": "media_holds_case_id_cases_id_fk",
          "tableFrom": "media_holds",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "media_holds_api_all": {
          "name": "media_holds_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.moderation_limits": {
      "name": "moderation_limits",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "decisions_per_hour": {
          "name": "decisions_per_hour",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "decisions_per_day": {
          "name": "decisions_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "case_opens_per_day": {
          "name": "case_opens_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "findings_per_day": {
          "name": "findings_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "reveals_per_day": {
          "name": "reveals_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "updated_at": {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "moderation_limits_api_select": {
          "name": "moderation_limits_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "moderation_limits_single_row": {
          "name": "moderation_limits_single_row",
          "value": "\"moderation_limits\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.seal_posts": {
      "name": "seal_posts",
      "schema": "",
      "columns": {
        "action_id": {
          "name": "action_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "images": {
          "name": "images",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "seal_posts_post_idx": {
          "name": "seal_posts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "seal_posts_action_id_decision_actions_id_fk": {
          "name": "seal_posts_action_id_decision_actions_id_fk",
          "tableFrom": "seal_posts",
          "tableTo": "decision_actions",
          "columnsFrom": [
            "action_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {
        "seal_posts_action_id_post_id_pk": {
          "name": "seal_posts_action_id_post_id_pk",
          "columns": [
            "action_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "seal_posts_api_all": {
          "name": "seal_posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "seal_posts_images": {
          "name": "seal_posts_images",
          "value": "\"seal_posts\".\"images\" > 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.staff_texts": {
      "name": "staff_texts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "staff_text_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "text": {
          "name": "text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "salt": {
          "name": "salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "digest": {
          "name": "digest",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "confirmed_at": {
          "name": "confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_texts_open_idx": {
          "name": "staff_texts_open_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "where": "confirmed_at is null and erased_at is null",
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "staff_texts_case_id_cases_id_fk": {
          "name": "staff_texts_case_id_cases_id_fk",
          "tableFrom": "staff_texts",
          "tableTo": "cases",
          "columnsFrom": [
            "case_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "staff_texts_author_id_profiles_id_fk": {
          "name": "staff_texts_author_id_profiles_id_fk",
          "tableFrom": "staff_texts",
          "tableTo": "profiles",
          "columnsFrom": [
            "author_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "restrict",
          "onUpdate": "no action"
        },
        "staff_texts_decision_id_decisions_id_fk": {
          "name": "staff_texts_decision_id_decisions_id_fk",
          "tableFrom": "staff_texts",
          "tableTo": "decisions",
          "columnsFrom": [
            "decision_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_texts_digest_unique": {
          "name": "staff_texts_digest_unique",
          "nullsNotDistinct": false,
          "columns": [
            "digest"
          ]
        }
      },
      "policies": {
        "staff_texts_api_all": {
          "name": "staff_texts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_texts_text_len": {
          "name": "staff_texts_text_len",
          "value": "char_length(\"staff_texts\".\"text\") <= 5000"
        },
        "staff_texts_digest": {
          "name": "staff_texts_digest",
          "value": "(\"staff_texts\".\"text\" is null) = (\"staff_texts\".\"salt\" is null) and (\"staff_texts\".\"text\" is null) = (\"staff_texts\".\"erased_at\" is not null) and (\"staff_texts\".\"text\" is null or (\"staff_texts\".\"salt\" ~ '^[0-9a-f]{64}$' and \"staff_texts\".\"digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"staff_texts\".\"salt\", 'hex') || convert_to(\"staff_texts\".\"text\", 'UTF8')), 'hex')))"
        }
      },
      "isRLSEnabled": true
    },
    "public.audit_head": {
      "name": "audit_head",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "seq": {
          "name": "seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_head_api_select": {
          "name": "audit_head_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_head_single_row": {
          "name": "audit_head_single_row",
          "value": "\"audit_head\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.audit_log": {
      "name": "audit_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "actor_id": {
          "name": "actor_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "target_id": {
          "name": "target_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "request_id": {
          "name": "request_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "staff_session": {
          "name": "staff_session",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "action_hash": {
          "name": "action_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "step_up": {
          "name": "step_up",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "chain_version": {
          "name": "chain_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "chain_seq": {
          "name": "chain_seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "prev_hash": {
          "name": "prev_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        }
      },
      "indexes": {
        "audit_log_chain_seq_idx": {
          "name": "audit_log_chain_seq_idx",
          "columns": [
            {
              "expression": "chain_seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_log_api_insert": {
          "name": "audit_log_api_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_api"
          ],
          "withCheck": "true"
        },
        "audit_log_api_select": {
          "name": "audit_log_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_log_step_up_complete": {
          "name": "audit_log_step_up_complete",
          "value": "(\"audit_log\".\"action_hash\" is null) = (\"audit_log\".\"step_up\" is null) and (\"audit_log\".\"action_hash\" is null or \"audit_log\".\"key_id\" is not null)"
        }
      },
      "isRLSEnabled": true
    }
  },
  "enums": {
    "auth.auth_event_type": {
      "name": "auth_event_type",
      "schema": "auth",
      "values": [
        "signup",
        "signin_success",
        "signin_failure",
        "mfa_enabled",
        "mfa_disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
        "password_set",
        "password_changed",
        "session_revoked",
        "sessions_revoked_all",
        "account_locked",
        "new_device",
        "not_me",
        "profile_updated",
        "handle_changed",
        "email_changed",
        "badge_verified",
        "badge_removed",
        "export_created",
        "account_deleted",
        "passkey_added",
        "passkey_removed",
        "passkey_counter_regression",
        "staff_enrollment_issued",
        "staff_key_added",
        "staff_key_revoked",
        "staff_key_counter_regression",
        "staff_sign_in",
        "staff_signed_out",
        "staff_session_revoked"
      ]
    },
    "auth.email_code_purpose": {
      "name": "email_code_purpose",
      "schema": "auth",
      "values": [
        "signup",
        "login",
        "change_email",
        "recovery",
        "reauth",
        "delete_account"
      ]
    },
    "auth.user_role": {
      "name": "user_role",
      "schema": "auth",
      "values": [
        "user",
        "moderator",
        "admin"
      ]
    },
    "public.media_moderation_state": {
      "name": "media_moderation_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "sealed"
      ]
    },
    "public.media_status": {
      "name": "media_status",
      "schema": "public",
      "values": [
        "processing",
        "ready",
        "failed"
      ]
    },
    "public.moderation_level": {
      "name": "moderation_level",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed"
      ]
    },
    "public.post_state": {
      "name": "post_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "deleted_by_author"
      ]
    },
    "public.access_kind": {
      "name": "access_kind",
      "schema": "public",
      "values": [
        "case_opened",
        "image_viewed",
        "identity_revealed"
      ]
    },
    "public.action_kind": {
      "name": "action_kind",
      "schema": "public",
      "values": [
        "withhold",
        "remove",
        "seal_media",
        "withhold_media",
        "remove_media",
        "reset_display_name",
        "reset_bio",
        "restore",
        "unseal_media",
        "restore_media",
        "restore_display_name",
        "restore_bio"
      ]
    },
    "public.appeal_result": {
      "name": "appeal_result",
      "schema": "public",
      "values": [
        "kept",
        "partly_reversed",
        "reversed"
      ]
    },
    "public.decision_ground": {
      "name": "decision_ground",
      "schema": "public",
      "values": [
        "incompatible",
        "illegal"
      ]
    },
    "public.decision_kind": {
      "name": "decision_kind",
      "schema": "public",
      "values": [
        "interim",
        "final",
        "review",
        "correction"
      ]
    },
    "public.decision_outcome": {
      "name": "decision_outcome",
      "schema": "public",
      "values": [
        "restricted",
        "no_violation",
        "not_evident",
        "kept",
        "partly_reversed",
        "reversed"
      ]
    },
    "public.decision_source": {
      "name": "decision_source",
      "schema": "public",
      "values": [
        "notice",
        "report",
        "own_initiative"
      ]
    },
    "public.delivery_state": {
      "name": "delivery_state",
      "schema": "public",
      "values": [
        "pending",
        "sent",
        "folded",
        "suppressed",
        "no_address",
        "none",
        "failed"
      ]
    },
    "public.intake_channel": {
      "name": "intake_channel",
      "schema": "public",
      "values": [
        "signed_in",
        "signed_out",
        "staff"
      ]
    },
    "public.intake_kind": {
      "name": "intake_kind",
      "schema": "public",
      "values": [
        "user",
        "finding"
      ]
    },
    "public.item_outcome": {
      "name": "item_outcome",
      "schema": "public",
      "values": [
        "restricted_rule",
        "restricted_legal",
        "no_violation",
        "not_evident",
        "not_available",
        "partly_reversed",
        "reversed"
      ]
    },
    "public.moderation_target": {
      "name": "moderation_target",
      "schema": "public",
      "values": [
        "post",
        "account"
      ]
    },
    "public.staff_text_kind": {
      "name": "staff_text_kind",
      "schema": "public",
      "values": [
        "facts",
        "reason",
        "legal_reference",
        "review_reason",
        "reveal_reason",
        "note",
        "seal_declined"
      ]
    }
  },
  "schemas": {
    "auth": "auth"
  },
  "sequences": {},
  "roles": {},
  "policies": {},
  "views": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

### Create `packages/db/src/schema/moderation.ts`

```ts
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgPolicy, pgTable, primaryKey, smallint, text, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { postMedia, postState } from "./content";
import { apiRole, fullAccess, ts, xid8 } from "./helpers";
import { profiles } from "./identity";

// Moderation cases (3c design, section 6.1). The API inserts rows; migrator-owned triggers and functions (migrations 0015
// to 0018) check them, force the columns marked "forced" whatever an insert supplied, and derive every restriction from
// them. Every table has one allow-all policy for the API role: the grants of migration 0015 do the restricting.

export const moderationTarget = pgEnum("moderation_target", ["post", "account"]);
/** Who an intake comes from: a user's report or notice, or a moderator's own finding. */
export const intakeKind = pgEnum("intake_kind", ["user", "finding"]);
export const intakeChannel = pgEnum("intake_channel", ["signed_in", "signed_out", "staff"]);
/** The state of one mail korbat owes. `failed` is final: the relay refused the address for good, or five days passed. */
export const deliveryState = pgEnum("delivery_state", ["pending", "sent", "folded", "suppressed", "no_address", "none", "failed"]);
export const itemOutcome = pgEnum("item_outcome", ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]);
export const decisionKind = pgEnum("decision_kind", ["interim", "final", "review", "correction"]);
export const decisionOutcome = pgEnum("decision_outcome", ["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]);
export const decisionGround = pgEnum("decision_ground", ["incompatible", "illegal"]);
export const decisionSource = pgEnum("decision_source", ["notice", "report", "own_initiative"]);
/** The seven measures, then the five reversals. The view measures_in_force (migration 0015) names the measures. */
export const actionKind = pgEnum("action_kind", [
  "withhold",
  "remove",
  "seal_media",
  "withhold_media",
  "remove_media",
  "reset_display_name",
  "reset_bio",
  "restore",
  "unseal_media",
  "restore_media",
  "restore_display_name",
  "restore_bio",
]);
export const appealResult = pgEnum("appeal_result", ["kept", "partly_reversed", "reversed"]);
export const staffTextKind = pgEnum("staff_text_kind", ["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"]);
export const accessKind = pgEnum("access_kind", ["case_opened", "image_viewed", "identity_revealed"]);

// The lists below are written from the contracts' constants (TDB_CATEGORIES, CSAM_KEYWORDS, DECISION_KEYWORDS and the rule
// ids of RULE_DEFAULT_CATEGORY): @korbat/db does not depend on @korbat/contracts, so a database test holds each CHECK, as
// the migrated database defines it, to its constant. They are text under CHECK lists, never enums, because the
// Commission renames and removes Transparency Database values and an enum cannot drop one. A later migration only adds
// values to a list: a CHECK cannot drop a value that a kept row holds.
const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"];
const TDB_CATEGORIES = [
  "STATEMENT_CATEGORY_ANIMAL_WELFARE",
  "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE",
  "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
  "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
  "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
  "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
  "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
  "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
  "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
  "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
  "STATEMENT_CATEGORY_SELF_HARM",
  "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
  "STATEMENT_CATEGORY_VIOLENCE",
];
const CSAM_KEYWORDS = ["KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL", "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE", "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS"];
const DECISION_KEYWORDS = ["KEYWORD_TERRORIST_CONTENT"];

/** The values as a SQL list of string literals. They are constants of this file, plain upper-case words. */
const listOf = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(", "));

/**
 * One case per target while it is open: the partial unique index makes that a database fact under concurrency. The API
 * role may only insert and read; the trigger cases_insert forces every column but id and the target to its initial value,
 * and the derived columns move only through the triggers of intake_items (0015) and decisions (0016).
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: moderationTarget("target_type").notNull(),
    /** A post's id or an account's. No foreign key: it names two tables, and posts and profiles are never deleted in production. */
    targetId: uuid("target_id").notNull(),
    /** Forced: now(). */
    openedAt: ts("opened_at").notNull(),
    /** The most severe lane of the case's unanswered items: 0 is the most urgent. */
    lane: smallint("lane").notNull().default(2),
    /** The number the newest item got; items are numbered from 1 in the order they attached. */
    intakeSeq: integer("intake_seq").notNull().default(0),
    /** The number of the last item a final decision answered. */
    answeredSeq: integer("answered_seq").notNull().default(0),
    /** Moves with every decision: a decision names the version its moderator saw and is refused when another landed since. */
    stateVersion: integer("state_version").notNull().default(0),
    /** When the oldest unanswered item arrived; null when every item is answered. */
    oldestOpenAt: ts("oldest_open_at"),
    lastDecidedAt: ts("last_decided_at"),
    closedAt: ts("closed_at"),
  },
  (t) => [
    check("cases_lane", sql`${t.lane} between 0 and 2`),
    check("cases_seq_order", sql`${t.answeredSeq} <= ${t.intakeSeq}`),
    check("cases_closed_answered", sql`${t.closedAt} is null or ${t.answeredSeq} = ${t.intakeSeq}`),
    uniqueIndex("cases_one_open_per_target").on(t.targetType, t.targetId).where(sql`closed_at is null`),
    /** The queue: open cases by lane, then by their oldest unanswered item, read without a sort. */
    index("cases_queue_idx").on(t.lane, t.oldestOpenAt).where(sql`closed_at is null`),
    index("cases_target_idx").on(t.targetType, t.targetId, t.openedAt),
    fullAccess("cases_api_all", apiRole),
  ],
).enableRLS();

/**
 * One report, one Article 16 notice or one moderator's own finding. The API role may insert and read, and update only the
 * receipt's state; the trigger intakes_insert forces received_at, erased_at, receipt_sent_at and receipt. A notifier's name
 * and address are not here: contact_id names a row of auth.notifier_contacts, which the API role cannot reach.
 */
export const intakes = pgTable(
  "intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: intakeKind("kind").notNull(),
    /** The public reference printed on screens and mails, made by the API: N- and ten base32 characters. */
    ref: text("ref").notNull().unique(),
    /** The sha256 hex of the notice's token, for a signed-out notice and for every notice on the CSAM path. */
    lookupHash: text("lookup_hash").unique(),
    channel: intakeChannel("channel").notNull(),
    reporterId: uuid("reporter_id").references(() => profiles.id, { onDelete: "set null" }),
    /** The staff account behind a finding. On delete restrict: the record of who opened a finding stays. */
    findingBy: uuid("finding_by").references(() => profiles.id, { onDelete: "restrict" }),
    /** The auth-side contact's id. No foreign key, as profiles.id has none to auth.users. */
    contactId: uuid("contact_id"),
    ruleId: text("rule_id"),
    allegesIllegal: boolean("alleges_illegal").notNull().default(false),
    /** The path for suspected child sexual abuse material: no account and no contact is ever stored with it. */
    csam: boolean("csam").notNull().default(false),
    /** One of the Transparency Database's categories. */
    category: text("category").notNull(),
    /** Null for the CSAM path's "abuse" choice, for which the Transparency Database has no keyword. */
    categoryKeyword: text("category_keyword"),
    citedLaw: text("cited_law"),
    explanation: text("explanation"),
    bonaFide: boolean("bona_fide").notNull().default(false),
    /** False in 3c; disclosed in the decision when true (Digital Services Act, Article 16(6)). */
    automatedProcessing: boolean("automated_processing").notNull().default(false),
    /** Forced: now(). */
    receivedAt: ts("received_at").notNull(),
    /** Forced at insert: pending when a contact or (a signed-in reporter alleging illegality) can be mailed, else none. */
    receipt: deliveryState("receipt").notNull().default("none"),
    receiptSentAt: ts("receipt_sent_at"),
    /** Set when the intake record (explanation, cited law, who sent it) was erased. */
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("intakes_ref", sql`${t.ref} ~ '^N-[A-Z2-7]{10}$'`),
    check("intakes_rule_id", sql`${t.ruleId} in (${listOf(RULE_IDS)})`),
    check("intakes_category", sql`${t.category} in (${listOf(TDB_CATEGORIES)})`),
    check("intakes_category_keyword", sql`${t.categoryKeyword} in (${listOf(CSAM_KEYWORDS)})`),
    check("intakes_cited_law_len", sql`char_length(${t.citedLaw}) <= 300`),
    check("intakes_explanation_len", sql`char_length(${t.explanation}) <= 2000`),
    check("intakes_has_ground", sql`${t.ruleId} is not null or ${t.allegesIllegal} or ${t.csam}`),
    // A user's notice of illegality carries its explanation (until the record is erased) and its good-faith statement; the
    // CSAM path is exempt (Article 16(2)(c)).
    check("intakes_illegal_elements", sql`${t.kind} <> 'user' or not ${t.allegesIllegal} or ${t.csam} or (${t.bonaFide} and (${t.explanation} is not null or ${t.erasedAt} is not null))`),
    // A moderator's own finding never alleges illegality in 3c.
    check("intakes_finding_legal", sql`${t.kind} <> 'finding' or not ${t.allegesIllegal}`),
    check("intakes_illegal_not_tc", sql`not ${t.allegesIllegal} or ${t.category} <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'`),
    check("intakes_csam", sql`not ${t.csam} or (${t.category} = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and ${t.reporterId} is null and ${t.contactId} is null)`),
    check("intakes_contact_signed_out", sql`${t.contactId} is null or ${t.channel} = 'signed_out'`),
    check("intakes_reporter_signed_in", sql`${t.reporterId} is null or ${t.channel} = 'signed_in'`),
    check("intakes_finding", sql`(${t.kind} = 'finding') = (${t.findingBy} is not null) and (${t.kind} = 'finding') = (${t.channel} = 'staff')`),
    check("intakes_lookup", sql`(${t.lookupHash} is not null) = (${t.channel} = 'signed_out' or ${t.csam})`),
    check("intakes_erased", sql`${t.erasedAt} is null or (${t.explanation} is null and ${t.citedLaw} is null)`),
    // No user reports under R2: only a moderator's finding cites it, so no report of such material carries an account.
    check("intakes_r2_finding_only", sql`${t.ruleId} is distinct from 'R2' or ${t.kind} = 'finding'`),
    index("intakes_reporter_idx").on(t.reporterId, t.receivedAt),
    /** The findings limit and the home screen's count. */
    index("intakes_finding_idx").on(t.findingBy, t.receivedAt),
    /** The retention job's candidates. */
    index("intakes_unerased_idx").on(t.receivedAt).where(sql`erased_at is null`),
    fullAccess("intakes_api_all", apiRole),
  ],
).enableRLS();

/**
 * One target of an intake, in exactly one case, or in none when its link names nothing live. The trigger
 * intake_items_attach forces the columns marked forced, numbers the item into its open case and refuses a closed one; the
 * API role may insert and read, and update only outcome_mail.
 */
export const intakeItems = pgTable(
  "intake_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id").notNull().references(() => intakes.id, { onDelete: "restrict" }),
    /** 1 to 10: the targets the sender named. 11 to 20: an item korbat added for a quoted post, at its origin's position plus 10. */
    position: smallint("position").notNull(),
    targetType: moderationTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** The image the reporter pointed at: a hint. */
    mediaId: uuid("media_id"),
    /** For an account, the handle as the notice or finding named it, in lower case; forced null for a post. */
    namedHandle: text("named_handle"),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "restrict" }),
    /** Forced: the item's number in its case. */
    seq: integer("seq"),
    lane: smallint("lane").notNull(),
    /** Forced, copied from the intake. */
    reporterAccountId: uuid("reporter_account_id"),
    /** Forced, copied from the intake. */
    allegesIllegal: boolean("alleges_illegal").notNull().default(false),
    /** Forced: its intake is on the CSAM path or cites R2. The default is there so that no insert must name a forced column. */
    suspect: boolean("suspect").notNull().default(false),
    /** Forced: now(). */
    createdAt: ts("created_at").notNull(),
    /** What the answering decision found, written once by it, or not_available at insert for an item without a case. */
    outcome: itemOutcome("outcome"),
    answeredBy: uuid("answered_by").references((): AnyPgColumn => decisions.id),
    /** The release: when the outcome was first shown to whoever sent the item. */
    outcomeSentAt: ts("outcome_sent_at"),
    /** What the notifier or reporter is shown. */
    shownOutcome: itemOutcome("shown_outcome"),
    /** Set when a review or correction reverses a measure of the answering decision; cleared by the release. */
    revisionPendingAt: ts("revision_pending_at"),
    revisedSentAt: ts("revised_sent_at"),
    /** Forced at insert. */
    outcomeMail: deliveryState("outcome_mail").notNull().default("none"),
    /** Set on a re-examination: the item it re-examines. */
    reexaminesItemId: uuid("reexamines_item_id").references((): AnyPgColumn => intakeItems.id),
    /** A re-examination's statement, with the salt and digest the server made (the contracts' textDigest). */
    statement: text("statement"),
    statementSalt: text("statement_salt"),
    statementDigest: text("statement_digest"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("intake_items_position", sql`${t.position} between 1 and 20`),
    check("intake_items_lane", sql`${t.lane} between 0 and 2`),
    // An item has a case and a number, or neither; without a case it is answered at once, "not available". The outcome
    // is compared null-safely: a check passes on a null, and an item without a case and without an outcome must not.
    check("intake_items_case", sql`(${t.caseId} is null) = (${t.seq} is null) and (${t.caseId} is not null or ${t.outcome} is not distinct from 'not_available')`),
    check("intake_items_shown", sql`${t.shownOutcome} is null or ${t.outcomeSentAt} is not null`),
    // An account item always carries the handle it was named by, a post item never.
    check("intake_items_named_handle", sql`(${t.targetType} = 'account') = (${t.namedHandle} is not null)`),
    check("intake_items_statement_len", sql`char_length(${t.statement}) <= 2000`),
    // Only a re-examination has a statement, in one of three states: none; a statement held to its digest; erased
    // (statement and salt null, the digest kept, erased_at set). A statement without a digest is refused by name: the
    // comparison alone would be null for it, and a check passes on a null.
    check(
      "intake_items_statement",
      sql`(${t.statementDigest} is null or ${t.reexaminesItemId} is not null) and (${t.statement} is null) = (${t.statementSalt} is null) and (${t.statement} is null or (${t.erasedAt} is null and ${t.statementSalt} ~ '^[0-9a-f]{64}$' and ${t.statementDigest} is not null and ${t.statementDigest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.statementSalt}, 'hex') || convert_to(${t.statement}, 'UTF8')), 'hex'))) and (${t.statement} is not null or ${t.statementDigest} is null or ${t.erasedAt} is not null) and (${t.statementDigest} is null or ${t.statementDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    /** A notice names a target once. The trigger intake_items_quote reads an intake's items through this index. */
    uniqueIndex("intake_items_target_once").on(t.intakeId, t.targetType, t.targetId).where(sql`reexamines_item_id is null`),
    /** An item is re-examined once. */
    uniqueIndex("intake_items_reexamines_once").on(t.reexaminesItemId).where(sql`reexamines_item_id is not null`),
    uniqueIndex("intake_items_case_seq_idx").on(t.caseId, t.seq),
    /** One item per signed-in reporter, case and ground; signed-out notifiers, whose column is null, are never merged. */
    uniqueIndex("intake_items_reporter_once").on(t.caseId, t.reporterAccountId, t.allegesIllegal).where(sql`reexamines_item_id is null`),
    index("intake_items_answered_by_idx").on(t.answeredBy),
    /** The freeze's probe: the unanswered suspect items of a case. */
    index("intake_items_suspect_open_idx").on(t.caseId).where(sql`suspect and answered_by is null`),
    index("intake_items_revision_idx").on(t.revisionPendingAt).where(sql`revision_pending_at is not null`),
    fullAccess("intake_items_api_all", apiRole),
  ],
).enableRLS();

/**
 * A decision is the statement of reasons: every element of Article 17(3) is a column, in the Transparency Database's
 * shape. The API role may insert and read, and update only the author's mail state. The triggers of migration 0016 force
 * the columns marked forced and check the rest.
 */
export const decisions = pgTable(
  "decisions",
  {
    /** The API may supply it. */
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    kind: decisionKind("kind").notNull(),
    /** Set on a review and on a correction: the decision it reverses measures of. */
    reviewsDecisionId: uuid("reviews_decision_id").references((): AnyPgColumn => decisions.id),
    /** Forced: a review's one appeal. */
    appealId: uuid("appeal_id").references((): AnyPgColumn => appeals.id),
    seenStateVersion: integer("seen_state_version").notNull(),
    /** A final decision answers the items up to this number; 0 for an interim one. */
    throughSeq: integer("through_seq").notNull().default(0),
    /** Forced. */
    answersFromSeq: integer("answers_from_seq"),
    outcome: decisionOutcome("outcome").notNull(),
    ground: decisionGround("ground"),
    ruleId: text("rule_id"),
    rulesVersion: smallint("rules_version").notNull(),
    redressVersion: smallint("redress_version").notNull(),
    category: text("category").notNull(),
    categoryKeyword: text("category_keyword"),
    /** Forced. */
    source: decisionSource("source").notNull(),
    /** Forced to false in 3c. */
    automatedDetection: boolean("automated_detection").notNull().default(false),
    /** Forced to not_automated in 3c. */
    automatedDecision: text("automated_decision").notNull().default("not_automated"),
    /** korbat cannot restrict by country. */
    territorialScope: text("territorial_scope").notNull().default("worldwide"),
    snapshotId: uuid("snapshot_id").notNull().references(() => evidenceSnapshots.id, { onDelete: "restrict" }),
    /** The digest the console computed from what it displayed. */
    snapshotDigest: text("snapshot_digest").notNull(),
    /** Each names a saved staff text by its salted digest: the chain holds the digest, never the text. */
    factsDigest: text("facts_digest"),
    reasonDigest: text("reason_digest"),
    legalReferenceDigest: text("legal_reference_digest"),
    /** The staff account. */
    decidedBy: uuid("decided_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    /** Forced. */
    decidedAt: ts("decided_at").notNull(),
    /** Forced: pg_current_xact_id(). Compared together with decided_at, since a restore restarts the counter. */
    xact: xid8("xact").notNull(),
    /** Forced: 32 random hex characters, the Transparency Database's platform id, never the internal id. */
    puid: text("puid").notNull().unique(),
    /** Forced equal to decided_at: the author's case screen shows the statement at commit. */
    informedAt: ts("informed_at").notNull(),
    /** Forced: the decision is taken on a case that holds, or answers, a suspect item. */
    suspect: boolean("suspect").notNull(),
    /** Forced: true for a final decision on a post case taken while the post was frozen, so that nobody could open its images. */
    unseen: boolean("unseen").notNull().default(false),
    /** Forced. */
    needsAdmin: boolean("needs_admin").notNull(),
    /** Forced. */
    endedInterim: boolean("ended_interim").notNull(),
    /** Forced at insert. */
    authorMail: deliveryState("author_mail").notNull().default("none"),
    authorMailAt: ts("author_mail_at"),
    /** The R4 redaction. */
    redactedAt: ts("redacted_at"),
  },
  (t) => [
    check("decisions_rule_id", sql`${t.ruleId} in (${listOf(RULE_IDS)})`),
    check("decisions_category", sql`${t.category} in (${listOf(TDB_CATEGORIES)})`),
    check("decisions_category_keyword", sql`${t.categoryKeyword} in (${listOf(DECISION_KEYWORDS)})`),
    check("decisions_automated_decision", sql`${t.automatedDecision} in ('fully', 'partially', 'not_automated')`),
    check("decisions_territorial_scope", sql`${t.territorialScope} = 'worldwide'`),
    check("decisions_review_target", sql`(${t.kind} in ('review', 'correction')) = (${t.reviewsDecisionId} is not null) and (${t.kind} = 'review') = (${t.appealId} is not null)`),
    check("decisions_interim", sql`${t.kind} <> 'interim' or ${t.throughSeq} = 0`),
    check("decisions_ground_rule", sql`${t.ground} is distinct from 'incompatible' or ${t.ruleId} is not null`),
    check("decisions_ground_law", sql`${t.ground} is distinct from 'illegal' or ${t.legalReferenceDigest} is not null`),
    check("decisions_restricted", sql`${t.outcome} <> 'restricted' or (${t.ground} is not null and ${t.factsDigest} is not null and ${t.reasonDigest} is not null)`),
    check(
      "decisions_digests",
      sql`(${t.factsDigest} is null or ${t.factsDigest} ~ '^[0-9a-f]{64}$') and (${t.reasonDigest} is null or ${t.reasonDigest} ~ '^[0-9a-f]{64}$') and (${t.legalReferenceDigest} is null or ${t.legalReferenceDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    // Null-safe: a decision without a ground carries no keyword either.
    check("decisions_keyword", sql`${t.categoryKeyword} is null or ${t.ground} is not distinct from 'illegal'`),
    // A decision on the law cites no korbat rule.
    check("decisions_law_no_rule", sql`${t.ground} is distinct from 'illegal' or ${t.ruleId} is null`),
    // A review or correction states no ground of its own, and renders its reviewed decision's.
    check(
      "decisions_reversal_plain",
      sql`${t.kind} not in ('review', 'correction') or (${t.ground} is null and ${t.ruleId} is null and ${t.categoryKeyword} is null and ${t.factsDigest} is null and ${t.legalReferenceDigest} is null)`,
    ),
    index("decisions_case_decided_idx").on(t.caseId, t.decidedAt),
    /** The caps count a staff account's decisions by time. */
    index("decisions_decided_by_idx").on(t.decidedBy, t.decidedAt),
    index("decisions_reviews_idx").on(t.reviewsDecisionId),
    uniqueIndex("decisions_appeal_once").on(t.appealId).where(sql`appeal_id is not null`),
    fullAccess("decisions_api_all", apiRole),
  ],
).enableRLS();

/**
 * The ledger: every measure and every reversal is a row, inserted only in the transaction of its own confirmed decision,
 * and never changed. A measure is in force while no row reverses it (and, for an interim measure, as the view
 * measures_in_force says). The API role may insert and read.
 */
export const decisionActions = pgTable(
  "decision_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "restrict" }),
    kind: actionKind("kind").notNull(),
    /** Image measures and their reversals. */
    mediaId: uuid("media_id"),
    /** Forced: the post's author or the account. */
    subjectAccountId: uuid("subject_account_id").notNull(),
    /** Forced for post and image measures and their reversals; null for a seal, whose posts seal_posts lists. */
    postId: uuid("post_id"),
    /** Forced for reversals: the one measure it lifts. */
    reversesActionId: uuid("reverses_action_id").references((): AnyPgColumn => decisionActions.id),
    /** Forced for measures: null when the measure changed what someone sees; already or deleted when it did not. */
    noEffect: text("no_effect"),
    /** Forced. */
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("decision_actions_no_effect", sql`${t.noEffect} in ('already', 'deleted')`),
    // Nulls not distinct: a decision holds a measure without an image (a post measure, a seal, a field reset) once too.
    unique("decision_actions_once").on(t.decisionId, t.kind, t.mediaId).nullsNotDistinct(),
    /** A measure is lifted at most once. */
    uniqueIndex("decision_actions_reversed_once").on(t.reversesActionId).where(sql`reverses_action_id is not null`),
    /** The in-force reads. */
    index("decision_actions_post_kind_idx").on(t.postId, t.kind),
    index("decision_actions_subject_kind_idx").on(t.subjectAccountId, t.kind),
    fullAccess("decision_actions_api_all", apiRole),
  ],
).enableRLS();

/**
 * Part of the ledger: one row for each post whose images a seal_media measure seals, with the number of image rows the
 * post had when the measure was recorded. Only a migrator-owned trigger writes it (0016), from the image rows it locked,
 * so no caller chooses a seal's list; the API role may only read.
 */
export const sealPosts = pgTable(
  "seal_posts",
  {
    actionId: uuid("action_id").notNull().references(() => decisionActions.id, { onDelete: "restrict" }),
    /** No foreign key, as a case's target has none. */
    postId: uuid("post_id").notNull(),
    images: smallint("images").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actionId, t.postId] }),
    check("seal_posts_images", sql`${t.images} > 0`),
    /** The freeze's probe: is this post listed by a seal. */
    index("seal_posts_post_idx").on(t.postId),
    fullAccess("seal_posts_api_all", apiRole),
  ],
).enableRLS();

/** The author's appeal of a final restriction: one per decision. The API role may insert and read. */
export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: uuid("decision_id").notNull().references((): AnyPgColumn => decisions.id, { onDelete: "restrict" }),
    /** The decision's subject. */
    appellantAccountId: uuid("appellant_account_id").notNull(),
    /** Optional and free of form, with the salt and digest the server made (the contracts' textDigest). */
    statement: text("statement"),
    statementSalt: text("statement_salt"),
    statementDigest: text("statement_digest"),
    /** Forced. */
    filedAt: ts("filed_at").notNull(),
    answeredBy: uuid("answered_by").references((): AnyPgColumn => decisions.id),
    result: appealResult("result"),
    answeredAt: ts("answered_at"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("appeals_statement_len", sql`char_length(${t.statement}) <= 2000`),
    // The three states of intake_items_statement: no statement; a statement held to its digest, which it must have;
    // erased, the digest kept.
    check(
      "appeals_statement",
      sql`(${t.statement} is null) = (${t.statementSalt} is null) and (${t.statement} is null or (${t.erasedAt} is null and ${t.statementSalt} ~ '^[0-9a-f]{64}$' and ${t.statementDigest} is not null and ${t.statementDigest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.statementSalt}, 'hex') || convert_to(${t.statement}, 'UTF8')), 'hex'))) and (${t.statement} is not null or ${t.statementDigest} is null or ${t.erasedAt} is not null) and (${t.statementDigest} is null or ${t.statementDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    uniqueIndex("appeals_once").on(t.decisionId),
    /** The pending appeals. */
    index("appeals_pending_idx").on(t.decisionId).where(sql`answered_by is null`),
    /** The statements still to erase: the retention job's candidates. */
    index("appeals_statement_idx").on(t.decisionId).where(sql`statement is not null`),
    fullAccess("appeals_api_all", apiRole),
  ],
).enableRLS();

/**
 * Every free text a decision, a review or a reveal carries, and a case's notes: saved first, salted and digested, so
 * that what a staff key confirms is the digest and the audit chain never holds readable text. Erasure nulls the text and
 * the salt and keeps the digest. The API role may insert and read.
 */
export const staffTexts = pgTable(
  "staff_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    kind: staffTextKind("kind").notNull(),
    text: text("text"),
    salt: text("salt"),
    digest: text("digest").notNull().unique(),
    /** Forced: now(). */
    createdAt: ts("created_at").notNull(),
    /** Forced null at insert; set when a confirmed decision names the digest. */
    decisionId: uuid("decision_id").references((): AnyPgColumn => decisions.id),
    /** Forced null at insert; a text is confirmed when this is set. */
    confirmedAt: ts("confirmed_at"),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    // An outer bound in code points. The API holds a text to 5000 UTF-16 units, which is never more code points.
    check("staff_texts_text_len", sql`char_length(${t.text}) <= 5000`),
    // A text is stored with its salt, 32 bytes as lower-case hex as the statement checks have it, and held to its digest,
    // or erased with neither.
    check(
      "staff_texts_digest",
      sql`(${t.text} is null) = (${t.salt} is null) and (${t.text} is null) = (${t.erasedAt} is not null) and (${t.text} is null or (${t.salt} ~ '^[0-9a-f]{64}$' and ${t.digest} = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${t.salt}, 'hex') || convert_to(${t.text}, 'UTF8')), 'hex')))`,
    ),
    /** A moderator's drafts, and the retention job's candidates: a note is never confirmed, so an erased one must leave the index. */
    index("staff_texts_open_idx").on(t.caseId, t.authorId).where(sql`confirmed_at is null and erased_at is null`),
    fullAccess("staff_texts_api_all", apiRole),
  ],
).enableRLS();

/**
 * Evidence by copy: what a post or a profile held when it was reported, with a server-made salt and digest. Append-only
 * for the API role; erasure (the content columns and the salt null, the digest kept) goes through a function of 0018.
 */
export const evidenceSnapshots = pgTable(
  "evidence_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    targetType: moderationTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** Forced: the transaction's start to the millisecond, as JavaScript reads times. */
    takenAt: ts("taken_at").notNull(),
    /** The post's author or the account, at capture. */
    authorHandle: text("author_handle").notNull(),
    postState: postState("post_state"),
    postCreatedAt: ts("post_created_at"),
    replyToId: uuid("reply_to_id"),
    quoteOfId: uuid("quote_of_id"),
    body: text("body"),
    /** The post's images in position order. An alt text is null for an image that was erased. */
    media: jsonb("media").$type<{ id: string; alt: string | null; width: number; height: number }[]>(),
    displayName: text("display_name"),
    bio: text("bio"),
    handle: text("handle"),
    salt: text("salt"),
    /** Computed by the API (the contracts' snapshotDigest) and checked by the console; SQL never recomputes it. */
    digest: text("digest").notNull(),
    erasedAt: ts("erased_at"),
  },
  (t) => [
    check("evidence_erased", sql`${t.erasedAt} is null or (${t.body} is null and ${t.media} is null and ${t.displayName} is null and ${t.bio} is null and ${t.salt} is null)`),
    index("evidence_snapshots_case_taken_idx").on(t.caseId, t.takenAt),
    /** Every snapshot of a post in any case. */
    index("evidence_snapshots_target_idx").on(t.targetType, t.targetId),
    /** The retention job's candidates. */
    index("evidence_snapshots_unerased_idx").on(t.caseId).where(sql`erased_at is null`),
    fullAccess("evidence_snapshots_api_all", apiRole),
  ],
).enableRLS();

/** Who opened which case, viewed which image or revealed which source, and when. The API role may insert and read. */
export const caseAccessLog = pgTable(
  "case_access_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    staffId: uuid("staff_id").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    kind: accessKind("kind").notNull(),
    mediaId: uuid("media_id"),
    intakeItemId: uuid("intake_item_id"),
    /** A reveal's reason. */
    textId: uuid("text_id"),
    /** Forced: now(). */
    at: ts("at").notNull(),
  },
  (t) => [
    index("case_access_log_staff_idx").on(t.staffId, t.at),
    index("case_access_log_case_idx").on(t.caseId, t.at),
    /** The home screen's list of reveals. */
    index("case_access_log_reveals_idx").on(t.at).where(sql`kind = 'identity_revealed'`),
    fullAccess("case_access_log_api_all", apiRole),
  ],
).enableRLS();

/**
 * The limits on staff, one row that only `staff.js limits` changes, as the migrator: the API role reads it and nothing
 * more. Every reader falls back to the defaults when the row is missing.
 */
export const moderationLimits = pgTable(
  "moderation_limits",
  {
    id: smallint("id").primaryKey(),
    decisionsPerHour: integer("decisions_per_hour").notNull(),
    decisionsPerDay: integer("decisions_per_day").notNull(),
    caseOpensPerDay: integer("case_opens_per_day").notNull(),
    findingsPerDay: integer("findings_per_day").notNull(),
    revealsPerDay: integer("reveals_per_day").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [check("moderation_limits_single_row", sql`${t.id} = 1`), pgPolicy("moderation_limits_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();

/**
 * A case's evidence hold on an image row (the media module's table in the API; defined here beside cases, which it
 * references). The trigger media_holds_apply keeps post_media.hold_until at the latest end of the image's unreleased
 * holds, and a row with a hold in force is skipped by every delete. The history goes with a row the disposal deletes.
 * The API role may insert and read; release goes through a function of 0018.
 */
export const mediaHolds = pgTable(
  "media_holds",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    mediaId: uuid("media_id").notNull().references(() => postMedia.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
    /** Forced: now(). */
    heldAt: ts("held_at").notNull(),
    /** Null: until released. */
    until: ts("until"),
    /** Forced null at insert. */
    releasedAt: ts("released_at"),
  },
  (t) => [
    index("media_holds_media_idx").on(t.mediaId).where(sql`released_at is null`),
    index("media_holds_case_idx").on(t.caseId).where(sql`released_at is null`),
    fullAccess("media_holds_api_all", apiRole),
  ],
).enableRLS();
```

### Replace `apps/api/src/media/flows/serve.ts` (whole file)

```ts
import type { MediaSize } from "@korbat/contracts";
import type { MediaDeps } from "../context";
import type { StoredFile } from "../files";

/** Images of visible posts are cacheable by anyone for five minutes. Everything else depends on who asks and is never cached. */
export const PUBLIC_CACHE = "public, max-age=300";
export const PRIVATE_CACHE = "private, no-store";

export type Served =
  | { kind: "file"; file: StoredFile; cacheControl: string; etag: string }
  | { kind: "not_modified"; cacheControl: string; etag: string }
  | { kind: "not_found" };

export interface ServeRequest {
  id: string;
  size: MediaSize;
  ifNoneMatch: string | undefined;
  /** Resolves the session. Only called when the answer depends on who asks, so public images cost one query. */
  viewer: () => Promise<string | null>;
}

/**
 * Decides whether an image file may be sent. An image follows its post: visible posts are public,
 * as 2a made them, so blocks are not checked here; withheld and removed posts show their images to
 * their author only; an image without a post, or not ready, does not exist for anyone. It also
 * follows its own moderation state, by a whitelist: only an image whose state is `visible` is sent.
 * A sealed image reaches nobody, its author included, and any other state is not found for everyone
 * until this reader is taught who may see it. The image's state is tested before the post's, so a
 * sealed image of a withheld or removed post is not found for its author too.
 */
export async function serve(deps: MediaDeps, request: ServeRequest): Promise<Served> {
  const access = await deps.repo.fileAccess(request.id);
  if (!access || access.status !== "ready" || !access.postState) return { kind: "not_found" };
  if (access.mediaState !== "visible") return { kind: "not_found" };

  let cacheControl = PUBLIC_CACHE;
  if (access.postState !== "visible") {
    const moderated = access.postState === "withheld" || access.postState === "removed";
    if (!moderated || (await request.viewer()) !== access.authorId) return { kind: "not_found" };
    cacheControl = PRIVATE_CACHE;
  }

  // The files of an id never change, so the id and the size identify the bytes.
  const etag = `"${request.id}-${request.size}"`;
  if (request.ifNoneMatch?.split(",").some((candidate) => candidate.trim() === etag)) return { kind: "not_modified", cacheControl, etag };

  const file = await deps.files.openImage(request.id, request.size);
  if (!file) {
    deps.log.error({ id: request.id, size: request.size }, "media: a ready image has no usable file in the store");
    return { kind: "not_found" };
  }
  return { kind: "file", file, cacheControl, etag };
}
```

### Replace `apps/api/src/media/flows/status.ts` (whole file)

```ts
import { MediaFailure, type MediaStatusResponse } from "@korbat/contracts";
import { MediaError, type MediaDeps } from "../context";
import type { MediaRow } from "../repo";

/**
 * Records the worker's verdict for an upload, if there is one, and removes the upload file, which
 * is how the worker learns that its result was read. Safe to repeat: only a row that is still
 * processing changes.
 */
export async function finalize(deps: MediaDeps, id: string): Promise<boolean> {
  const result = await deps.files.readResult(id);
  if (!result) return false;
  await deps.repo.finalize(id, result);
  await deps.files.discardUpload(id);
  return true;
}

function statusOf(row: MediaRow): MediaStatusResponse {
  if (row.status === "ready" && row.width !== null && row.height !== null) {
    // A sealed image is shown to nobody, its owner included: its status says that it is ready and how large it is, never
    // the blurhash, which is made from the image and which the repository did not hand over.
    if (row.moderationState === "sealed") return { id: row.id, status: "ready", width: row.width, height: row.height };
    if (row.blurhash !== null) return { id: row.id, status: "ready", width: row.width, height: row.height, blurhash: row.blurhash };
  }
  if (row.status === "failed") {
    const reason = MediaFailure.safeParse(row.error);
    return { id: row.id, status: "failed", error: reason.success ? reason.data : "processing_failed" };
  }
  return { id: row.id, status: "processing" };
}

/** The state of one upload, for its owner only. Whoever asks first finalizes it. */
export async function status(deps: MediaDeps, ownerId: string, id: string): Promise<MediaStatusResponse> {
  let row = await deps.repo.find(id);
  if (!row || row.ownerId !== ownerId) throw new MediaError("not_found", 404);
  if (row.status === "processing" && (await finalize(deps, id))) row = (await deps.repo.find(id)) ?? row;
  return statusOf(row);
}
```

### Replace `apps/api/src/media/repo.ts` (whole file)

```ts
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { mediaPath, type MediaView } from "@korbat/contracts";
import { postMedia, posts, profiles, type Db, type DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { MediaError } from "./context";

/** Every SQL statement on post_media lives in this module's repository, on the korbat_api pool. */

export interface MediaRow {
  id: string;
  ownerId: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  postId: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: Date;
  /** The image's own moderation state, which only a migrator-owned function writes. A sealed image is shown to nobody. */
  moderationState: "visible" | "withheld" | "removed" | "sealed";
}

const columns = {
  id: postMedia.id,
  ownerId: postMedia.ownerId,
  status: postMedia.status,
  error: postMedia.error,
  postId: postMedia.postId,
  width: postMedia.width,
  height: postMedia.height,
  blurhash: postMedia.blurhash,
  createdAt: postMedia.createdAt,
  moderationState: postMedia.moderationState,
};

export function createMediaRepo(db: Db) {
  return {
    /** When the account was onboarded, which decides its upload tier. */
    async accountCreatedAt(userId: string): Promise<Date | null> {
      const rows = await db.select({ createdAt: profiles.createdAt }).from(profiles).where(eq(profiles.id, userId)).limit(1);
      return rows[0]?.createdAt ?? null;
    },

    /** Uploads of this account that are not on a post yet and did not fail. */
    async pendingCount(ownerId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), inArray(postMedia.status, ["processing", "ready"])));
      return rows[0]?.count ?? 0;
    },

    async insertProcessing(input: { id: string; ownerId: string; now: Date }): Promise<void> {
      await db.insert(postMedia).values({ id: input.id, ownerId: input.ownerId, status: "processing", createdAt: input.now });
    },

    /**
     * One image row, for its owner's status. Two rules of the readers hold here (3c design, section 7.10): a row that a
     * case or a freeze keeps after its post was deleted, and a row whose content, its own or its post's, was erased, is
     * answered as a row that does not exist, to its owner too, so nothing tells the author that the row was kept; and a
     * sealed image is handed over without its blurhash, which is made from the image.
     */
    async find(id: string): Promise<MediaRow | null> {
      const rows = await db
        .select({ ...columns, erasedAt: postMedia.erasedAt, postState: posts.state, postErasedAt: posts.erasedAt })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      const found = rows[0];
      if (!found || found.postState === "deleted_by_author" || found.erasedAt !== null || found.postErasedAt !== null) return null;
      const { erasedAt: _erasedAt, postState: _postState, postErasedAt: _postErasedAt, ...row } = found;
      return row.moderationState === "sealed" ? { ...row, blurhash: null } : row;
    },

    /** Records the worker's verdict, once. A row that is no longer processing is left as it is. */
    async finalize(id: string, result: ResultFile): Promise<boolean> {
      const values = result.status === "ready" ? { status: "ready" as const, width: result.width, height: result.height, blurhash: result.blurhash } : { status: "failed" as const, error: result.reason };
      const rows = await db.update(postMedia).set(values).where(and(eq(postMedia.id, id), eq(postMedia.status, "processing"))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** Removes an upload of this account that is not on a post. */
    async deleteUnattached(id: string, ownerId: string): Promise<boolean> {
      const rows = await db.delete(postMedia).where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), isNull(postMedia.postId))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** What serving an image file depends on: whether it is ready, its own moderation state, and its post's state and author. */
    async fileAccess(id: string): Promise<{ status: MediaRow["status"]; mediaState: MediaRow["moderationState"]; postState: string | null; authorId: string | null } | null> {
      const rows = await db
        .select({ status: postMedia.status, mediaState: postMedia.moderationState, postState: posts.state, authorId: posts.authorId })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Puts images on a post, inside the transaction that creates it. Each must belong to the author,
     * be ready and be on no post yet; anything else rolls the post back.
     */
    async attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }): Promise<void> {
      for (const [position, item] of input.items.entries()) {
        const rows = await tx
          .update(postMedia)
          .set({ postId: input.postId, position, altText: item.alt })
          .where(and(eq(postMedia.id, item.id), eq(postMedia.ownerId, input.ownerId), isNull(postMedia.postId), eq(postMedia.status, "ready")))
          .returning({ id: postMedia.id });
        if (rows.length !== 1) throw new MediaError("media_unavailable", 400);
      }
    },

    /** Removes a post's images, inside the transaction that deletes it, and says which files to delete afterwards. */
    async detachAll(tx: DbTx, postId: string): Promise<string[]> {
      const rows = await tx.delete(postMedia).where(eq(postMedia.postId, postId)).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /**
     * Removes every image row of the owner, on a post or not, whatever its state, inside the transaction
     * that purges the account, and says which files to delete afterwards (1b design, section 7.6).
     */
    async purgeOwner(tx: DbTx, ownerId: string): Promise<string[]> {
      const rows = await tx.delete(postMedia).where(eq(postMedia.ownerId, ownerId)).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /**
     * The images of a page of posts, in one query, in their order on each post. Only an image whose own moderation state
     * is `visible` is listed: the list names the state it shows, so a sealed image, and any state this reader has not
     * been taught, is in no view and no export's list.
     */
    async forPosts(postIds: readonly string[]): Promise<Map<string, MediaView[]>> {
      const byPost = new Map<string, MediaView[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText })
        .from(postMedia)
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready"), eq(postMedia.moderationState, "visible")))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId || row.width === null || row.height === null || row.blurhash === null) continue;
        const view: MediaView = { id: row.id, width: row.width, height: row.height, blurhash: row.blurhash, alt: row.altText ?? "", small: mediaPath(row.id, "small"), large: mediaPath(row.id, "large") };
        byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), view]);
      }
      return byPost;
    },

    /**
     * Every ready image of the account, on a post or not, oldest first: the images the data export takes files for. As
     * in forPosts, only an image whose own moderation state is `visible`: a sealed image is exported to nobody.
     */
    async readyImages(ownerId: string): Promise<string[]> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), eq(postMedia.status, "ready"), eq(postMedia.moderationState, "visible")))
        .orderBy(postMedia.createdAt, postMedia.id);
      return rows.map((row) => row.id);
    },

    /** Uploads that still wait for the worker's verdict. */
    async processingIds(): Promise<string[]> {
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(eq(postMedia.status, "processing")).orderBy(postMedia.createdAt);
      return rows.map((row) => row.id);
    },

    /** Fails uploads the worker has not answered since `before`, and says which. */
    async failStale(before: Date): Promise<string[]> {
      const rows = await db
        .update(postMedia)
        .set({ status: "failed", error: "processing_failed" })
        .where(and(eq(postMedia.status, "processing"), lt(postMedia.createdAt, before)))
        .returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Removes uploads made before `before` that were never put on a post, whatever their state, and says which. */
    async deleteUnattachedBefore(before: Date): Promise<string[]> {
      const rows = await db.delete(postMedia).where(and(isNull(postMedia.postId), lt(postMedia.createdAt, before))).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Which of these ids have a row. */
    async existing(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(inArray(postMedia.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Replace `apps/api/src/social/visibility.ts` (whole file)

```ts
import type { Tombstone } from "@korbat/contracts";
import type { ViewerId } from "./context";

export type StoredPostState = "visible" | "withheld" | "removed" | "deleted_by_author";

/**
 * shown: the viewer gets the post. hidden: the viewer may not see it (a block, or moderation state
 * on someone else's post). deleted: the author removed it. Hidden and deleted posts are omitted
 * from lists and become tombstones only where structure needs them.
 */
export type PostAccess = "shown" | "hidden" | "deleted";

/**
 * The one rule every read applies (2a spec, section 4). A block in either direction hides
 * everything, even a deleted post's tombstone reason. The author sees their own withheld and
 * removed posts; nobody else does. The switch names every stored state: a state added to
 * StoredPostState does not compile here until this reader decides it, and a value the code was
 * never told about is hidden from everyone, its author included.
 */
export function postAccess(viewer: ViewerId, post: { authorId: string; state: StoredPostState }, blockedEitherWay: boolean): PostAccess {
  if (blockedEitherWay) return "hidden";
  switch (post.state) {
    case "deleted_by_author":
      return "deleted";
    case "visible":
      return "shown";
    case "withheld":
    case "removed":
      return viewer !== null && viewer === post.authorId ? "shown" : "hidden";
    default:
      post.state satisfies never;
      return "hidden";
  }
}

export function tombstone(id: string, access: Exclude<PostAccess, "shown">): Tombstone {
  return access === "deleted" ? { id, deleted: true } : { id, unavailable: true };
}
```

### Replace `packages/contracts/src/index.ts` (whole file)

```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./account";
export * from "./auth";
export * from "./explore";
export * from "./media";
// Evaluated before ./staff, and importing nothing from it: staff.ts can read this module's constants while it loads.
export * from "./moderation";
export * from "./passkeys";
export * from "./social";
export * from "./staff";
export * from "./text";
```

### Replace `packages/contracts/src/media.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the media endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const MediaErrorCode = z.enum(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
export type MediaErrorCode = z.infer<typeof MediaErrorCode>;

/** Why processing an upload failed. Reported on the status response, not as an HTTP error. */
export const MediaFailure = z.enum(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
export type MediaFailure = z.infer<typeof MediaFailure>;

/** 20 MiB. The API counts bytes while it streams an upload to disk and stops here. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_PER_POST = 4;
/** The types an upload may declare. The bytes decide; the declaration is checked and then forgotten. */
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export type MediaAcceptedType = (typeof MEDIA_ACCEPTED_TYPES)[number];
export const ALT_MAX_LENGTH = 1000;

/** A media id in its canonical lowercase form, which is also how it names files on the media volumes. */
export const MediaId = z.uuid().transform((id) => id.toLowerCase());

export const MEDIA_SIZES = ["small", "large"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

/** Where an image file is served. Views carry these paths, so the server can move images without a client change. */
export function mediaPath(id: string, size: MediaSize): string {
  return `/api/media/${id}/${size}.webp`;
}

/** Length in code points, which is what Postgres char_length counts. */
export function altLength(alt: string): number {
  return Array.from(alt).length;
}

/** Unicode NFC, every run of whitespace (line breaks included) to one space, trimmed. The server and the composer use the same rule. */
export function normalizeAltText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const CONTROL = /\p{Cc}/u;

/** An image description as stored: normalized, 1 to 1000 code points, no control characters. */
export const AltText = z
  .string()
  .max(4000)
  .transform(normalizeAltText)
  .refine((alt) => !CONTROL.test(alt), { message: "control characters are not allowed" })
  .refine((alt) => !FORBIDDEN_FORMAT.test(alt), { message: "invisible direction and spacing characters are not allowed" })
  .refine((alt) => altLength(alt) >= 1, { message: "every image needs a description" })
  .refine((alt) => altLength(alt) <= ALT_MAX_LENGTH, { message: `descriptions have at most ${ALT_MAX_LENGTH} characters` });

/** One image of a new post: an upload that is ready, and its description. */
export const MediaAttachment = z.object({ id: MediaId, alt: AltText });
export type MediaAttachment = z.infer<typeof MediaAttachment>;

export const UploadResponse = z.object({ id: MediaId, status: z.literal("processing") });
export type UploadResponse = z.infer<typeof UploadResponse>;

/**
 * The state of one upload, for its owner. Width and height are those of the large size, after rotation. A ready image
 * carries its blurhash, except one that moderation sealed: it is shown to nobody, and the blurhash is made from the image.
 */
export const MediaStatusResponse = z.discriminatedUnion("status", [
  z.object({ id: MediaId, status: z.literal("processing") }),
  z.object({ id: MediaId, status: z.literal("ready"), width: z.number().int().positive(), height: z.number().int().positive(), blurhash: z.string().min(6).optional() }),
  z.object({ id: MediaId, status: z.literal("failed"), error: MediaFailure }),
]);
export type MediaStatusResponse = z.infer<typeof MediaStatusResponse>;

/** An image on a post, as every reader gets it. */
export const MediaView = z.object({
  id: MediaId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().min(6),
  alt: z.string(),
  small: z.string(),
  large: z.string(),
});
export type MediaView = z.infer<typeof MediaView>;
```

### Replace `packages/contracts/src/staff.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { hex, sha256, sortedJson } from "./canonical";
import { AuthenticationResponseJSON, PasskeyOptionsResponse, RegistrationResponseJSON } from "./passkeys";

// The staff console (3a design, section 10). The console talks only to /api/staff/* on its own origin, and parses every
// answer with these schemas; the API validates every request with them.

/**
 * Every code the staff flows put in ErrorEnvelope.error.code. Staff routes may also answer the shared challenge_expired,
 * rate_limited and invalid_request, and the staff gate's not_found and csrf_failed, but never a passkey_* code.
 */
export const StaffErrorCode = z.enum([
  "staff_session_required",
  "staff_key_invalid",
  "staff_key_suspended",
  "staff_key_limit",
  "staff_key_not_device_bound",
  "staff_key_not_user_verified",
  "staff_key_refused",
  "staff_enrollment_invalid",
  "staff_step_up_required",
  "staff_step_up_invalid",
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;

/** The roles that open the console: an account whose role is user holds no staff key. */
export const StaffRole = Role.exclude(["user"]);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * The name a staff key's holder gives it at enrolment, under the display-name rules. The authenticator shows it (it is the
 * registration's user name), so the console asks for neither an email nor a real name.
 */
export const StaffKeyName = DisplayName;

/** Which button the enrolment page offered: a roaming security key (sent with the security-key hint) or this computer's Windows Hello (no hint). */
export const StaffKeyKind = z.enum(["security_key", "this_device"]);
export type StaffKeyKind = z.infer<typeof StaffKeyKind>;

/** A lowercase hex sha256: chain hashes and action hashes. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256");

/** A row's place in the audit chain (chain_seq): 1 for the first row. */
const ChainSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A place as a query string names it: a decimal without a sign, a leading zero or an exponent, and at most 15 digits, so
 * it always converts to a safe integer.
 */
const ChainSeqParam = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/, "must be a place in the audit chain: a positive whole number")
  .transform(Number);

// ---------------------------------------------------------------- keys, sessions and the account

/** One of the person's staff keys as the console lists them: never the public key, the credential id or the AAGUID. */
export const StaffKey = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type StaffKey = z.infer<typeof StaffKey>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKey) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;

/**
 * One of the person's live staff sessions. `handle` is the session's random handle, which the revocation route takes;
 * `browser` is the coarse label ("Firefox on Linux"), never the user agent or an address.
 */
export const StaffSession = z.object({
  handle: z.uuid(),
  browser: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session this request came from. */
  current: z.boolean(),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffSessionsResponse = z.object({ sessions: z.array(StaffSession) });
export type StaffSessionsResponse = z.infer<typeof StaffSessionsResponse>;

/**
 * GET /api/staff/me: the account's handle and role, the session's handle (the console binds step-up challenges to it) and
 * both expiries with the seconds left, counted on the server, so the console's idle timer needs no clock of its own.
 */
export const StaffMe = z
  .object({
    handle: z.string(),
    role: StaffRole,
    sessionHandle: z.uuid(),
    idleExpiresAt: z.iso.datetime(),
    idleSecondsLeft: z.number().int().nonnegative(),
    absoluteExpiresAt: z.iso.datetime(),
    absoluteSecondsLeft: z.number().int().nonnegative(),
  })
  // The idle expiry never moves past the absolute one (the database checks it too).
  .refine((me) => me.idleSecondsLeft <= me.absoluteSecondsLeft, { message: "the idle end cannot lie beyond the absolute end", path: ["idleSecondsLeft"] });
export type StaffMe = z.infer<typeof StaffMe>;

// ---------------------------------------------------------------- enrolment

/** POST /api/staff/enroll/options: the token of the link `staff.js enroll` printed, the key's name and its kind. */
export const StaffEnrollOptionsRequest = z.object({ token: OpaqueId, name: StaffKeyName, kind: StaffKeyKind });
export type StaffEnrollOptionsRequest = z.infer<typeof StaffEnrollOptionsRequest>;

/**
 * The registration options, and whether the console's relying party ID is the app's (`rpShared`, true in development).
 * Only when it is not does the page ask the password manager to drop a refused credential through the Signal API.
 */
export const StaffEnrollOptionsResponse = PasskeyOptionsResponse.extend({ rpShared: z.boolean() });
export type StaffEnrollOptionsResponse = z.infer<typeof StaffEnrollOptionsResponse>;

/** POST /api/staff/enroll/verify: the same token and name with the browser's registration response. */
export const StaffEnrollVerifyRequest = z.object({ token: OpaqueId, name: StaffKeyName, response: RegistrationResponseJSON });
export type StaffEnrollVerifyRequest = z.infer<typeof StaffEnrollVerifyRequest>;

/** The key the enrolment stored; the person then signs in with it once. */
export const StaffEnrollVerifyResponse = z.object({ key: StaffKey });
export type StaffEnrollVerifyResponse = z.infer<typeof StaffEnrollVerifyResponse>;

// ---------------------------------------------------------------- sign-in

/** POST /api/staff/signin/options takes no body and answers with discoverable-credential options. */
export const StaffSignInOptionsResponse = PasskeyOptionsResponse;
export type StaffSignInOptionsResponse = z.infer<typeof StaffSignInOptionsResponse>;

/** POST /api/staff/signin/verify: the browser's assertion. There is no device id: a staff session is its own record. */
export const StaffSignInVerifyRequest = z.object({ response: AuthenticationResponseJSON });
export type StaffSignInVerifyRequest = z.infer<typeof StaffSignInVerifyRequest>;

/** A sign-in answers with the new session as /me describes it, beside the two staff cookies. */
export const StaffSignInVerifyResponse = StaffMe;
export type StaffSignInVerifyResponse = z.infer<typeof StaffSignInVerifyResponse>;

// ---------------------------------------------------------------- step-up

/**
 * A uuid in the one spelling PostgreSQL writes, lower-case hex. A step-up target's id is hashed exactly as sent, but the
 * database finds a uuid by value whatever its case and the audit row records the id as the database returns it: an
 * upper-case spelling would act on the row and leave a record whose target no longer hashes to the confirmed action, which
 * audit-verify would refuse for good. So any other spelling is refused, never changed.
 */
const LowerCaseUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });

/**
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: LowerCaseUuid, params: z.strictObject({}) },
} as const;
export type StaffStepUpAction = keyof typeof STAFF_STEP_UP_ACTIONS;

export const StaffStepUpActionName = z.enum(Object.keys(STAFF_STEP_UP_ACTIONS) as [StaffStepUpAction, ...StaffStepUpAction[]]);

/** The `{ action, target, params }` of one step-up action, each part checked by that action's own schemas. */
function stepUpRequest<A extends StaffStepUpAction>(action: A) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  return z.strictObject({
    action: z.literal(action),
    target: z.strictObject({ type: z.literal(spec.targetType), id: spec.targetId }),
    params: spec.params,
  });
}

/** POST /api/staff/step-up/options: the action the route will execute, as it will execute it. */
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [stepUpRequest("staff_session_revoked")]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

/**
 * Which ceremony a WebAuthn challenge was issued for: its second byte, in either layout below. A challenge answers only
 * the ceremony it names. The API's codec writes these codes, and the console checks them before it asks for the key, so
 * no challenge of one ceremony is ever signed in another.
 */
export const CHALLENGE_PURPOSES = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5, staff_step_up: 6 } as const;

/**
 * The layout of every challenge but the step-up's (1c's codec, 3a design, section 5): version, purpose, expiry (epoch
 * milliseconds, big-endian), nonce, a 16-byte binding (the first 16 bytes of the sha256 of the session's handle or the
 * staff enrolment's id it is bound to, zeros for the two sign-ins), then the first 16 bytes of an HMAC over the 42 bytes
 * before it, 58 bytes sent as unpadded base64url. The API's codec writes it, and the console checks the staff sign-in's
 * and the staff registration's before it asks for the key.
 */
export const CEREMONY_CHALLENGE = {
  bytes: 58,
  encodedLength: 78,
  version: 1,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 16,
  sealAt: 42,
  sealBytes: 16,
} as const;

/**
 * The step-up challenge's layout (3a design, section 5), which the API's codec writes, audit-verify reads back from a
 * stored assertion without the sealing key, and the console checks before it asks for the key: version, purpose, expiry
 * (epoch milliseconds, big-endian), nonce, the full 32-byte binding, then the first 16 bytes of an HMAC over the 58 bytes
 * before it, 74 bytes sent as unpadded base64url. The other ceremonies' challenges are 58 bytes with purposes 1 to 5 and a
 * 16-byte binding (CEREMONY_CHALLENGE), so neither layout is ever read as the other.
 */
export const STAFF_STEP_UP_CHALLENGE = {
  bytes: 74,
  encodedLength: 99,
  version: 1,
  purpose: CHALLENGE_PURPOSES.staff_step_up,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 32,
  sealAt: 58,
  sealBytes: 16,
} as const;

/** What a step-up confirms: an action, its target and its params, as the route will execute them, or as an audit row records them. */
export interface StaffStepUpActionInput {
  action: string;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * The text an action's hash is taken over (3a design, section 7, Step-up): the sorted JSON of `{ action, target: { type,
 * id }, params }`. The step-up options take it from what the console sent, requireStaffStepUp from what the route is about
 * to do, audit-verify from the row's action, target and `metadata.params`, and the console from what it chose.
 */
export function stepUpActionText(input: StaffStepUpActionInput): string {
  return sortedJson({ action: input.action, target: { type: input.target.type, id: input.target.id }, params: input.params });
}

/**
 * The text a step-up challenge's binding is the sha256 of: the staff session's handle, a newline and the action's hash. A
 * confirmation made in one session, or for one action, therefore binds nothing else.
 */
export function stepUpBindingText(sessionHandle: string, actionHash: string): string {
  return `${sessionHandle}\n${actionHash}`;
}

/** The action's hash: the lower-case hex sha256 of stepUpActionText's UTF-8 bytes. */
export async function stepUpActionHash(input: StaffStepUpActionInput): Promise<string> {
  return hex(await sha256(stepUpActionText(input)));
}

/** The step-up challenge's binding: all 32 bytes of the sha256 of stepUpBindingText's UTF-8 bytes. */
export async function stepUpBinding(sessionHandle: string, actionHash: string): Promise<Uint8Array> {
  return sha256(stepUpBindingText(sessionHandle, actionHash));
}

/**
 * A step-up assertion as the audit row stores it in `step_up`: the three members `audit-verify` checks, base64url exactly
 * as the browser sent them, under the same bounds as the browser's answer.
 */
export const StaffStoredAssertion = z.strictObject(
  AuthenticationResponseJSON.shape.response.pick({ authenticatorData: true, clientDataJSON: true, signature: true }).shape,
);
export type StaffStoredAssertion = z.infer<typeof StaffStoredAssertion>;

// ---------------------------------------------------------------- the audit log

/** How many rows one page of the audit log holds. */
export const STAFF_AUDIT_PAGE_SIZE = 50;

/**
 * One row of the audit log as the console shows it: its place and hash in the chain, when it joined the chain, the actor's
 * handle (null for the system actor or an account without one), the action, its target and the action's hash when a
 * step-up confirmed it. Never its metadata.
 */
export const AuditEntry = z.object({
  seq: ChainSeq,
  hash: Sha256Hex,
  createdAt: z.iso.datetime(),
  actorHandle: z.string().nullable(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  actionHash: Sha256Hex.nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({ cursor: ChainSeqParam.optional(), at: ChainSeqParam.optional(), action: z.enum(["staff_sign_in"]).optional() })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;
```

### Replace `packages/db/migrations/meta/_journal.json` (whole file)

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1789374373025,
      "tag": "0000_parallel_umar",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1789374374757,
      "tag": "0001_grants",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "7",
      "when": 1789388768464,
      "tag": "0002_aspiring_prism",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "7",
      "when": 1789388790249,
      "tag": "0003_auth_events_grants",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "7",
      "when": 1789639555282,
      "tag": "0004_young_bloodscream",
      "breakpoints": true
    },
    {
      "idx": 5,
      "version": "7",
      "when": 1789976535081,
      "tag": "0005_huge_scarlet_spider",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1789976685374,
      "tag": "0006_nifty_blue_shield",
      "breakpoints": true
    },
    {
      "idx": 7,
      "version": "7",
      "when": 1790237989056,
      "tag": "0007_auth_purge_events",
      "breakpoints": true
    },
    {
      "idx": 8,
      "version": "7",
      "when": 1790238603639,
      "tag": "0008_careless_shadowcat",
      "breakpoints": true
    },
    {
      "idx": 9,
      "version": "7",
      "when": 1790241720737,
      "tag": "0009_clever_ezekiel",
      "breakpoints": true
    },
    {
      "idx": 10,
      "version": "7",
      "when": 1790332470171,
      "tag": "0010_free_thunderbolt",
      "breakpoints": true
    },
    {
      "idx": 11,
      "version": "7",
      "when": 1790586983460,
      "tag": "0011_magical_iceman",
      "breakpoints": true
    },
    {
      "idx": 12,
      "version": "7",
      "when": 1790769406818,
      "tag": "0012_aberrant_wendell_vaughn",
      "breakpoints": true
    },
    {
      "idx": 13,
      "version": "7",
      "when": 1790876150318,
      "tag": "0013_forget_revoked_staff_keys",
      "breakpoints": true
    },
    {
      "idx": 14,
      "version": "7",
      "when": 1791059071207,
      "tag": "0014_old_vapor",
      "breakpoints": true
    },
    {
      "idx": 15,
      "version": "7",
      "when": 1791071072064,
      "tag": "0015_greedy_zuras",
      "breakpoints": true
    }
  ]
}
```

### Replace `packages/db/src/schema/auth.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, foreignKey, index, integer, jsonb, pgPolicy, pgSchema, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, bytea, emptyTextArray, fullAccess, ts } from "./helpers";

export const auth = pgSchema("auth");

export const emailCodePurpose = auth.enum("email_code_purpose", ["signup", "login", "change_email", "recovery", "reauth", "delete_account"]);

export const userRole = auth.enum("user_role", ["user", "moderator", "admin"]);

export const authEventType = auth.enum("auth_event_type", [
  "signup",
  "signin_success",
  "signin_failure",
  "mfa_enabled",
  "mfa_disabled",
  "recovery_code_used",
  "recovery_codes_regenerated",
  "password_set",
  "password_changed",
  "session_revoked",
  "sessions_revoked_all",
  "account_locked",
  "new_device",
  "not_me",
  "profile_updated",
  "handle_changed",
  "email_changed",
  "badge_verified",
  "badge_removed",
  "export_created",
  "account_deleted",
  "passkey_added",
  "passkey_removed",
  "passkey_counter_regression",
  // The staff console (3a design, section 6).
  "staff_enrollment_issued",
  "staff_key_added",
  "staff_key_revoked",
  "staff_key_counter_regression",
  "staff_sign_in",
  "staff_signed_out",
  "staff_session_revoked",
]);

export const users = auth.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    /** Salted hash; the raw phone number is discarded after OTP verification. */
    phoneHash: text("phone_hash"),
    /** argon2id encoded string, null for passkey-only accounts. */
    passwordHash: text("password_hash"),
    /** Encrypted with the server-side key; never stored in clear. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: ts("totp_enabled_at"),
    recoveryCodesHash: text("recovery_codes_hash").array().notNull().default(emptyTextArray),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    role: userRole("role").notNull().default("user"),
    /** When the 16+ check passed. Date of birth itself is never stored. */
    ageConfirmedAt: ts("age_confirmed_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: ts("terms_accepted_at"),
    /** Set once the public profile (handle) exists. */
    onboardedAt: ts("onboarded_at"),
    passwordChangedAt: ts("password_changed_at"),
    /** Last accepted TOTP time step; a code for this step or earlier is rejected (replay protection). */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    /**
     * When the purge after deletion finished anonymising this row. deleted_at means the owner confirmed
     * deletion and the account is gone for every purpose; purged_at null with deleted_at set means the purge
     * job still has work to do.
     */
    purgedAt: ts("purged_at"),
    /**
     * The WebAuthn user handle: 32 random bytes that every passkey of the account carries and a discoverable passkey
     * returns at sign-in. Never the account id, so a password manager's records say nothing about the account. Null
     * until the first passkey is added; the passkey flows set it once with a compare-and-set, and the account's
     * deletion clears it (1c design, sections 6 and 7.7).
     */
    webauthnUserId: bytea("webauthn_user_id"),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    /** One phone number per account, as a database fact; accounts without a number stay out of the index. */
    uniqueIndex("users_phone_hash_idx").on(t.phoneHash).where(sql`phone_hash is not null`),
    /** A user handle names one account; accounts without passkeys stay out of the index. */
    uniqueIndex("users_webauthn_user_id_idx").on(t.webauthnUserId).where(sql`webauthn_user_id is not null`),
    fullAccess("users_auth_all", authRole),
  ],
).enableRLS();

export const devices = auth.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    label: text("label"),
    /** 'web' | 'ios' | 'android' */
    platform: text("platform").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Salted hash; purged by the 30-day job. Raw IPs are never stored. */
    ipHash: text("ip_hash"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_user_idx").on(t.userId), index("devices_ip_hash_idx").on(t.ipHash), fullAccess("devices_auth_all", authRole)],
).enableRLS();

export const sessions = auth.table(
  "sessions",
  {
    /** sha256 hex of the opaque token handed to the client. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Sliding expiry, extended on use. */
    expiresAt: ts("expires_at").notNull(),
    /** Hard cap, never extended. */
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    /** Last time the user proved possession of a credential on this session: the latest of `factors`. */
    reauthAt: ts("reauth_at").notNull().defaultNow(),
    /**
     * A random id the session keeps for its whole life, while the token and with it `id` rotate. The re-authentication
     * limits and the passkey challenges are keyed by it, so a rotation cannot reset them and no other session can
     * spend them.
     */
    handle: uuid("handle").notNull().defaultRandom(),
    /**
     * The factors this session has proven and when: kind (email, password, totp, recovery, passkey, passkey_uv) to
     * epoch milliseconds. Sessions from before migration 0010 have none and re-authenticate before a sensitive action.
     */
    factors: jsonb("factors").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** The passkey that started this session, for the lockdown and the Security list; it outlives the passkey. */
    passkeyId: uuid("passkey_id").references(() => passkeys.id, { onDelete: "set null" }),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_handle_idx").on(t.handle), fullAccess("sessions_auth_all", authRole)],
).enableRLS();

export const emailCodes = auth.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: emailCodePurpose("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Random id returned to the client; a code can only complete the flow that requested it. */
    flowId: text("flow_id").notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("email_codes_email_idx").on(t.email),
    uniqueIndex("email_codes_flow_idx").on(t.flowId),
    fullAccess("email_codes_auth_all", authRole),
  ],
).enableRLS();

export const passkeys = auth.table(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name").notNull(),
    /** Written from the flows' clock, like password_changed_at, because the lockdown compares it with flow times. */
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** The authenticator model the registration reported (all zeros for most synced passkeys); null when none was given. */
    aaguid: uuid("aaguid"),
    /** The BE flag at registration: the key may be synced to other devices. backed_up is the BS flag, which can change. */
    backupEligible: boolean("backup_eligible").notNull().default(false),
    /** The registration verified the user (UV flag); only then does a verified sign-in with it count as two factors. */
    uvInitialized: boolean("uv_initialized").notNull().default(false),
    /** The device whose session added it, for the Security list; it outlives the device. */
    createdDeviceId: uuid("created_device_id").references(() => devices.id, { onDelete: "set null" }),
    /** When a sign-in showed a signature counter that went backwards (a copy of the key may exist); refused from then on. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [uniqueIndex("passkeys_credential_idx").on(t.credentialId), index("passkeys_user_idx").on(t.userId), fullAccess("passkeys_auth_all", authRole)],
).enableRLS();

/** Append-only security log. UPDATE, DELETE and TRUNCATE are also revoked at the grant level (migration 0003). */
export const authEvents = auth.table(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: authEventType("type").notNull(),
    deviceId: uuid("device_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_events_user_created_idx").on(t.userId, t.createdAt),
    pgPolicy("auth_events_auth_insert", { for: "insert", to: authRole, withCheck: sql`true` }),
    pgPolicy("auth_events_auth_select", { for: "select", to: authRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * Staff keys (3a design, section 6): WebAuthn credentials on the staff console's relying party, which alone open it. Only
 * keys whose registration reported user verification and no backup eligibility exist. They are added only by the
 * migrator-owned function auth.add_staff_key, which spends an enrolment the command line issued; migration 0012 leaves the
 * auth role SELECT and UPDATE of counter, last_used_at, revoked_at and suspect_at, and a trigger refuses to clear or change a
 * set revoked_at or suspect_at. A row is never deleted: audit-verify checks old confirmations against its public key,
 * owner, origin and relying party ID, so revocation and an account's take-down only set revoked_at.
 */
export const staffKeys = auth.table(
  "staff_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** On delete restrict: the development cleaner, which deletes accounts, must never take a key with them. */
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    /** What the key's holder called it at enrolment; blanked with the AAGUID and transports when the account is deleted. */
    name: text("name").notNull(),
    /** The authenticator model the registration reported; null when none was given, and after the account's deletion. */
    aaguid: uuid("aaguid"),
    /** The console's origin and relying party ID when the key was enrolled, copied from its enrolment. */
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** Set once and never cleared: the key opens and confirms nothing more. A key is live while this is null. */
    revokedAt: ts("revoked_at"),
    /** Set together with revoked_at when a signature counter went backwards: a revoked key whose record says why. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [
    uniqueIndex("staff_keys_credential_idx").on(t.credentialId),
    index("staff_keys_user_idx").on(t.userId),
    // The pair the staff sessions' foreign key names, so a session's key always belongs to its account.
    unique("staff_keys_id_user_id_unique").on(t.id, t.userId),
    check("staff_keys_suspect_is_revoked", sql`${t.suspectAt} is null or ${t.revokedAt} is not null`),
    fullAccess("staff_keys_auth_all", authRole),
  ],
).enableRLS();

/**
 * One-time enrolment links (3a design, section 6), issued only by `staff.js enroll` as the migrator and spent only by
 * auth.add_staff_key. Only the sha256 of the link's token is kept. The auth role may read them and delete them (cancelling an
 * open one, or the janitor removing a spent one), nothing else; a set used_at is never cleared.
 */
export const staffEnrollments = auth.table(
  "staff_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** CONSOLE_ORIGIN and the console's relying party ID when the link was issued; a link for a moved console enrols nothing. */
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [
    uniqueIndex("staff_enrollments_token_hash_idx").on(t.tokenHash),
    index("staff_enrollments_user_idx").on(t.userId),
    fullAccess("staff_enrollments_auth_all", authRole),
  ],
).enableRLS();

/**
 * Staff sessions (3a design, section 6), apart from the app's sessions: 12 hours absolute and 15 minutes idle, read from the
 * database on every request. The database keeps a row within 12 hours of its creation whoever writes it.
 */
export const staffSessions = auth.table(
  "staff_sessions",
  {
    /** sha256 hex of the opaque token in the staff cookie. The token itself is never stored. */
    id: text("id").primaryKey(),
    /** A random id for the session's whole life: the console lists and revokes sessions by it, and step-up binds to it. */
    handle: uuid("handle").notNull().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The staff key that opened the session; its foreign key below also names the account. */
    keyId: uuid("key_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The person's last action in the console, never a request the page sent by itself. */
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    idleExpiresAt: ts("idle_expires_at").notNull(),
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    /** The coarse label deviceLabel gives ("Firefox on Linux"); never the user agent itself, never an address. */
    browser: text("browser").notNull(),
  },
  (t) => [
    uniqueIndex("staff_sessions_handle_idx").on(t.handle),
    index("staff_sessions_user_idx").on(t.userId),
    foreignKey({ name: "staff_sessions_key_user_fk", columns: [t.keyId, t.userId], foreignColumns: [staffKeys.id, staffKeys.userId] }).onDelete("cascade"),
    check(
      "staff_sessions_lifetime",
      sql`${t.absoluteExpiresAt} <= ${t.createdAt} + interval '12 hours' and ${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`,
    ),
    fullAccess("staff_sessions_auth_all", authRole),
  ],
).enableRLS();

/**
 * What a signed-out notifier gave to be told about their notice (3c design, section 6.1): a name and an address, each
 * encrypted under NOTIFIER_ENC_KEY, a keyed hash of the address for the caps and for suppression, and the contact's mail
 * token. The public intake row holds only this row's id, which the moderation module chose, and the API role reaches none
 * of this. Migration 0015 leaves the auth role SELECT, INSERT, DELETE and UPDATE of forget_after only, so a contact is
 * never re-encrypted.
 */
export const notifierContacts = auth.table(
  "notifier_contacts",
  {
    /** Chosen by the moderation module: the intake row names it before the contact is stored. */
    id: uuid("id").primaryKey(),
    nameEnc: text("name_enc"),
    emailEnc: text("email_enc"),
    emailHash: text("email_hash"),
    /** The contact's mail token, which alone confirms or stops the address; null without an address. */
    mailTokenEnc: text("mail_token_enc"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** When the janitor deletes the row: 13 months after creation unless the notice is still owed something. */
    forgetAfter: ts("forget_after").notNull(),
  },
  () => [fullAccess("notifier_contacts_auth_all", authRole)],
).enableRLS();

/** An address a notifier confirmed, by its keyed hash, for 30 days. */
export const notifierConfirmations = auth.table(
  "notifier_confirmations",
  {
    emailHash: text("email_hash").primaryKey(),
    confirmedAt: ts("confirmed_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  () => [fullAccess("notifier_confirmations_auth_all", authRole)],
).enableRLS();

/** An address that asked korbat to stop its report mails, by its keyed hash. Its notices are still processed. */
export const notifierSuppressions = auth.table(
  "notifier_suppressions",
  {
    emailHash: text("email_hash").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  () => [fullAccess("notifier_suppressions_auth_all", authRole)],
).enableRLS();

/**
 * The personal accounts the operator linked to a staff account, so that a staff member never decides where an account of
 * their own is a party. Only `staff.js link` and `unlink` write it, as the migrator, and only migrator-owned definer
 * functions read it: migration 0015 revokes everything from the auth role, and the one policy, which the rule that every
 * table has one asks for, lets that role see no row. On delete restrict: the development cleaner must not take a link
 * with an account.
 */
export const staffPersonalAccounts = auth.table(
  "staff_personal_accounts",
  {
    staffUserId: uuid("staff_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    personalUserId: uuid("personal_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    linkedAt: ts("linked_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.staffUserId, t.personalUserId] }),
    check("staff_personal_accounts_differ", sql`${t.staffUserId} <> ${t.personalUserId}`),
    pgPolicy("staff_personal_accounts_auth_none", { for: "select", to: authRole, using: sql`false` }),
  ],
).enableRLS();
```

### Replace `packages/db/src/schema/content.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

/**
 * What moderation derives for a post from the measures in force (3c design, section 6.1): the strongest of them.
 * posts.state mirrors it unless the author deleted the post, so post_state gains no value.
 */
export const moderationLevel = pgEnum("moderation_level", ["visible", "withheld", "removed"]);

/** An image's own moderation state, beside its post's. Only an image is ever sealed: shown to nobody, its author included. */
export const mediaModerationState = pgEnum("media_moderation_state", ["visible", "withheld", "removed", "sealed"]);

/** A counter kept exact by the application: updated in the same transaction as the action it counts. */
const counter = (name: string) => integer(name).notNull().default(0);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    likeCount: counter("like_count"),
    repostCount: counter("repost_count"),
    /** Replies that are not deleted. */
    replyCount: counter("reply_count"),
    /** Quotes that are not deleted. */
    quoteCount: counter("quote_count"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Set together with state = 'deleted_by_author'; the body is blanked at the same time. */
    deletedAt: ts("deleted_at"),
    /** Derived from the ledger of measures by a migrator-owned function, the only writer; the API role cannot update it. */
    moderationLevel: moderationLevel("moderation_level").notNull().default("visible"),
    /** Set, one way, when the R4 redaction erased the post's content; written only by a migrator-owned function. */
    erasedAt: ts("erased_at"),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    /** A thread's replies in order, and every lookup by parent. */
    index("posts_reply_to_created_idx").on(t.replyToId, t.createdAt, t.id),
    /** The public Latest timeline: visible top-level posts and quotes, newest first. */
    index("posts_latest_idx").on(t.createdAt, t.id).where(sql`reply_to_id is null and state = 'visible'`),
    index("posts_quote_of_idx").on(t.quoteOfId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    check("posts_counts_nonnegative", sql`${t.likeCount} >= 0 and ${t.repostCount} >= 0 and ${t.replyCount} >= 0 and ${t.quoteCount} >= 0`),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

/**
 * One Explore ranking (a "generation"), written by the refresh job (2c design, sections 6 and 7). The current ranking
 * is the highest generation; the job also keeps the one before it, so a reader paging through a ranking is not cut
 * off by the next round.
 */
export const exploreRuns = pgTable(
  "explore_runs",
  {
    /** Numbered by the database. One ranking every 5 minutes lasts 20,000 years in an integer. */
    generation: integer("generation").primaryKey().generatedAlwaysAsIdentity(),
    /** The refresh time the round was given; the ranking is computed as of this time. */
    asOf: ts("as_of").notNull(),
    /** The version of the formula the round ranked with (EXPLORE_V1.version in @korbat/contracts). */
    formula: smallint("formula").notNull(),
    /** Posts that passed the candidate predicate at as_of. */
    candidates: integer("candidates").notNull(),
    /** Posts the ranking holds; their positions run from 1 to this. */
    items: integer("items").notNull(),
    /** How long the round took. */
    tookMs: integer("took_ms").notNull(),
  },
  () => [fullAccess("explore_runs_api_all", apiRole)],
).enableRLS();

/**
 * The posts of one Explore ranking, in order. No score or count is stored: nothing reads them after the insert, and
 * the position is the order. A row goes with its ranking, its post or its author.
 */
export const exploreItems = pgTable(
  "explore_items",
  {
    generation: integer("generation").notNull().references(() => exploreRuns.generation, { onDelete: "cascade" }),
    /** 1 to the ranking's item count, without gaps. */
    position: integer("position").notNull(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    /** The post's author, so an author's places in a ranking are counted without reading the posts. */
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.generation, t.position] }),
    /** A post has one place in a ranking. */
    uniqueIndex("explore_items_generation_post_idx").on(t.generation, t.postId),
    fullAccess("explore_items_api_all", apiRole),
  ],
).enableRLS();

/** An upload is processing until the worker's result is in, then ready or failed for good. */
export const mediaStatus = pgEnum("media_status", ["processing", "ready", "failed"]);

/**
 * One uploaded image. The files live on the media-store volume under the row's id; no path is
 * stored. Only the API's media module reads or writes this table.
 */
export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who uploaded it. Only this account may attach it to a post. */
    ownerId: uuid("owner_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    status: mediaStatus("status").notNull().default("processing"),
    /** Why processing failed: one of the contracts' MediaFailure values. */
    error: text("error"),
    /** Set, together with the position, when the image is attached to a post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position"),
    /** Of the large size, after rotation. Set, together with the blurhash, when processing succeeds. */
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    altText: text("alt_text"),
    /** Filled by sub-project 3. Empty until then. */
    nsfwScore: real("nsfw_score"),
    createdAt: ts("created_at").notNull().defaultNow(),
    // The three columns below are forced to their defaults at insert and written only by migrator-owned functions; the
    // API role holds no UPDATE on them (migration 0015).
    /** Derived from the ledger of measures, as the post's level is. */
    moderationState: mediaModerationState("moderation_state").notNull().default("visible"),
    /** The latest end of the image's unreleased holds (media_holds): while it lies ahead, every delete skips the row. */
    holdUntil: ts("hold_until"),
    /** Set when an R4 removal of the image became final and its content was erased. */
    erasedAt: ts("erased_at"),
  },
  (t) => [
    uniqueIndex("post_media_post_position_idx").on(t.postId, t.position),
    index("post_media_owner_created_idx").on(t.ownerId, t.createdAt),
    index("post_media_status_created_idx").on(t.status, t.createdAt),
    check("post_media_ready_has_dims", sql`${t.status} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.blurhash} is not null)`),
    check("post_media_attached_is_complete", sql`${t.postId} is null or (${t.status} = 'ready' and ${t.position} between 0 and 3 and ${t.altText} is not null)`),
    check("post_media_alt_len", sql`char_length(${t.altText}) <= 1000`),
    fullAccess("post_media_api_all", apiRole),
  ],
).enableRLS();

/** user -> user relation table (follows, blocks, mutes). */
function userPairTable(name: string, from: string, to: string) {
  return pgTable(
    name,
    {
      fromId: uuid(from).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      toId: uuid(to).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.fromId, t.toId] }),
      /** Pages of either side, newest first, and every lookup by either side. */
      index(`${name}_to_created_idx`).on(t.toId, t.createdAt, t.fromId),
      index(`${name}_from_created_idx`).on(t.fromId, t.createdAt, t.toId),
      check(`${name}_not_self`, sql`${t.fromId} <> ${t.toId}`),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

/**
 * user -> post relation table (likes, reposts, bookmarks). `createdBrin` adds `<name>_created_brin`, a BRIN index on
 * created_at, for the tables whose recent rows the Explore refresh reads (2c design, section 6).
 */
function userPostTable(name: string, options: { createdBrin?: boolean } = {}) {
  return pgTable(
    name,
    {
      userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.postId] }),
      index(`${name}_post_idx`).on(t.postId),
      /** Per-account lists (your likes, your bookmarks) and the reposts half of the Following timeline. */
      index(`${name}_user_created_idx`).on(t.userId, t.createdAt),
      // Rows arrive roughly in time order, so a BRIN index of a few kilobytes finds the refresh's window as fast as a
      // btree of many megabytes. Unlikes, blocks and purges let later rows fill old pages and erode that order slowly.
      ...(options.createdBrin ? [index(`${name}_created_brin`).using("brin", t.createdAt)] : []),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes", { createdBrin: true });
export const reposts = userPostTable("reposts", { createdBrin: true });
/** Bookmarks are private and never count towards Explore, so they need no index by time. */
export const bookmarks = userPostTable("bookmarks");
```

### Replace `packages/db/src/schema/helpers.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { customType, pgPolicy, pgRole, timestamp, type PgRole } from "drizzle-orm/pg-core";

/** Roles are created by infra/postgres/init/01-roles.sh, not by migrations. */
export const apiRole = pgRole("korbat_api").existing();
export const authRole = pgRole("korbat_auth").existing();

export const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Raw bytes, which drizzle's pg-core has no column for. postgres.js sends a Buffer as bytea and parses bytea back into
 * a Buffer; a driver that answers a plain Uint8Array is given a Buffer view of the same memory, so readers can rely on
 * Buffer's methods (equals, toString("base64url")).
 */
export const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * A 64-bit transaction id (what pg_current_xact_id() answers), which drizzle's pg-core has no column for. It is handed
 * over as its decimal string, as postgres.js reads a type it does not know: a JavaScript number cannot hold every value.
 */
export const xid8 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "xid8";
  },
});

/**
 * Foundation policy: the given role may touch every row of the table.
 * Sub-projects replace this per table with owner-scoped policies as the
 * routes that need them are built. RLS being ON from day one means adding a
 * tighter policy later is a migration, not a redesign.
 */
export function fullAccess(name: string, role: PgRole) {
  return pgPolicy(name, { for: "all", to: role, using: sql`true`, withCheck: sql`true` });
}

export const emptyTextArray = sql`'{}'::text[]`;
```

### Replace `packages/db/src/schema/identity.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";

export const profiles = pgTable(
  "profiles",
  {
    /** Equals auth.users.id. Deliberately no cross-schema FK so korbat_api never needs auth access. */
    id: uuid("id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarPath: text("avatar_path"),
    verifiedAt: ts("verified_at"),
    /** Counters kept exact by the application, in the same transaction as the follow, unfollow, block or post. */
    followerCount: integer("follower_count").notNull().default(0),
    followingCount: integer("following_count").notNull().default(0),
    /** Non-deleted top-level posts and quotes; reposts and replies are not counted. */
    postCount: integer("post_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    /** When the handle was last changed after onboarding; the next change is allowed 30 days later. Null until the first change. */
    handleChangedAt: ts("handle_changed_at"),
    /**
     * "Show my posts in Explore", the author's own switch. Off keeps the account's posts out of Explore from the next
     * read; on again lets them back in at the next refresh. It belongs to the author: the public profile never shows it.
     */
    showInExplore: boolean("show_in_explore").notNull().default(true),
  },
  (t) => [
    uniqueIndex("profiles_handle_lower_idx").on(sql`lower(${t.handle})`),
    check("profiles_counts_nonnegative", sql`${t.followerCount} >= 0 and ${t.followingCount} >= 0 and ${t.postCount} >= 0`),
    fullAccess("profiles_api_all", apiRole),
  ],
).enableRLS();

/**
 * Every handle a profile ever had, in lowercase: the one chosen at onboarding and each one later left
 * behind. A handle here belongs to that profile for good, so nobody else can take a renamed account's
 * old name; the profile itself may go back to it. The rows go only with the profile row.
 */
export const handleHistory = pgTable(
  "handle_history",
  {
    handleLower: text("handle_lower").primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    changedAt: ts("changed_at").notNull().defaultNow(),
  },
  () => [fullAccess("handle_history_api_all", apiRole)],
).enableRLS();
```

### Replace `packages/db/src/schema/index.ts` (whole file)

```ts
export * from "./auth";
export * from "./identity";
export * from "./content";
export * from "./moderation";
export * from "./safety";
```

### Replace `packages/db/src/schema/safety.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { bigint, bigserial, check, jsonb, pgPolicy, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apiRole, ts } from "./helpers";

/**
 * Append-only, and since 3a a hash chain (3a design, section 6): the record of every staff action. UPDATE, DELETE and
 * TRUNCATE are revoked from the API role at the grant level (migration 0001). The trigger audit_chain, which migration 0012
 * installs and the migrator owns, sets id, created_at and the four chain columns of every inserted row, whatever the insert
 * supplied, under a lock on audit_head that lasts until the inserting transaction ends: an audit row is always the last
 * statement of its transaction.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
    /** When the row joined the chain, in milliseconds: the trigger sets it. */
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The handle of the staff session the action came from. */
    staffSession: uuid("staff_session"),
    /** The staff key: the one a step-up confirmed with, or the key a key's row is about. */
    keyId: uuid("key_id"),
    /** The lower-case hex sha256 of the confirmed action's sorted JSON, when a step-up confirmed it. */
    actionHash: text("action_hash"),
    /** The step-up assertion (authenticatorData, clientDataJSON, signature), base64url exactly as the browser sent them. */
    stepUp: jsonb("step_up").$type<{ authenticatorData: string; clientDataJSON: string; signature: string }>(),
    // The chain. The defaults are placeholders the trigger always overwrites: they keep drizzle's insert type from asking
    // for these columns and let migration 0012 add them over existing rows.
    /** The canonical text's version the row was hashed with. */
    chainVersion: smallint("chain_version").notNull().default(0),
    /** The row's place: the order in which inserts took the head's lock, from 1, with no gap. */
    chainSeq: bigint("chain_seq", { mode: "number" }).notNull().default(0),
    /** The hash of the row before it; 64 zeros for the first. */
    prevHash: text("prev_hash").notNull().default(""),
    /** sha256 hex of prev_hash followed by the row's canonical text. */
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    // Serves the viewer and audit-verify. Migration 0012 creates it after the back-fill, which the placeholders would fail.
    uniqueIndex("audit_log_chain_seq_idx").on(t.chainSeq),
    // A step-up leaves its action's hash and its assertion together, with the key that made it.
    check("audit_log_step_up_complete", sql`(${t.actionHash} is null) = (${t.stepUp} is null) and (${t.actionHash} is null or ${t.keyId} is not null)`),
    pgPolicy("audit_log_api_insert", { for: "insert", to: apiRole, withCheck: sql`true` }),
    pgPolicy("audit_log_api_select", { for: "select", to: apiRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * The newest row of the audit chain: its place and hash, or (1, 0, 64 zeros) for an empty log. One row, which only the
 * trigger moves. The API role may read it (audit-head and audit-verify check that it names the newest row) but neither write
 * nor lock it: migration 0012 revokes every other privilege, and SELECT ... FOR UPDATE needs UPDATE.
 */
export const auditHead = pgTable(
  "audit_head",
  {
    id: smallint("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [check("audit_head_single_row", sql`${t.id} = 1`), pgPolicy("audit_head_api_select", { for: "select", to: apiRole, using: sql`true` })],
).enableRLS();
```

### Replace `scripts/clean-dev-fixtures.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Lists, and with --yes deletes, what tests left in the development database:
 *
 * - accounts whose email has the tests' shape, `<word>-<uuid>@korbat.local` (the integration, HTTP and
 *   smoke tests all make them), with their profiles;
 * - profiles without an account behind them, which the integration suites inserted directly while they
 *   still ran against this database.
 *
 * An account that holds a staff key is kept, whatever its email: staff keys are never deleted, because audit-verify
 * checks old confirmations against their public keys, and the database refuses to delete an account that has one.
 * For the same reason an account is kept when the moderation record names it: one that decided anything, one on
 * either side of a staff link (auth.staff_personal_accounts, whose keys would otherwise fail the whole cleanup), and
 * the subject of a case that a decision or a reveal names. Decisions, their measures and the audit rows that confirm
 * them are kept for good, so what they are about stays too. And an account is kept when a moderation row that stays
 * names it as staff: the finder of an intake that keeps an item, the author of a staff text and the staff of an access
 * row in a case that stays. A case stays when the account it is about does, so this rule is applied until it adds
 * nobody.
 *
 * Every other case about a deleted account, or about one of its posts, is deleted with it: posts and profiles are
 * never deleted in production, so such a case could never be decided and would stay in the development queue after
 * every smoke run. Its items go first, because an unanswered report of child sexual abuse material freezes every
 * image its case reaches and the database then refuses to delete those images; then its holds, released before they
 * are deleted so that the images stop being retained; then its access rows, staff texts and snapshots; then the case,
 * and every intake that is left without an item. A seal is never met: it belongs to a decision, and the subject of a
 * decided case is kept.
 *
 * Deleting a profile removes its posts, image rows, follows, likes, reposts, bookmarks, blocks and mutes.
 * Where those rows counted towards a kept profile or post (a follow of a real account, a like of a real
 * post), that counter is recomputed from the rows, the way the app keeps it. The API's sweeper removes
 * the image files within about an hour, as it does for any image without a row.
 *
 * Refuses to run unless Docker's context is this machine and API_APP_ORIGIN in infra/.env is a localhost origin, so it never touches a
 * deployed database. Runs psql inside the postgres container as its superuser: no password is read or
 * printed here.
 *
 * Usage, from the repo root:
 *   node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]
 * Without a command it uses `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);
const unknown = options.filter((option) => option !== "--yes");
if (compose.length === 0 || unknown.length > 0) {
  console.error("usage: node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]");
  process.exit(2);
}
const yes = options.includes("--yes");

/** The only emails tests create: a lowercase word or words, a UUID, and the korbat.local domain. */
const TEST_EMAIL = "^[a-z]+(-[a-z]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@korbat[.]local$";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** How many of each kind are printed; the counts are always complete. */
const LISTED = 25;
const NL = String.fromCharCode(10);
/** psql meta-commands start with a backslash; spelled this way, the file holds none that could be lost in copying. */
const META = String.fromCharCode(92);

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

const envFile = resolve(root, "infra/.env");
if (!existsSync(envFile)) stop("infra/.env is missing. Run `node scripts/gen-dev-env.mjs` first.");
const origin = parseEnv(readFileSync(envFile, "utf8")).API_APP_ORIGIN ?? "";
let host = "";
try {
  host = new URL(origin).hostname;
} catch {
  host = "";
}
if (!LOCAL_HOSTS.includes(host)) stop(`API_APP_ORIGIN in infra/.env is "${origin}", not a localhost origin. This script only cleans a development database.`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'pattern' itself, so the pattern is never pasted into SQL by hand. Everything happens in one
// transaction, which only commits with --yes.
const script = `set -eu
psql -v ON_ERROR_STOP=1 -q -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pattern="$PATTERN" -v delete="$DELETE" <<'SQL'
begin;
create temp table candidates on commit drop as
  select u.id, 'account' as kind, u.email || coalesce(' (@' || p.handle || ')', '') as label
    from auth.users u left join public.profiles p on p.id = u.id
    where u.email ~ :'pattern'
  union all
  select p.id, 'profile', '@' || p.handle
    from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);
-- Kept: a staff key's holder, whoever decided anything, either side of a staff link, and the subject of a case that a
-- decision or a reveal names (the account itself, or the author of the case's post).
create temp table kept on commit drop as
  select c.id, c.kind
    from candidates c
    where exists (select 1 from auth.staff_keys k where k.user_id = c.id)
       or exists (select 1 from public.decisions d where d.decided_by = c.id)
       or exists (select 1 from auth.staff_personal_accounts l where l.staff_user_id = c.id or l.personal_user_id = c.id)
       or exists (
         select 1 from public.cases cs
          where ((cs.target_type = 'account' and cs.target_id = c.id)
              or (cs.target_type = 'post' and cs.target_id in (select po.id from public.posts po where po.author_id = c.id)))
            and (exists (select 1 from public.decisions d where d.case_id = cs.id)
              or exists (select 1 from public.case_access_log a where a.case_id = cs.id and a.kind = 'identity_revealed')));
-- Kept as well: whoever a moderation row that stays names as staff. A case stays unless it is about an account that goes,
-- or about a post of one; an intake stays unless every item it has is in a case that goes. The finder of an intake that
-- stays, the author of a staff text and the staff of an access row in a case that stays are kept with it. Keeping an
-- account keeps the cases about it, which can name further accounts, so the rule is applied until it adds nobody.
do $$
declare
  added integer;
begin
  loop
    with going as (
      select c.id from candidates c where c.id not in (select id from kept)
    ), going_cases as (
      select cs.id
        from public.cases cs
        where (cs.target_type = 'account' and cs.target_id in (select id from going))
           or (cs.target_type = 'post' and cs.target_id in (select po.id from public.posts po where po.author_id in (select id from going)))
    )
    insert into kept (id, kind)
      select c.id, c.kind
        from candidates c
        where c.id in (select id from going)
          and (exists (
                 select 1 from public.intakes n
                  where n.finding_by = c.id
                    and (not exists (select 1 from public.intake_items i where i.intake_id = n.id and i.case_id in (select id from going_cases))
                      or exists (select 1 from public.intake_items i where i.intake_id = n.id and (i.case_id is null or i.case_id not in (select id from going_cases)))))
            or exists (select 1 from public.staff_texts t where t.author_id = c.id and t.case_id not in (select id from going_cases))
            or exists (select 1 from public.case_access_log a where a.staff_id = c.id and a.case_id not in (select id from going_cases)));
    get diagnostics added = row_count;
    exit when added = 0;
  end loop;
end $$;
create temp table doomed on commit drop as
  select c.id, c.kind, c.label from candidates c where c.id not in (select id from kept);
-- The cases that go with them: about a doomed account, or about a post of one. None has a decision.
create temp table doomed_cases on commit drop as
  select cs.id
    from public.cases cs
    where (cs.target_type = 'account' and cs.target_id in (select id from doomed))
       or (cs.target_type = 'post' and cs.target_id in (select po.id from public.posts po where po.author_id in (select id from doomed)));
create temp table touched_profiles on commit drop as
  select f.followee_id as id from public.follows f
    where f.follower_id in (select id from doomed) and f.followee_id not in (select id from doomed)
  union
  select f.follower_id from public.follows f
    where f.followee_id in (select id from doomed) and f.follower_id not in (select id from doomed);
create temp table touched_posts on commit drop as
  select distinct x.post_id as id
    from (
      select user_id as by_id, post_id from public.likes
      union all select user_id, post_id from public.reposts
      union all select author_id, reply_to_id from public.posts where reply_to_id is not null
      union all select author_id, quote_of_id from public.posts where quote_of_id is not null
    ) x
    join public.posts p on p.id = x.post_id
    where x.by_id in (select id from doomed) and p.author_id not in (select id from doomed);
select 'database|' || current_database();
select 'accounts|' || count(*) from doomed where kind = 'account';
select 'kept|' || count(*) from kept where kind = 'account';
select 'profiles|' || count(*) from doomed where kind = 'profile';
select 'profiles_kept|' || count(*) from kept where kind = 'profile';
select 'cases|' || count(*) from doomed_cases;
select 'posts|' || count(*) from public.posts where author_id in (select id from doomed);
select 'images|' || count(*) from public.post_media where owner_id in (select id from doomed);
select 'touched_profiles|' || count(*) from touched_profiles;
select 'touched_posts|' || count(*) from touched_posts;
select kind || '-item|' || label from doomed order by kind, label;
${META}if :delete
-- The intakes these cases' items belong to: those that lose every item go with them.
create temp table emptied_intakes on commit drop as
  select distinct i.intake_id as id from public.intake_items i where i.case_id in (select id from doomed_cases);
-- The items first: deleting an unanswered suspect item is what ends its freeze.
delete from public.intake_items where case_id in (select id from doomed_cases);
-- A hold is released before it is deleted: the release's trigger takes the image's hold_until back, a delete would not.
update public.media_holds set released_at = now() where case_id in (select id from doomed_cases) and released_at is null;
delete from public.media_holds where case_id in (select id from doomed_cases);
delete from public.case_access_log where case_id in (select id from doomed_cases);
delete from public.staff_texts where case_id in (select id from doomed_cases);
delete from public.evidence_snapshots where case_id in (select id from doomed_cases);
delete from public.cases where id in (select id from doomed_cases);
delete from public.intakes n
  where n.id in (select id from emptied_intakes) and not exists (select 1 from public.intake_items i where i.intake_id = n.id);
-- Now nothing retains the doomed accounts' image rows, and the keep trigger lets the cascade through.
delete from public.profiles where id in (select id from doomed);
delete from auth.users where id in (select id from doomed);
update public.profiles p set
    follower_count = (select count(*) from public.follows f where f.followee_id = p.id),
    following_count = (select count(*) from public.follows f where f.follower_id = p.id)
  where p.id in (select id from touched_profiles);
update public.posts p set
    like_count = (select count(*) from public.likes l where l.post_id = p.id),
    repost_count = (select count(*) from public.reposts r where r.post_id = p.id),
    reply_count = (select count(*) from public.posts c where c.reply_to_id = p.id and c.state <> 'deleted_by_author'),
    quote_count = (select count(*) from public.posts c where c.quote_of_id = p.id and c.state <> 'deleted_by_author')
  where p.id in (select id from touched_posts);
commit;
select 'deleted|yes';
${META}else
rollback;
${META}endif
SQL
`;

const run = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `PATTERN=${TEST_EMAIL}`, "-e", `DELETE=${yes ? "on" : "off"}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (run.error) stop(`Could not run ${compose[0]}: ${run.error.message}`);
if (run.status !== 0) stop(`The database could not be read. Is the postgres service up?${NL}${run.stderr}`);

const report = new Map();
const listed = { account: [], profile: [] };
for (const line of run.stdout.split(NL).map((text) => text.trim())) {
  const bar = line.indexOf("|");
  if (bar === -1) continue;
  const key = line.slice(0, bar);
  if (key === "account-item") listed.account.push(line.slice(bar + 1));
  else if (key === "profile-item") listed.profile.push(line.slice(bar + 1));
  else report.set(key, line.slice(bar + 1));
}
const count = (key) => Number(report.get(key) ?? 0);

function show(title, key, labels) {
  console.log(`${title}: ${count(key)}`);
  for (const label of labels.slice(0, LISTED)) console.log(`  ${label}`);
  if (labels.length > LISTED) console.log(`  ... and ${labels.length - LISTED} more`);
}

console.log(`database ${report.get("database")}`);
show("accounts with a test email", "accounts", listed.account);
const KEPT_WHY = "they hold a staff key, decided a case, are linked to a staff account, are the subject of a decided case, or are named as staff by a moderation record that stays";
if (count("kept") > 0) console.log(`accounts with a test email kept because ${KEPT_WHY}: ${count("kept")}`);
show("profiles without an account", "profiles", listed.profile);
if (count("profiles_kept") > 0) console.log(`profiles without an account kept because ${KEPT_WHY}: ${count("profiles_kept")}`);
if (count("accounts") + count("profiles") === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}
console.log(`their posts: ${count("posts")}, image rows: ${count("images")}, undecided moderation cases about them: ${count("cases")}`);
console.log(`kept profiles and posts whose counters include them: ${count("touched_profiles")} and ${count("touched_posts")}`);
if (report.get("deleted") === "yes") {
  console.log(`Deleted ${count("accounts")} accounts and ${count("profiles")} profiles with everything they made, and ${count("cases")} undecided moderation cases about them; recomputed the counters of ${count("touched_profiles")} profiles and ${count("touched_posts")} posts.`);
  console.log("Their image files leave the store when the API's sweeper next finds them without a row, within about an hour.");
} else {
  console.log("Nothing was deleted. Run again with --yes to delete these.");
}
```

### Replace `scripts/test-db.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Creates and migrates the database the integration tests use. Safe to run again at any time, and
 * needed again after every new migration.
 *
 * 1. Reads the test database's name from DATABASE_URL_MIGRATE in apps/api/.env.test, which
 *    `node scripts/gen-dev-env.mjs` derives from apps/api/.env.
 * 2. Creates the database in the Compose Postgres if it is missing, and applies the per-database
 *    grants of infra/postgres/init/01-roles.sh. The roles themselves exist once per server.
 * 3. Runs the migrations with the migrate role.
 *
 * Two options rebuild the database from nothing, each the way a real database meets the migrations:
 *
 * --fresh drops the test database, creates it again with its grants and runs every migration in one
 *   batch, as a new installation does.
 * --upgrade-from <n> does the same drop and create, then migrates in two steps: first the migrations
 *   up to number <n> (0013 for `--upgrade-from 13`), which commits them, then every later one as one
 *   batch over the committed database, as an upgrade of production does. drizzle's migrator runs all
 *   pending migrations in one transaction, so a migration can behave differently over a committed
 *   database than on a fresh one (a value added to an existing enum cannot be used before the
 *   transaction that added it commits).
 *
 * Passwords stay inside the processes that need them and are never printed.
 *
 * Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]
 * Run it from the repo root. Without a command it uses
 * `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const USAGE = "Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = resolve(root, "packages/db/migrations");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
// Everything before the separator is an option of this script; everything after it is the compose command.
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);

function usage() {
  console.error(USAGE);
  process.exit(2);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Connection URLs hold passwords, so they never reach the terminal. */
const scrub = (text) => text.replace(/postgres(ql)?:\/\/\S+/g, "<database url>");

let fresh = false;
/** The number of the last migration the first step applies, or null without --upgrade-from. */
let upgradeFrom = null;
for (let i = 0; i < options.length; i++) {
  if (options[i] === "--fresh") fresh = true;
  else if (options[i] === "--upgrade-from" && /^[0-9]{1,4}$/.test(options[i + 1] ?? "")) upgradeFrom = Number(options[++i]);
  else usage();
}
if (compose.length === 0 || (fresh && upgradeFrom !== null)) usage();

/** The journal drizzle's migrator reads: one entry for each migration, in order. */
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8"));
if (upgradeFrom !== null && !journal.entries.some((entry) => entry.idx === upgradeFrom)) {
  stop(`There is no migration number ${upgradeFrom}: the newest is ${journal.entries.at(-1).idx}.`);
}

const envFile = resolve(root, "apps/api/.env.test");
if (!existsSync(envFile)) stop("apps/api/.env.test is missing. Run `node scripts/gen-dev-env.mjs` first.");
const migrateUrl = parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL_MIGRATE;
if (!migrateUrl) stop("apps/api/.env.test has no DATABASE_URL_MIGRATE. Run `node scripts/gen-dev-env.mjs` again.");
const database = decodeURIComponent(new URL(migrateUrl).pathname.replace(/^\//, ""));
// The same rule guards the drop below: only a database whose name ends in _test is ever dropped.
if (!/^[a-z][a-z0-9_]*_test$/.test(database)) stop(`The test database must have a plain name ending in _test, not "${database}".`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'db' and :"db" itself, so the name is never pasted into SQL by hand. With DROP_FIRST the database
// is dropped first; `with (force)` ends the sessions a stopped test run may have left open on it.
const script = `set -eu
run() { psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$1" -v db="$TEST_DB" -tA; }
if [ "$DROP_FIRST" = "yes" ]; then
  printf '%s\\n' 'drop database if exists :"db" with (force);' | run "$POSTGRES_DB"
  echo "database $TEST_DB: dropped"
fi
found=$(printf '%s\\n' "select 1 from pg_database where datname = :'db';" | run "$POSTGRES_DB")
if [ "$found" = "1" ]; then
  echo "database $TEST_DB: exists"
else
  printf '%s\\n' 'create database :"db";' | run "$POSTGRES_DB"
  echo "database $TEST_DB: created"
fi
run "$TEST_DB" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE  ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON DATABASE :"db" TO korbat_migrate;
GRANT ALL ON SCHEMA public TO korbat_migrate;
GRANT USAGE ON SCHEMA public TO korbat_api;
SQL
echo "grants applied"
`;

const dropFirst = fresh || upgradeFrom !== null ? "yes" : "no";
const created = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `TEST_DB=${database}`, "-e", `DROP_FIRST=${dropFirst}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (created.error) stop(`Could not run ${compose[0]}: ${created.error.message}`);
process.stdout.write(scrub(created.stdout));
if (created.status !== 0) stop(`Creating ${database} failed. Is the postgres service up?\n${scrub(created.stderr)}`);

/**
 * Runs every pending migration of a folder as one batch: the migrator opens one transaction for all of them. A failure
 * is thrown, never an exit from here: process.exit runs no `finally`, and the caller below has a temporary copy to remove.
 */
function migrate(folder) {
  const migrated = spawnSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
    cwd: resolve(root, "apps/api"),
    env: { ...process.env, DATABASE_URL_MIGRATE: migrateUrl, MIGRATIONS_DIR: folder },
    encoding: "utf8",
  });
  if (migrated.error) throw new Error(`Could not run the migrations: ${migrated.error.message}`);
  if (migrated.status !== 0) throw new Error(`Migrating ${database} failed.\n${scrub(migrated.stderr)}`);
}

try {
  if (upgradeFrom !== null) {
    // A temporary copy of the migrations whose journal ends at the given number: the migrator applies what the journal
    // lists and commits. The second run below, with the real folder, then meets a committed database. The copy is
    // removed whether or not its migrations ran: the `finally` ends before the script exits on a failure.
    const copy = mkdtempSync(join(tmpdir(), "korbat-migrations-"));
    try {
      cpSync(migrationsDir, copy, { recursive: true });
      const entries = journal.entries.filter((entry) => entry.idx <= upgradeFrom);
      writeFileSync(join(copy, "meta/_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
      migrate(copy);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
    console.log(`migrations up to ${journal.entries.find((entry) => entry.idx === upgradeFrom).tag} applied and committed`);
  }
  migrate(migrationsDir);
} catch (err) {
  stop(err instanceof Error ? err.message : String(err));
}
console.log(upgradeFrom === null ? "migrations applied" : "later migrations applied as one batch");
console.log(`test database ready: ${database}`);
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  186 passed (186)
packages/db test:       Tests  60 passed (60)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  108 passed (108)
apps/admin test:       Tests  228 passed (228)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  553 passed | 567 skipped (1120)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 7: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=16`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=16
```

## Step 8: verify: test-db-usage

```bash
node scripts/test-db.mjs --fresh --upgrade-from 13 2>&1; echo usage-exit=$?
```

Expected output contains:

- `Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]`

Observed on the dry run:

```text
Usage: node scripts/test-db.mjs [--fresh | --upgrade-from <n>] [-- <docker compose command>]
```

## Step 9: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 10: verify: integration-fresh

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  565 passed (565)
```

## Step 11: verify: test-database-upgrade

```bash
node scripts/test-db.mjs --upgrade-from 13 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations up to 0013_forget_revoked_staff_keys applied and committed`
- `later migrations applied as one batch`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations up to 0013_forget_revoked_staff_keys applied and committed
later migrations applied as one batch
test database ready: korbat_test
```

## Step 12: verify: integration-upgraded

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  565 passed (565)
```

## Step 13: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 14: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 15: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/media/flows/serve.ts`
- `apps/api/src/media/flows/status.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/social/visibility.ts`
- `apps/api/test/integration/global-setup.ts`
- `apps/api/test/integration/media-sealed.test.ts`
- `apps/api/test/integration/moderation-attach.test.ts`
- `apps/api/test/integration/moderation-fixtures.ts`
- `apps/api/test/integration/moderation-freeze.test.ts`
- `apps/api/test/integration/moderation-schema.test.ts`
- `apps/api/test/social/visibility.test.ts`
- `packages/contracts/src/canonical.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/media.ts`
- `packages/contracts/src/moderation.ts`
- `packages/contracts/src/staff.ts`
- `packages/contracts/test/canonical.test.ts`
- `packages/contracts/test/digest-vectors.ts`
- `packages/contracts/test/media.test.ts`
- `packages/contracts/test/moderation.test.ts`
- `packages/db/migrations/0014_<two random words>.sql`
- `packages/db/migrations/0015_<two random words>.sql`
- `packages/db/migrations/meta/0014_snapshot.json`
- `packages/db/migrations/meta/0015_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/content.ts`
- `packages/db/src/schema/helpers.ts`
- `packages/db/src/schema/identity.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/moderation.ts`
- `packages/db/src/schema/safety.ts`
- `packages/db/test/schema.test.ts`
- `scripts/clean-dev-fixtures.mjs`
- `scripts/test-db.mjs`

Allowed difference: drizzle-kit names each generated migration with its number and two random words, so that file's name differs from the dry run. Any name of that shape is correct; do not rename it.

## Step 16: commit

```bash
git add -A
git commit -q -m "feat(db,contracts,api): the ground for moderation cases: migration 0014 drops the tables nothing wrote (reports, cases, appeals, strikes, transparency_log), their enums and profiles.reputation; 0015 creates the moderation tables (cases with one open case a target, intakes and their items, decisions and their ledger of measures, seal_posts, evidence snapshots, staff texts, the access log, the limits row, image holds and four auth tables) with their grants and forced columns, intake_items_attach, intake_items_quote, the view measures_in_force and the freeze: frozen_for and post_frozen (an unanswered suspect item in a post's case or in its author's account's case, or a seal in force), post_media_keep, which keeps a held or frozen image row against every delete, raises in a cascade and outside READ COMMITTED, and post_media_guard, which keeps an image on its post and its owner the post's author; korbat_api can no longer delete a post or a profile; the contracts gain the canonical writer's own module and the moderation constants and digests; serve, forPosts, readyImages, find and status give only images whose own state is visible, and postAccess is exhaustive; test-db.mjs gains --fresh and --upgrade-from; the development cleaner deletes a doomed account's cases before its profile" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(db,contracts,api): the ground for moderation cases: migration 0014 drops the tables nothing wrote (reports, cases, appeals, strikes, transparency_log), their enums and profiles.reputation; 0015 creates the moderation tables (cases with one open case a target, intakes and their items, decisions and their ledger of measures, seal_posts, evidence snapshots, staff texts, the access log, the limits row, image holds and four auth tables) with their grants and forced columns, intake_items_attach, intake_items_quote, the view measures_in_force and the freeze: frozen_for and post_frozen (an unanswered suspect item in a post's case or in its author's account's case, or a seal in force), post_media_keep, which keeps a held or frozen image row against every delete, raises in a cascade and outside READ COMMITTED, and post_media_guard, which keeps an image on its post and its owner the post's author; korbat_api can no longer delete a post or a profile; the contracts gain the canonical writer's own module and the moderation constants and digests; serve, forPosts, readyImages, find and status give only images whose own state is visible, and postAccess is exhaustive; test-db.mjs gains --fresh and --upgrade-from; the development cleaner deletes a doomed account's cases before its profile`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 35>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-db-usage": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
