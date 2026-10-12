# korbat moderation cases (3c) — Task 3 of 12: Holds and images: MediaForCases (the intake's lock and holds, what a case reaches, the one function that serves staff an image, the disposal of images nothing retains), the deleters in id order, the image readers that follow an image's own state, and the placeholder for hidden and sealed images in the views, the contracts and the app

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-03 to 2026-10-12 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 and 2 laid the ground and built the decision engine. This task gives the media module its interface for cases (`MediaForCases`: the intake's lock and holds, what a case reaches, the staff image function, the disposal), puts the deleters in id order, teaches the image readers an image's own moderation state, and draws the placeholder for hidden and sealed images in the views, the contracts and the app. The design is `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (sections 5, 6.1, 7.1, 7.9, 7.10, 9 and 10).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(db,api,contracts,rules): the decision engine: migration 0016 records a decision as the statement of reasons (decisions_record forces its source, range, suspect, unseen and needs_admin; an admin's answer covers every unanswered suspect item of its case), checks and applies its measures (decision_actions_check and decision_actions_apply: a seal lists the posts whose image rows it locked in seal_posts and locks no post), derives every post's level and every image's state from the measures in force through the one writer moderation_apply, ends a seal taken while deciding where the answer ends it, guards posts' moderation columns, releases outcomes, and holds each decision and each of its ledger rows to the audit row a staff key confirmed, also when a caller runs the deferred check early; apps/api/src/lib/lock-bounds.ts bounds lock waits by a challenge's life for the auth repository, the command line and the decision; the moderation module records an intake in two passes (cases and items in target order, then the copies; the item korbat adds for a quoted post; retried on 40001, 40P01 and 55P03) and decides behind the staff gate and the step-up (POST /api/staff/cases/:case/decisions, 201 with the decision's id); packages/rules gains the rulebooks of versions 1 and 2 and the redress texts; socialForModeration reads posts, profiles and handles for cases, an old handle included; the tests that set a post's state decide through decideForTest; a contention lab measures seals, the purge and decisions against other transactions`.

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
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/03-holds-images.md 1
```

Expected: 21 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/media-cases.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { DISPOSAL_BATCH, mediaForCases, type MediaForCases } from "../../src/media";
import { createMediaRepo } from "../../src/media/repo";
import { ORPHAN_AGE_MS, RECONCILE_MAX_ORPHANS, sweep } from "../../src/media/sweeper";
import { recordIntake, type IntakeGround, type LiveTarget } from "../../src/moderation/intake";
import { createSocialRepo } from "../../src/social/repo";
import { webpBytes, type WebpKind } from "../media/webp-bytes";
import { mediaHarness, type MediaHarness } from "./media-harness";
import {
  aPost,
  act,
  anAccount,
  casesMedia,
  decideIn,
  gate,
  ground,
  imagePost,
  intake,
  moderationCounts,
  moderationDeps,
  newImageRow,
  newPostRow,
  newTestStaff,
  openCase,
  postFrozen,
  refusal,
  removeFixtures,
  report,
  staffProfile,
  untilBlocked,
  uuids,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements inside one open transaction, each a round trip, and the two-session ones
// wait for a lock on purpose: on a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };
const NO_SEAL: DecisionInput = { kind: "final", outcome: "no_violation" };

/**
 * What the media module does for moderation cases (3c design, section 5, MediaForCases), against the real database: the
 * intake's holds and its lock statement, the counts of what a case reaches, the one function that opens an image file for
 * staff (gate V), the disposal of image rows nothing retains, and the deleters' lock order. As korbat_api unless a test
 * needs a mark only migrator-owned code writes (an erasure, a released hold, a moved time): that code comes with a later
 * migration, so such a test writes the mark as the migrator. A test with one session runs inside a transaction that is
 * rolled back; a test with two sessions has to commit, and removes what it committed in a `finally`. The file's last
 * test holds it to leaving no moderation row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: holds, reach, the staff's image and the disposal", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 3 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await moderationCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  /** The same with the media module on that transaction and a store directory of its own, for the tests that open files. */
  const withStore = (fn: (tx: DbTx, h: MediaHarness) => Promise<void>, db: Db = apiDb) =>
    inWorld(async (tx) => {
      const h = await mediaHarness(tx as unknown as Db);
      try {
        await fn(tx, h);
      } finally {
        h.cleanup();
      }
    }, db);

  const profile = (db: Db | DbTx) => newProfile(db as Db);
  const repoOn = (db: Db | DbTx) => createMediaRepo(db as Db);
  const sorted = (ids: readonly string[]) => [...ids].sort();
  const authorDeletes = (db: Db | DbTx, postId: string, when: SQL = sql`now()`) =>
    db.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = ${when} where id = ${postId}::uuid`);
  /** Which of these image rows still exist, sorted. */
  async function existing(db: Db | DbTx, ids: readonly string[]): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`);
    return rows.map((row) => row.id);
  }
  /** The holds on these images, by image and then in the order they were placed. */
  async function holdsOf(db: Db | DbTx, mediaIds: readonly string[]) {
    const rows = await db.execute<{ media_id: string; case_id: string; released: boolean; until: string | null }>(
      sql`select media_id, case_id, released_at is not null as released, until::text as until from media_holds where media_id = any(${uuids(mediaIds)}) order by media_id, id`,
    );
    return rows.map((row) => ({ mediaId: row.media_id, caseId: row.case_id, released: row.released, until: row.until }));
  }
  const holdUntil = async (db: Db | DbTx, mediaId: string) => (await db.execute<{ until: string | null }>(sql`select hold_until::text as until from post_media where id = ${mediaId}::uuid`))[0]!.until;
  /** A case's evidence hold written as a row, with an end when one is given. */
  const holdRow = (db: Db | DbTx, mediaId: string, caseId: string, until: SQL = sql`null`) =>
    db.execute(sql`insert into media_holds (media_id, case_id, until) values (${mediaId}::uuid, ${caseId}::uuid, ${until})`);
  /** A release as the migrator-owned code of a later migration makes it: an update of the hold's row. */
  const release = (tx: DbTx, mediaId: string, when: SQL = sql`now()`) => tx.execute(sql`update media_holds set released_at = ${when} where media_id = ${mediaId}::uuid and released_at is null`);

  /** The transaction with every statement it is asked to run recorded: the statement itself, its text and the rows it answered. */
  function spying(tx: DbTx) {
    const dialect = new PgDialect();
    const seen: { query: SQL; text: string; rows: Record<string, unknown>[] }[] = [];
    const spy = new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== "execute") return Reflect.get(target, property, receiver) as unknown;
        return async (query: SQL) => {
          const rows = await target.execute(query);
          seen.push({ query, text: dialect.sqlToQuery(query).sql.replace(/\s+/g, " ").trim(), rows: [...rows] as Record<string, unknown>[] });
          return rows;
        };
      },
    });
    return { spy, seen };
  }

  /**
   * One intake through the moderation module, which runs its transaction again by itself after a deadlock, a lock timeout
   * or a case that closed under it. It answers how many runs the intake took, so a deadlock the module absorbed is counted
   * here and not just survived. `afterCopy`, when given, is called each time a post was copied under its share lock.
   */
  async function intakeRuns(db: Db | DbTx, sent: IntakeGround, live: LiveTarget[], afterCopy?: (postId: string) => Promise<void>): Promise<number> {
    const deps = moderationDeps(db);
    let runs = 0;
    const counting = new Proxy(deps.apiDb, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver) as unknown;
        return (...args: Parameters<Db["transaction"]>) => {
          runs++;
          return target.transaction(...args);
        };
      },
    });
    const social: typeof deps.social = !afterCopy
      ? deps.social
      : {
          ...deps.social,
          capturePost: async (tx, postId) => {
            const post = await deps.social.capturePost(tx, postId);
            await afterCopy(postId);
            return post;
          },
        };
    await recordIntake({ ...deps, apiDb: counting, social }, { ground: sent, live });
    return runs;
  }

  /** Thrown to leave a savepoint by rolling it back, and caught by whoever opened it. */
  const ROLLBACK = new Error("rolled back on purpose");

  /** One node of a plan as `explain (format json)` gives it. */
  interface PlanNode {
    "Node Type": string;
    Plans?: PlanNode[];
    [key: string]: unknown;
  }
  /** The plan PostgreSQL would run the statement under, as a flat list of its nodes. */
  async function planOf(tx: DbTx, statement: SQL): Promise<PlanNode[]> {
    const [row] = await tx.execute<{ "QUERY PLAN": { Plan: PlanNode }[] }>(sql`explain (format json) ${statement}`);
    const flat = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flat)];
    return flat(row!["QUERY PLAN"][0]!.Plan);
  }
  /** The nodes of a plan one of whose conditions calls the freeze's predicate, each by its type. */
  const readsFreeze = (nodes: PlanNode[]): string[] =>
    nodes
      .filter((node) => ["Filter", "Join Filter", "Index Cond", "Recheck Cond", "Hash Cond", "Merge Cond", "One-Time Filter"].some((key) => typeof node[key] === "string" && (node[key] as string).includes("post_frozen")))
      .map((node) => node["Node Type"]);

  /**
   * Takes every image row that is disposable now, in a transaction of the caller's: the suites share one database, and a
   * row another suite left on a deleted post would otherwise be counted among a test's own, or fill its batch.
   */
  async function drain(tx: DbTx): Promise<void> {
    while ((await repoOn(tx).dropDisposable(tx, 500)).length === 500);
  }

  describe("hold", () => {
    test("a post pair places the case's hold on every image of the post and answers them in position order, with their alt texts and sizes", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 3);
        const caseId = await openCase(tx, "post", p.postId);
        const held = await casesMedia(tx).hold(tx, [{ caseId, postId: p.postId }]);
        expect([...held.keys()]).toEqual([p.postId]);
        expect(held.get(p.postId)).toEqual(p.mediaIds.map((id, position) => ({ id, alt: `image ${position + 1}`, width: 1200, height: 800 })));
        expect(await holdsOf(tx, p.mediaIds)).toEqual(sorted(p.mediaIds).map((mediaId) => ({ mediaId, caseId, released: false, until: null })));
        for (const id of p.mediaIds) expect(await holdUntil(tx, id)).toBe("infinity");
        // What the hold is for: the author's deletion leaves the rows, and names no file to delete.
        await authorDeletes(tx, p.postId);
        expect(await repoOn(tx).detachAll(tx, p.postId)).toEqual([]);
        expect(await existing(tx, p.mediaIds)).toEqual(sorted(p.mediaIds));
      });
    });

    test("a second hold by the same case adds nothing; another case's hold stands beside it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const postCase = await openCase(tx, "post", p.postId);
        const otherCase = await openCase(tx, "account", p.authorId);
        const media = casesMedia(tx);
        const first = await media.hold(tx, [{ caseId: postCase, postId: p.postId }]);
        expect(await media.hold(tx, [{ caseId: postCase, postId: p.postId }])).toEqual(first);
        expect(await holdsOf(tx, p.mediaIds)).toHaveLength(2);
        await media.hold(tx, [{ caseId: otherCase, postId: p.postId }]);
        expect((await holdsOf(tx, p.mediaIds)).map((hold) => hold.caseId).sort()).toEqual([postCase, postCase, otherCase, otherCase].sort());
      });
    });

    test("a hold that was released is placed again by a later report", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const caseId = await openCase(tx, "post", p.postId);
        const media = casesMedia(tx);
        await media.hold(tx, [{ caseId, postId: p.postId }]);
        await release(tx, p.mediaIds[0]!);
        expect(await holdUntil(tx, p.mediaIds[0]!)).toBeNull();
        await media.hold(tx, [{ caseId, postId: p.postId }]);
        expect((await holdsOf(tx, p.mediaIds)).map((hold) => hold.released)).toEqual([true, false]);
        expect(await holdUntil(tx, p.mediaIds[0]!)).toBe("infinity");
      }, migrateDb);
    });

    test("an erased image, and every image of a post whose content was erased, is listed without its alt text and gets no hold", async () => {
      await inWorld(async (tx) => {
        const one = await imagePost(tx, 2);
        const whole = await imagePost(tx, 1, one.authorId);
        // What the R4 redaction will leave: marks only migrator-owned code writes.
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${one.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${whole.postId}::uuid`);
        const [caseOne, caseWhole] = [await openCase(tx, "post", one.postId), await openCase(tx, "post", whole.postId)];
        const held = await casesMedia(tx).hold(tx, [
          { caseId: caseOne, postId: one.postId },
          { caseId: caseWhole, postId: whole.postId },
        ]);
        expect(held.get(one.postId)).toEqual([
          { id: one.mediaIds[0], alt: null, width: 1200, height: 800 },
          { id: one.mediaIds[1], alt: "image 2", width: 1200, height: 800 },
        ]);
        expect(held.get(whole.postId)).toEqual([{ id: whole.mediaIds[0], alt: null, width: 1200, height: 800 }]);
        // No report prolongs the retention of what an erasure erased: only the image that was not erased is held.
        expect(await holdsOf(tx, [...one.mediaIds, ...whole.mediaIds])).toEqual([{ mediaId: one.mediaIds[1], caseId: caseOne, released: false, until: null }]);
      }, migrateDb);
    });

    test("a post without an image answers an empty list, and a hold of nothing issues no statement", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const caseId = await openCase(tx, "post", p.postId);
        const held = await casesMedia(tx).hold(tx, [{ caseId, postId: p.postId }]);
        expect([...held.entries()]).toEqual([[p.postId, []]]);
        const { spy, seen } = spying(tx);
        expect((await casesMedia(tx).hold(spy, [])).size).toBe(0);
        expect(seen).toEqual([]);
      });
    });

    test("an owner pair locks every image on the account's posts and holds none; posts' pairs and the owner's rows are locked by one statement, in one id order, and no post is locked", async () => {
      await inWorld(async (tx) => {
        const first = await imagePost(tx, 2);
        const second = await imagePost(tx, 2, first.authorId);
        const other = await imagePost(tx, 2);
        const stranger = await imagePost(tx, 1);
        const upload = await newImageRow(tx, first.authorId, null);
        const otherCase = await openCase(tx, "post", other.postId);
        const { spy, seen } = spying(tx);
        const held = await casesMedia(tx).hold(spy, [{ caseId: otherCase, postId: other.postId }, { ownerId: first.authorId }]);

        const locks = seen.filter((statement) => /\bfor (key share|share|update|no key update)\b/.test(statement.text));
        expect(locks).toHaveLength(1);
        // The rows are the images' own, the posts are read and never locked, and the order is the rows' ids.
        expect(locks[0]!.text).toMatch(/from post_media m join posts p on p\.id = m\.post_id where .* order by m\.id for key share of m$/);
        const reached = sorted([...first.mediaIds, ...second.mediaIds, ...other.mediaIds]);
        expect(locks[0]!.rows.map((row) => row.id)).toEqual(reached);
        expect(locks[0]!.rows.map((row) => row.id)).not.toContain(upload);
        expect(locks[0]!.rows.map((row) => row.id)).not.toContain(stranger.mediaIds[0]);

        // Only the post pair is answered and held: the owner's images are kept by the freeze, not by a hold.
        expect([...held.keys()]).toEqual([other.postId]);
        expect(held.get(other.postId)!.map((image) => image.id)).toEqual(other.mediaIds);
        expect((await holdsOf(tx, [...first.mediaIds, ...second.mediaIds, ...other.mediaIds, upload])).map((hold) => hold.mediaId)).toEqual(sorted(other.mediaIds));
        // The holds are placed in the images' id order, as they will be released.
        const inserts = seen.filter((statement) => statement.text.startsWith("insert into media_holds"));
        expect(inserts).toHaveLength(1);
        expect(inserts[0]!.text).toMatch(/order by [a-z.]*media_id$/);
      });
    });

    test("an owner pair alone answers nothing and holds nothing", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const held = await casesMedia(tx).hold(tx, [{ ownerId: p.authorId }]);
        expect(held.size).toBe(0);
        expect(await holdsOf(tx, p.mediaIds)).toEqual([]);
      });
    });
  });

  describe("the intake's holds", () => {
    test("a report under a rule holds the post's images for its case and lists them in the post's snapshot; a report of child sexual abuse material about an account holds none and freezes them all", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId), "rule");
        expect(await holdsOf(tx, p.mediaIds)).toEqual(sorted(p.mediaIds).map((mediaId) => ({ mediaId, caseId, released: false, until: null })));
        const [snapshot] = await tx.execute<{ media: unknown }>(sql`select media from evidence_snapshots where case_id = ${caseId}::uuid`);
        expect(snapshot!.media).toEqual(p.mediaIds.map((id, position) => ({ id, alt: `image ${position + 1}`, width: 1200, height: 800 })));

        const q = await imagePost(tx, 2);
        const handle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${q.authorId}::uuid`))[0]!.handle;
        const account = await report(tx, anAccount(q.authorId, handle), "csam");
        expect(await holdsOf(tx, q.mediaIds)).toEqual([]);
        expect(await postFrozen(tx, q.postId)).toBe(true);
        // An account's snapshot copies its fields and lists no image.
        const [fields] = await tx.execute<{ media: unknown }>(sql`select media from evidence_snapshots where case_id = ${account.caseId}::uuid`);
        expect(fields!.media).toBeNull();
      });
    });

    test("a second report into the same case adds no hold and no snapshot; a notice that names a post and its author's account holds the post's images once", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const first = await report(tx, aPost(p.postId), "rule");
        const second = await report(tx, aPost(p.postId), "illegal");
        expect(second.caseId).toBe(first.caseId);
        expect(await holdsOf(tx, p.mediaIds)).toHaveLength(2);
        const [snapshots] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from evidence_snapshots where case_id = ${first.caseId}::uuid`);
        expect(snapshots!.n).toBe(1);

        const q = await imagePost(tx, 2);
        const handle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${q.authorId}::uuid`))[0]!.handle;
        const recorded = await intake(tx, ground.csam(), [aPost(q.postId, 1), anAccount(q.authorId, handle, 2)]);
        const postCase = recorded.items.find((item) => item.targetType === "post")!.caseId!;
        expect(await holdsOf(tx, q.mediaIds)).toEqual(sorted(q.mediaIds).map((mediaId) => ({ mediaId, caseId: postCase, released: false, until: null })));
      });
    });

    test("a report of child sexual abuse material about a post its author deleted holds what is left of its images, and the tombstone's snapshot lists them", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        // An earlier case, closed since, still holds one image; its hold on the other was released, and that image went
        // with the post when its author deleted it.
        const earlier = await report(tx, aPost(p.postId), "rule");
        await decideIn(tx, mod, earlier.caseId, { kind: "final", outcome: "no_violation" });
        await release(tx, p.mediaIds[1]!);
        await authorDeletes(tx, p.postId);
        expect(await repoOn(tx).detachAll(tx, p.postId)).toEqual([p.mediaIds[1]]);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(caseId).not.toBe(earlier.caseId);
        expect((await holdsOf(tx, p.mediaIds)).map((hold) => hold.caseId).sort()).toEqual([earlier.caseId, caseId].sort());
        const [snapshot] = await tx.execute<{ media: unknown; post_state: string; body: string }>(sql`select media, post_state, body from evidence_snapshots where case_id = ${caseId}::uuid`);
        expect(snapshot).toEqual({ post_state: "deleted_by_author", body: "", media: [{ id: p.mediaIds[0], alt: "image 1", width: 1200, height: 800 }] });
      }, migrateDb);
    });
  });

  describe("reach", () => {
    const day = async (tx: DbTx, at: SQL) => (await tx.execute<{ d: string }>(sql`select to_char((${at}) at time zone 'UTC', 'YYYY-MM-DD') as d`))[0]!.d;
    const createdAt = async (tx: DbTx, postId: string) => new Date((await tx.execute<{ at: string }>(sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from posts where id = ${postId}::uuid`))[0]!.at);
    /** A post of the author created this long ago, with this many images. */
    async function postAged(tx: DbTx, authorId: string, age: string, images: number) {
      const postId = await newPostRow(tx, authorId, { createdAt: sql`now() - ${age}::interval` });
      const mediaIds: string[] = [];
      for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(tx, authorId, postId, position));
      return { postId, mediaIds };
    }

    test("a post case reaches its post: its image rows, how many are sealed and served, and the post's day", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const p = await postAged(tx, author.id, "3 days", 3);
        const media = casesMedia(tx);
        expect(await media.reach({ type: "post", id: p.postId })).toEqual({ posts: 1, images: 3, sealed: 0, served: 3, newestPostOn: await day(tx, sql`now() - interval '3 days'`), newestServedAt: await createdAt(tx, p.postId) });
        // A post without an image, and an id that names nothing, reach nothing.
        const empty = await postAged(tx, author.id, "1 day", 0);
        const nothing = { posts: 0, images: 0, sealed: 0, served: 0, newestPostOn: null, newestServedAt: null };
        expect(await media.reach({ type: "post", id: empty.postId })).toEqual(nothing);
        expect(await media.reach({ type: "post", id: author.id })).toEqual(nothing);
        expect(await media.reach({ type: "account", id: p.postId })).toEqual(nothing);
      });
    });

    test("an account case reaches every post of the account whatever its state, and nothing else: not an upload on no post, not another account's post", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const old = await postAged(tx, author.id, "9 days", 2);
        const deleted = await postAged(tx, author.id, "2 days", 1);
        await authorDeletes(tx, deleted.postId);
        const served = await postAged(tx, author.id, "5 days", 1);
        await postAged(tx, author.id, "1 day", 0);
        await newImageRow(tx, author.id, null);
        const stranger = await profile(tx);
        await postAged(tx, stranger.id, "1 hour", 4);
        // The newest post with image rows is the deleted one; the newest whose image is still served is the one before it.
        expect(await casesMedia(tx).reach({ type: "account", id: author.id })).toEqual({
          posts: 3,
          images: 4,
          sealed: 0,
          served: 3,
          newestPostOn: await day(tx, sql`now() - interval '2 days'`),
          newestServedAt: await createdAt(tx, served.postId),
        });
        expect(old.mediaIds).toHaveLength(2);
      });
    });

    test("after a seal nothing the case reaches is served; an image posted afterwards is served again, and counted as the newest", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const p = await postAged(tx, author.id, "4 days", 2);
        const { caseId } = await report(tx, anAccount(author.id, author.handle), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        const media = casesMedia(tx);
        expect(await media.reach({ type: "account", id: author.id })).toEqual({ posts: 1, images: 2, sealed: 2, served: 0, newestPostOn: await day(tx, sql`now() - interval '4 days'`), newestServedAt: null });
        expect(await media.reach({ type: "post", id: p.postId })).toMatchObject({ images: 2, sealed: 2, served: 0, newestServedAt: null });
        // A seal covers the images that exist when it is taken.
        const later = await postAged(tx, author.id, "1 hour", 1);
        expect(await media.reach({ type: "account", id: author.id })).toEqual({ posts: 2, images: 3, sealed: 2, served: 1, newestPostOn: await day(tx, sql`now() - interval '1 hour'`), newestServedAt: await createdAt(tx, later.postId) });
      });
    });

    test("an erased image, and an image of a post whose content was erased, is counted and not served", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const one = await postAged(tx, author.id, "3 days", 2);
        const whole = await postAged(tx, author.id, "2 days", 1);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${one.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${whole.postId}::uuid`);
        expect(await casesMedia(tx).reach({ type: "account", id: author.id })).toMatchObject({ posts: 2, images: 3, sealed: 0, served: 1, newestServedAt: await createdAt(tx, one.postId) });
      }, migrateDb);
    });

    test("it locks nothing, and answers counts, a day and a time: never an id, an alt text or a file", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { spy, seen } = spying(tx);
        const answer = await casesMedia(spy).reach({ type: "post", id: p.postId });
        expect(Object.keys(answer).sort()).toEqual(["images", "newestPostOn", "newestServedAt", "posts", "sealed", "served"]);
        expect(seen).toHaveLength(1);
        expect(seen[0]!.text).not.toMatch(/\bfor (key share|share|update|no key update)\b/);
        expect(JSON.stringify(answer)).not.toContain(p.mediaIds[0]);
      });
    });
  });

  describe("staffImage: the one function that opens an image file for staff", () => {
    /** Writes the two files of a ready image as the worker would: WebP headers that state these sizes. */
    function webp(h: MediaHarness, id: string, large: [WebpKind, number, number] = ["VP8X", 2048, 1536], small: [WebpKind, number, number] = ["VP8 ", 1024, 768]) {
      writeFileSync(h.files.store.image(id, "large"), webpBytes(...large, `large of ${id}`));
      writeFileSync(h.files.store.image(id, "small"), webpBytes(...small, `small of ${id}`));
    }
    /** What staffImage answers, with the file it opened closed again: the image's post and the file's size, or null. */
    async function open(media: MediaForCases, id: string, size: "small" | "large" = "large") {
      const got = await media.staffImage(id, size);
      if (!got) return null;
      await got.file.handle.close();
      return { postId: got.postId, bytes: got.file.size };
    }
    /** A post with images whose files are WebP files of the sizes their rows state. */
    async function webpPost(h: MediaHarness, authorId: string, images = 1) {
      const p = await h.postWithImages(authorId, images);
      for (const id of p.mediaIds) webp(h, id);
      return p;
    }

    test("it opens an image of a post nobody froze, in either size, and says which post the image is on", async () => {
      await withStore(async (_tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 2);
        const media = mediaForCases(h.deps);
        for (const id of p.mediaIds) {
          expect(await open(media, id, "large")).toEqual({ postId: p.postId, bytes: webpBytes("VP8X", 2048, 1536, `large of ${id}`).length });
          expect(await open(media, id, "small")).toEqual({ postId: p.postId, bytes: webpBytes("VP8 ", 1024, 768, `small of ${id}`).length });
        }
      });
    });

    test.each(["its own item", "its author's account's item", "an item korbat added for a post it is quoted by"] as const)(
      "it refuses every image of a post frozen through %s, and opens them again once an admin has answered without a seal",
      async (reach) => {
        await withStore(async (tx, h) => {
          const ada = await h.established();
          const p = await webpPost(h, ada.id, 2);
          const media = mediaForCases(h.deps);
          let caseId: string;
          if (reach === "its own item") caseId = (await report(tx, aPost(p.postId), "csam")).caseId;
          else if (reach === "its author's account's item") caseId = (await report(tx, anAccount(ada.id, ada.handle), "csam")).caseId;
          else {
            const quoting = await newPostRow(tx, (await profile(tx)).id, { quoteOfId: p.postId });
            const { recorded } = await report(tx, aPost(quoting), "csam");
            // The notice named the quoting post; the item at its position plus 10 is the quoted post's.
            caseId = recorded.items.find((item) => item.position === 11)!.caseId!;
          }
          expect(await postFrozen(tx, p.postId)).toBe(true);
          for (const id of p.mediaIds) for (const size of ["large", "small"] as const) expect(await open(media, id, size), `${id} ${size}`).toBeNull();
          await decideIn(tx, admin, caseId, NO_SEAL);
          expect(await postFrozen(tx, p.postId)).toBe(false);
          for (const id of p.mediaIds) expect(await open(media, id)).toMatchObject({ postId: p.postId });
        });
      },
    );

    test("a closed case's images are judged by the material: a later report of child sexual abuse material takes them out of staff's sight until an admin answers", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 1);
        const media = mediaForCases(h.deps);
        const closed = await report(tx, aPost(p.postId), "rule");
        await decideIn(tx, mod, closed.caseId, { kind: "final", actions: [act("remove")] });
        // A removed post's image is still evidence staff may open.
        expect(await open(media, p.mediaIds[0]!)).toMatchObject({ postId: p.postId });
        const notice = await report(tx, aPost(p.postId), "csam");
        expect(await open(media, p.mediaIds[0]!)).toBeNull();
        await decideIn(tx, admin, notice.caseId, NO_SEAL);
        expect(await open(media, p.mediaIds[0]!)).toMatchObject({ postId: p.postId });
      });
    });

    test("it refuses a sealed image: under a seal taken while deciding, under a seal for good, which keeps the post frozen though its case is closed, until an admin lifts it", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 2);
        const media = mediaForCases(h.deps);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        for (const id of p.mediaIds) expect(await open(media, id)).toBeNull();
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        for (const id of p.mediaIds) expect(await open(media, id)).toBeNull();
        await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: final, actions: [act("unseal_media")] });
        for (const id of p.mediaIds) expect(await open(media, id)).toMatchObject({ postId: p.postId });
      });
    });

    test("it refuses an erased image and every image of a post whose content was erased", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const one = await webpPost(h, ada.id, 2);
        const whole = await webpPost(h, ada.id, 1);
        const media = mediaForCases(h.deps);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${one.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${whole.postId}::uuid`);
        expect(await open(media, one.mediaIds[0]!)).toBeNull();
        expect(await open(media, whole.mediaIds[0]!)).toBeNull();
        expect(await open(media, one.mediaIds[1]!)).toMatchObject({ postId: one.postId });
      }, migrateDb);
    });

    test("it opens the held image of a post its author deleted, which is evidence, and nothing that is on no post, not ready or not there", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 1);
        const media = mediaForCases(h.deps);
        await report(tx, aPost(p.postId), "rule");
        await authorDeletes(tx, p.postId);
        expect(await h.deps.repo.detachAll(tx, p.postId)).toEqual([]);
        expect(await open(media, p.mediaIds[0]!)).toMatchObject({ postId: p.postId });

        const upload = await h.readyImage(ada.id);
        webp(h, upload);
        expect(await open(media, upload)).toBeNull();
        expect(await open(media, h.newId())).toBeNull();
      });
    });

    test("the file is checked before it is handed over: a WebP of the variant's size, and for the large one of the row's size; a refusal is logged as a fault of the store", async () => {
      await withStore(async (tx, h) => {
        const ada = await h.established();
        const p = await webpPost(h, ada.id, 1);
        const id = p.mediaIds[0]!;
        const faults: string[] = [];
        const log = { error: (_fields: unknown, message: string) => faults.push(message), warn: () => undefined, info: () => undefined } as unknown as Logger;
        const media = mediaForCases({ ...h.deps, log });
        const refusedWith = async (size: "small" | "large") => {
          const count = faults.length;
          expect(await open(media, id, size), size).toBeNull();
          expect(faults.length, size).toBe(count + 1);
          expect(faults.at(-1)).toMatch(/^media store: /);
        };

        // Each of the three forms a WebP takes is accepted.
        for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) {
          webp(h, id, [kind, 2048, 1536], [kind, 1024, 768]);
          expect(await open(media, id, "large"), kind).not.toBeNull();
          expect(await open(media, id, "small"), kind).not.toBeNull();
        }
        expect(faults).toEqual([]);

        // Not a WebP at all: what the stand-in worker of the other suites writes, and a JPEG's first bytes.
        writeFileSync(h.files.store.image(id, "large"), `large-webp-of-${id} and enough text to fill thirty bytes`);
        await refusedWith("large");
        writeFileSync(h.files.store.image(id, "small"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 0x20)]));
        await refusedWith("small");
        // Shorter than a header.
        writeFileSync(h.files.store.image(id, "small"), webpBytes("VP8X", 1024, 768).subarray(0, 20));
        await refusedWith("small");

        // A longer side beyond the variant's edge: 1024 for the small one.
        webp(h, id, ["VP8X", 2048, 1536], ["VP8X", 1025, 768]);
        await refusedWith("small");
        webp(h, id, ["VP8X", 2048, 1536], ["VP8L", 600, 1025]);
        await refusedWith("small");
        // The large one must be the size its row states (2048 by 1536 here), not another, and not its sides swapped.
        webp(h, id, ["VP8X", 2048, 1535]);
        await refusedWith("large");
        webp(h, id, ["VP8X", 1536, 2048]);
        await refusedWith("large");

        // A row that states a size beyond the large variant's edge of 2048 is no better for a file that agrees with it.
        const wide = await h.readyImage(ada.id, { width: 4096, height: 100 });
        const widePost = await newPostRow(tx, ada.id);
        await tx.execute(sql`update post_media set post_id = ${widePost}::uuid, position = 0, alt_text = 'wide' where id = ${wide}::uuid`);
        webp(h, wide, ["VP8X", 4096, 100], ["VP8X", 1024, 25]);
        const count = faults.length;
        expect(await open(media, wide, "large")).toBeNull();
        expect(faults.length).toBe(count + 1);
        expect(await open(media, wide, "small")).not.toBeNull();

        // A file that is not there is not found, as for any reader.
        rmSync(h.files.store.image(id, "large"));
        expect(await open(media, id, "large")).toBeNull();
      });
    });
  });

  describe("dropDisposable: the one deleter of images a case or a freeze kept", () => {
    test("a batch is half of what one reconcile pass deletes without being forced", () => {
      expect(DISPOSAL_BATCH).toBe(25);
      expect(DISPOSAL_BATCH).toBe(RECONCILE_MAX_ORPHANS / 2);
    });

    test("the files of a batch whose request was skipped are deleted by one reconcile pass without MEDIA_RECONCILE=force", async () => {
      await withStore(async (tx, h) => {
        await drain(tx);
        // Seven deleted posts of four images each, with their files in the store: 28 disposable rows, more than a batch.
        const all: string[] = [];
        for (let n = 0; n < 7; n++) {
          const p = await h.postWithImages((await h.established()).id, 4);
          await authorDeletes(tx, p.postId);
          all.push(...p.mediaIds);
        }
        const gone = await mediaForCases(h.deps).dropDisposable(tx);
        expect(gone).toEqual(sorted(all).slice(0, DISPOSAL_BATCH));
        // The crash: the batch's rows are gone, and its files were never asked for.
        expect((await h.files.deletionRequests()).filter((id) => all.includes(id))).toEqual([]);
        expect(h.deps.reconcileMode).toBe("on");

        // A reconcile pass once the files are old enough to be orphans: it takes all 25 for files without a row, which is
        // within what it deletes by itself, and refuses none.
        const report = await sweep(h.deps, new Date(Date.now() + 2 * ORPHAN_AGE_MS), { reconcile: true });
        expect(report.refused).toBe(0);
        expect(report.orphans).toBe(DISPOSAL_BATCH);
        expect(sorted((await h.files.deletionRequests()).filter((id) => all.includes(id)))).toEqual(gone);
        // The three rows the batch left keep their files.
        expect(await existing(tx, all)).toEqual(sorted(all).slice(DISPOSAL_BATCH));
      });
    });

    test("the freeze is read only for rows that carry a mark of disposal: in neither statement's plan does a scan's filter name the predicate", async () => {
      await inWorld(async (tx) => {
        const { spy, seen } = spying(tx);
        const repo = repoOn(spy);
        await repo.dropDisposable(spy, DISPOSAL_BATCH);
        await repo.overdueDeletions();
        expect(seen.map((statement) => statement.text.slice(0, 30))).toEqual(["with batch as materialized ( s", "select count(*)::int as n from"]);
        // Under the plan the planner picks, and under each join method alone.
        for (const off of [[], ["enable_nestloop"], ["enable_hashjoin", "enable_mergejoin"]]) {
          await tx.transaction(async (sp) => {
            for (const setting of off) await sp.execute(sql.raw(`set local ${setting} = off`));
            for (const statement of seen) {
              const label = `${statement.text.slice(0, 30)}, without ${off.join(" and ") || "nothing"}`;
              const nodes = await planOf(sp, statement.query);
              const reading = readsFreeze(nodes);
              // The predicate is read where a row's post and owner are known: at a join, never as the filter of a scan,
              // which would call it for every attached image row in the table.
              expect(reading.length, label).toBeGreaterThan(0);
              expect(reading.filter((type) => type.includes("Scan")), label).toEqual([]);
              // And wherever it is read, it is the branch of the CASE that comes after the marks were tested.
              for (const node of nodes) {
                for (const condition of Object.values(node)) {
                  if (typeof condition === "string" && condition.includes("post_frozen")) expect(condition, label).toMatch(/CASE WHEN \(\(p\.state = 'deleted_by_author'.*\) THEN \(.*post_frozen\(m\.post_id\).*\) ELSE false END/);
                }
              }
            }
            // The settings were for this savepoint alone.
            throw ROLLBACK;
          }).catch((err: unknown) => {
            if (err !== ROLLBACK) throw err;
          });
        }
        // What the pin is there against: the freeze as a condition of its own on the image row is the filter of that row's scan.
        const separate = sql`
          select m.id from post_media m join profiles o on o.id = m.owner_id left join posts p on p.id = m.post_id
          where (p.state = 'deleted_by_author' or o.deleted_at is not null or p.erased_at is not null or m.erased_at is not null)
            and (m.post_id is null or not public.post_frozen(m.post_id))`;
        expect(readsFreeze(await planOf(tx, separate)).filter((type) => type.includes("Scan"))).not.toEqual([]);
      });
    });

    test("each branch of its predicate: a row goes when nothing retains it and its post is deleted, its owner is purged, or its post's or its own content was erased", async () => {
      await inWorld(async (tx) => {
        await drain(tx);
        const media = casesMedia(tx);
        const owner = await profile(tx);
        const postOf = async (images: number, ownerId = owner.id) => imagePost(tx, images, ownerId);
        const caseOf = (postId: string) => openCase(tx, "post", postId);

        // Kept: nothing about these rows says that they may go.
        const live = await postOf(2);
        const liveUpload = await newImageRow(tx, owner.id, null);
        // A deleted post's rows, which a freeze or a hold that has ended left behind.
        const deleted = await postOf(2);
        await authorDeletes(tx, deleted.postId);
        // Retained: an unreleased hold without an end, and one whose end lies ahead.
        const held = await postOf(2);
        await holdRow(tx, held.mediaIds[0]!, await caseOf(held.postId));
        await holdRow(tx, held.mediaIds[1]!, await caseOf(held.postId), sql`now() + interval '1 hour'`);
        await authorDeletes(tx, held.postId);
        // No longer retained: a released hold, and a hold whose end has passed.
        const released = await postOf(2);
        await holdRow(tx, released.mediaIds[0]!, await caseOf(released.postId));
        await release(tx, released.mediaIds[0]!);
        await holdRow(tx, released.mediaIds[1]!, await caseOf(released.postId), sql`now() - interval '1 minute'`);
        await authorDeletes(tx, released.postId);
        // An erased image of a visible post goes; its sibling stays. Every image of a post whose content was erased goes.
        const erasedImage = await postOf(2);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${erasedImage.mediaIds[0]!}::uuid`);
        const erasedPost = await postOf(1);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${erasedPost.postId}::uuid`);
        // An erased image that another case still holds is retained like any held row.
        const erasedHeld = await postOf(1);
        await tx.execute(sql`update post_media set erased_at = now(), alt_text = '' where id = ${erasedHeld.mediaIds[0]!}::uuid`);
        await holdRow(tx, erasedHeld.mediaIds[0]!, await caseOf(erasedHeld.postId));
        // A purged owner's upload on no post that a hold kept through the purge and no longer keeps; a live owner's stays.
        const purged = await profile(tx);
        const purgedUpload = await newImageRow(tx, purged.id, null);
        await holdRow(tx, purgedUpload, await openCase(tx, "account", purged.id), sql`now() - interval '1 minute'`);
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${purged.id}::uuid`);
        const lapsedUpload = await newImageRow(tx, owner.id, null);
        await holdRow(tx, lapsedUpload, await openCase(tx, "account", owner.id), sql`now() - interval '1 minute'`);

        const gone = [...deleted.mediaIds, ...released.mediaIds, erasedImage.mediaIds[0]!, ...erasedPost.mediaIds, purgedUpload];
        const kept = [...live.mediaIds, liveUpload, ...held.mediaIds, erasedImage.mediaIds[1]!, ...erasedHeld.mediaIds, lapsedUpload];
        // The lowest ids first, and each id it answers names a row that is gone.
        expect(await media.dropDisposable(tx)).toEqual(sorted(gone));
        expect(await existing(tx, [...gone, ...kept])).toEqual(sorted(kept));
        // The history of a deleted row's holds goes with it.
        expect(await holdsOf(tx, gone)).toEqual([]);
        expect(await media.dropDisposable(tx)).toEqual([]);
      }, migrateDb);
    });

    test("a frozen post's rows are no candidates, under each kind of freeze; a row whose freeze has ended goes", async () => {
      await inWorld(async (tx) => {
        await drain(tx);
        const media = casesMedia(tx);
        // Through the account's item, which places no hold: the freeze alone keeps the rows of the deleted post.
        const p = await imagePost(tx, 2);
        const handle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${p.authorId}::uuid`))[0]!.handle;
        const { caseId } = await report(tx, anAccount(p.authorId, handle), "csam");
        await authorDeletes(tx, p.postId);
        expect(await media.dropDisposable(tx)).toEqual([]);
        // Through a seal for good, whose case is closed.
        const q = await imagePost(tx, 1);
        const qHandle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${q.authorId}::uuid`))[0]!.handle;
        const sealing = await report(tx, anAccount(q.authorId, qHandle), "csam");
        const sealed = await decideIn(tx, admin, sealing.caseId, SEAL_FOR_GOOD);
        await authorDeletes(tx, q.postId);
        expect(await media.dropDisposable(tx)).toEqual([]);

        // The admin answers the first without a seal: its freeze ends, and the rows are disposable at once.
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await media.dropDisposable(tx)).toEqual(sorted(p.mediaIds));
        // The seal is lifted: the second post's row goes too.
        await decideIn(tx, admin, sealing.caseId, { kind: "correction", reviewsDecisionId: sealed, actions: [act("unseal_media")] });
        expect(await media.dropDisposable(tx)).toEqual(q.mediaIds);
        expect(await existing(tx, [...p.mediaIds, ...q.mediaIds])).toEqual([]);
      });
    });

    test("60 disposable rows go in three batches of 25, 25 and 10, the lowest ids first; of 60 rows with 40 on a frozen account's posts, the other 20 go in one batch and the next is empty", async () => {
      await inWorld(async (tx) => {
        await drain(tx);
        const media = casesMedia(tx);
        const owner = await profile(tx);
        const all: string[] = [];
        for (let n = 0; n < 15; n++) {
          const p = await imagePost(tx, 4, owner.id);
          await authorDeletes(tx, p.postId);
          all.push(...p.mediaIds);
        }
        const order = sorted(all);
        expect(await media.dropDisposable(tx)).toEqual(order.slice(0, 25));
        expect(await media.dropDisposable(tx)).toEqual(order.slice(25, 50));
        expect(await media.dropDisposable(tx)).toEqual(order.slice(50));
        expect(await media.dropDisposable(tx)).toEqual([]);

        const frozen = await profile(tx);
        await report(tx, anAccount(frozen.id, frozen.handle), "csam");
        const free: string[] = [];
        for (let n = 0; n < 15; n++) {
          const p = await imagePost(tx, 4, n < 10 ? frozen.id : owner.id);
          await authorDeletes(tx, p.postId);
          if (n >= 10) free.push(...p.mediaIds);
        }
        // The kept rows never fill a batch: the candidates leave them out.
        expect(await media.dropDisposable(tx)).toEqual(sorted(free));
        expect(await media.dropDisposable(tx)).toEqual([]);
      });
    }, 120_000);

    test("a batch is a batch whatever plan the statement gets: the candidates are chosen once, also when the planner would scan them again for every row", async () => {
      // A delete whose candidates are a sub-select with a limit and row locks deletes more than the limit when the
      // planner joins by a nested loop and runs the sub-select again for each row: every run skips the rows this
      // statement has deleted already and lets the next ones in. These settings leave the planner only that join.
      for (const settings of [["enable_hashjoin", "enable_mergejoin", "enable_material"], ["enable_hashjoin", "enable_mergejoin", "enable_material", "enable_hashagg", "enable_sort"]]) {
        await inWorld(async (tx) => {
          await drain(tx);
          const owner = await profile(tx);
          const all: string[] = [];
          for (let n = 0; n < 9; n++) {
            const p = await imagePost(tx, 4, owner.id);
            await authorDeletes(tx, p.postId);
            all.push(...p.mediaIds);
          }
          for (const setting of settings) await tx.execute(sql.raw(`set local ${setting} = off`));
          const order = sorted(all);
          expect(await casesMedia(tx).dropDisposable(tx), settings.join(", ")).toEqual(order.slice(0, 25));
          expect(await existing(tx, all)).toEqual(order.slice(25));
          expect(await casesMedia(tx).dropDisposable(tx), settings.join(", ")).toEqual(order.slice(25));
        });
      }
    }, 120_000);
  });

  describe("overdueDeletions", () => {
    test("counts the rows the disposal should have taken by now: disposable, with no hold ended and no mark set in the last day", async () => {
      await inWorld(async (tx) => {
        const media = casesMedia(tx);
        const baseline = await media.overdueDeletions();
        const owner = await profile(tx);
        const twoDays = sql`now() - interval '2 days'`;
        const anHour = sql`now() - interval '1 hour'`;
        let expected = baseline;
        const check = async (label: string, change: number) => {
          expected += change;
          expect(await media.overdueDeletions(), label).toBe(expected);
        };

        const old = await imagePost(tx, 1, owner.id);
        await authorDeletes(tx, old.postId, twoDays);
        await check("a post deleted two days ago", 1);
        const fresh = await imagePost(tx, 1, owner.id);
        await authorDeletes(tx, fresh.postId, anHour);
        await check("a post deleted an hour ago", 0);

        // A hold that ended within the last day keeps the row out of the count; one that ended before it does not.
        const heldOld = await imagePost(tx, 2, owner.id);
        const heldCase = await openCase(tx, "post", heldOld.postId);
        await authorDeletes(tx, heldOld.postId, twoDays);
        await holdRow(tx, heldOld.mediaIds[0]!, heldCase);
        await holdRow(tx, heldOld.mediaIds[1]!, heldCase);
        await check("retained by unreleased holds", 0);
        await release(tx, heldOld.mediaIds[0]!, anHour);
        await check("a hold released an hour ago", 0);
        await release(tx, heldOld.mediaIds[1]!, twoDays);
        await check("a hold released two days ago", 1);
        const lapsed = await imagePost(tx, 2, owner.id);
        const lapsedCase = await openCase(tx, "post", lapsed.postId);
        await authorDeletes(tx, lapsed.postId, twoDays);
        await holdRow(tx, lapsed.mediaIds[0]!, lapsedCase, anHour);
        await holdRow(tx, lapsed.mediaIds[1]!, lapsedCase, twoDays);
        await check("holds whose end passed an hour ago and two days ago", 1);

        // The marks of an erasure, each two days old and an hour old.
        const erased = await imagePost(tx, 2, owner.id);
        await tx.execute(sql`update post_media set erased_at = ${twoDays}, alt_text = '' where id = ${erased.mediaIds[0]!}::uuid`);
        await tx.execute(sql`update post_media set erased_at = ${anHour}, alt_text = '' where id = ${erased.mediaIds[1]!}::uuid`);
        await check("an image erased two days ago and one erased an hour ago", 1);
        const erasedPost = await imagePost(tx, 1, owner.id);
        await tx.execute(sql`update posts set erased_at = ${twoDays}, body = '' where id = ${erasedPost.postId}::uuid`);
        await check("a post erased two days ago", 1);
        const erasedLately = await imagePost(tx, 1, owner.id);
        await tx.execute(sql`update posts set erased_at = ${anHour}, body = '' where id = ${erasedLately.postId}::uuid`);
        await check("a post erased an hour ago", 0);

        // A frozen post's rows are not disposable, however long ago it was deleted.
        const frozen = await imagePost(tx, 1);
        await authorDeletes(tx, frozen.postId, twoDays);
        await check("before the report", 1);
        const frozenHandle = (await tx.execute<{ handle: string }>(sql`select handle from profiles where id = ${frozen.authorId}::uuid`))[0]!.handle;
        await report(tx, anAccount(frozen.authorId, frozenHandle), "csam");
        await check("frozen", -1);
      }, migrateDb);
    });
  });

  describe("requestDeletion", () => {
    test("asks the worker to delete the files of these images: one request file an id, and asking again is asking once", async () => {
      await withStore(async (_tx, h) => {
        const media = mediaForCases(h.deps);
        const ids = [h.newId(), h.newId()];
        await media.requestDeletion(ids);
        await media.requestDeletion([ids[0]!]);
        expect(sorted(await h.files.deletionRequests())).toEqual(sorted(ids));
      });
    });
  });

  describe("the deleters take their rows in id order", () => {
    /** A post with two images whose position order is the reverse of their id order. */
    async function reversedImages(db: Db) {
      const owner = await profile(db);
      const postId = await newPostRow(db, owner.id);
      const [low, high] = sorted([randomUUID(), randomUUID()]) as [string, string];
      // The higher id is created first and stands first on the post.
      for (const [position, id] of [high, low].entries()) {
        await db.execute(sql`insert into post_media (id, owner_id, status, width, height, blurhash, created_at) values (${id}::uuid, ${owner.id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL', now() - ${`${10 - position} minutes`}::interval)`);
        await db.execute(sql`update post_media set post_id = ${postId}::uuid, position = ${position}, alt_text = ${`image ${position + 1}`} where id = ${id}::uuid`);
      }
      return { ownerId: owner.id, postId, low, high };
    }
    /** Whether another session could lock the row now: false while a transaction that updated, deleted or locked it holds it. */
    const free = async (table: "post_media" | "posts", id: string) => (await apiDb.execute(sql`select id from ${sql.raw(table)} where id = ${id}::uuid for share skip locked`)).length === 1;

    test.each([
      ["detachAll", "where post_id = "],
      ["purgeOwner", "where owner_id = "],
    ] as const)("%s waits at the row with the lowest id and has taken no other meanwhile, though that row stands second on the post", async (method, marker) => {
      const { ownerId, postId, low, high } = await reversedImages(apiDb);
      const [held, wait] = [gate(), gate()];
      let holding: Promise<void> = Promise.resolve();
      let deleting: Promise<string[]> = Promise.resolve([]);
      try {
        // Another transaction holds the row with the lowest id, as an intake does that reaches it.
        holding = withLockTimeout(apiDb, async (tx) => {
          await tx.execute(sql`select id from post_media where id = ${low}::uuid for key share`);
          held.open();
          await wait.opened;
        });
        await Promise.race([held.opened, holding]);
        deleting = withLockTimeout(apiDb, (tx) => (method === "detachAll" ? repoOn(tx).detachAll(tx, postId) : repoOn(tx).purgeOwner(tx, ownerId)));
        await untilBlocked(apiDb, marker);
        // A delete in the order of the post's positions would have taken the higher id first and hold it now.
        expect(await free("post_media", high)).toBe(true);
        wait.open();
        await holding;
        expect(sorted(await deleting)).toEqual([low, high]);
        expect(await existing(apiDb, [low, high])).toEqual([]);
      } finally {
        wait.open();
        await Promise.allSettled([holding, deleting]);
        await removeFixtures(migrateDb, [ownerId]);
      }
    });

    test("purgeProfile takes the account's posts in id order: it waits at the post with the lowest id and has taken no other meanwhile", async () => {
      const owner = await profile(apiDb);
      // Three posts; the one with the lowest id is neither the first nor the last by creation time, nor the first stored.
      const ids = sorted([randomUUID(), randomUUID(), randomUUID()]) as [string, string, string];
      const [low, middle, high] = ids;
      for (const [id, age] of [[middle, "3 days"], [low, "2 days"], [high, "1 day"]] as const) {
        await apiDb.execute(sql`insert into posts (id, author_id, body, created_at) values (${id}::uuid, ${owner.id}::uuid, 'a post', now() - interval '30 days' - ${age}::interval)`);
      }
      const [held, wait] = [gate(), gate()];
      let holding: Promise<void> = Promise.resolve();
      let purging: Promise<void> = Promise.resolve();
      try {
        // An intake holds a post for share while it copies it, lowest id first.
        holding = withLockTimeout(apiDb, async (tx) => {
          await tx.execute(sql`select id from posts where id = ${low}::uuid for share`);
          held.open();
          await wait.opened;
        });
        await Promise.race([held.opened, holding]);
        purging = createSocialRepo(apiDb).purgeProfile(owner.id, new Date(), async () => undefined);
        await untilBlocked(apiDb, "order by id for update");
        expect([await free("posts", middle), await free("posts", high)]).toEqual([true, true]);
        wait.open();
        await holding;
        await purging;
        const states = await apiDb.execute<{ state: string }>(sql`select state from posts where id = any(${uuids(ids)})`);
        expect(states.map((row) => row.state)).toEqual(["deleted_by_author", "deleted_by_author", "deleted_by_author"]);
      } finally {
        wait.open();
        await Promise.allSettled([holding, purging]);
        await removeFixtures(migrateDb, [owner.id]);
      }
    });

    /**
     * The two shapes in which a report holds two posts of one account that the purge's counters write: a post that quotes
     * its author's own post brings the quoted post as a target the module adds, and the report copies the two in id order.
     * In the first the quoting post has the lower id and the purge's quote counter writes the other one. In the second the
     * quoted post has the lower id and its author has deleted it: the purge tombstones only the quoting post, and its
     * counter still writes the deleted one.
     */
    const SHAPES = ["the quoting post has the lower id", "the quoted post has the lower id and was deleted by its author"] as const;
    /** An account with a post that quotes its own earlier post, an image on each, committed; `first` is the post a report copies first. */
    async function selfQuote(shape: (typeof SHAPES)[number]) {
      const owner = await profile(apiDb);
      const [low, high] = sorted([randomUUID(), randomUUID()]) as [string, string];
      const [quoting, quoted] = shape === SHAPES[0] ? [low, high] : [high, low];
      await apiDb.execute(sql`insert into posts (id, author_id, body, quote_count, created_at) values (${quoted}::uuid, ${owner.id}::uuid, 'the quoted post', 1, now() - interval '31 days')`);
      await apiDb.execute(sql`insert into posts (id, author_id, body, quote_of_id, created_at) values (${quoting}::uuid, ${owner.id}::uuid, 'a post that quotes its author', ${quoted}::uuid, now() - interval '30 days')`);
      const images = [await newImageRow(apiDb, owner.id, quoting, 0), await newImageRow(apiDb, owner.id, quoted, 0)];
      // The deleted post keeps its image row here, as a hold or a freeze would have kept it.
      if (shape === SHAPES[1]) await authorDeletes(apiDb, quoted);
      return { owner, quoting, quoted, first: low, second: high, images };
    }
    const postsOf = async (ids: readonly string[]) =>
      (await apiDb.execute<{ id: string; state: string; quote_count: number }>(sql`select id, state, quote_count from posts where id = any(${uuids(ids)}) order by id`)).map((row) => ({ ...row }));

    test.each(SHAPES)("a post that quotes its author's own post, %s; the notice holding first: the purge waits at the first post having locked neither, and no deadlock follows", async (shape) => {
      const f = await selfQuote(shape);
      const [held, wait] = [gate(), gate()];
      let reporting: Promise<number> = Promise.resolve(0);
      let purging: Promise<void> = Promise.resolve();
      let answered: string[] | null = null;
      try {
        // The notice names the quoting post and the module adds the post it quotes. It copies its posts in id order and
        // is stopped here between the two, holding the first for share.
        reporting = withLockTimeout(apiDb, (tx) =>
          intakeRuns(tx, ground.csam(), [aPost(f.quoting)], async (postId) => {
            if (postId !== f.first) return;
            held.open();
            await wait.opened;
          }),
        );
        await Promise.race([held.opened, reporting]);
        purging = createSocialRepo(apiDb).purgeProfile(f.owner.id, new Date(), async (tx) => {
          answered = await repoOn(tx).purgeOwner(tx, f.owner.id);
        });
        // The purge waits in the statement that takes the account's posts in id order, before it has written anything.
        await untilBlocked(apiDb, "order by id for update");
        // It holds nothing of the second post, which the notice asks for next. A purge that had written a counter or a
        // tombstone on that post first would hold it by now, and the two would wait for each other.
        expect(await free("posts", f.second)).toBe(true);
        wait.open();
        // Counted, not just survived: the module ran the notice once, and the purge, which nothing runs again, went through.
        expect(await reporting).toBe(1);
        expect(await refusal(purging)).toBeNull();
        expect(await postsOf([f.quoting, f.quoted])).toEqual(sorted([f.quoting, f.quoted]).map((id) => ({ id, state: "deleted_by_author", quote_count: 0 })));
        // The notice came first: both posts are frozen and their images held, and the purge took neither row.
        expect(answered).toEqual([]);
        expect(await existing(apiDb, f.images)).toEqual(sorted(f.images));
      } finally {
        wait.open();
        await Promise.allSettled([reporting, purging]);
        await removeFixtures(migrateDb, [f.owner.id]);
      }
    });

    test.each(SHAPES)("the same, %s; the purge holding first: the notice waits at the first post and then copies two tombstones in one run", async (shape) => {
      const f = await selfQuote(shape);
      const [reached, wait] = [gate(), gate()];
      let purging: Promise<void> = Promise.resolve();
      let reporting: Promise<number> = Promise.resolve(0);
      let answered: string[] = [];
      try {
        // The purge is stopped in its last act, holding the account's row, both posts and the image rows it deleted.
        purging = createSocialRepo(apiDb).purgeProfile(f.owner.id, new Date(), async (tx) => {
          answered = await repoOn(tx).purgeOwner(tx, f.owner.id);
          reached.open();
          await wait.opened;
        });
        await Promise.race([reached.opened, purging]);
        // Both posts are the purge's, the deleted one too: nobody else can take either.
        expect([await free("posts", f.first), await free("posts", f.second)]).toEqual([false, false]);
        reporting = intakeRuns(apiDb, ground.csam(), [aPost(f.quoting)]);
        await untilBlocked(apiDb, "for share of p");
        wait.open();
        expect(await refusal(purging)).toBeNull();
        expect(await reporting).toBe(1);
        // The purge came first: its delete won, and the notice's snapshots are of two tombstones.
        expect(sorted(answered)).toEqual(sorted(f.images));
        expect(await existing(apiDb, f.images)).toEqual([]);
        const copied = await apiDb.execute<{ target_id: string; post_state: string; body: string }>(sql`select target_id, post_state, body from evidence_snapshots where target_id = any(${uuids([f.quoting, f.quoted])}) order by target_id`);
        expect(copied.map((row) => ({ ...row }))).toEqual(sorted([f.quoting, f.quoted]).map((id) => ({ target_id: id, post_state: "deleted_by_author", body: "" })));
      } finally {
        wait.open();
        await Promise.allSettled([purging, reporting]);
        await removeFixtures(migrateDb, [f.owner.id]);
      }
    });

    test("purgeProfile runs the media step as the last act of its transaction: the profile is anonymised and its handle reserved by then", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const other = await profile(tx);
        const otherPost = await newPostRow(tx, other.id);
        await newPostRow(tx, owner.id);
        await tx.execute(sql`insert into likes (user_id, post_id) values (${owner.id}::uuid, ${otherPost}::uuid)`);
        await tx.execute(sql`insert into follows (follower_id, followee_id) values (${owner.id}::uuid, ${other.id}::uuid)`);
        let seen: Record<string, unknown> | undefined;
        await createSocialRepo(tx as unknown as Db).purgeProfile(owner.id, new Date(), async (within) => {
          [seen] = await within.execute<Record<string, unknown>>(sql`
            select (select deleted_at is not null from profiles where id = ${owner.id}::uuid) as anonymised,
                   (select display_name from profiles where id = ${owner.id}::uuid) as name,
                   (select count(*)::int from posts where author_id = ${owner.id}::uuid and state <> 'deleted_by_author') as live_posts,
                   (select count(*)::int from likes where user_id = ${owner.id}::uuid) as likes,
                   (select count(*)::int from follows where follower_id = ${owner.id}::uuid) as follows,
                   (select count(*)::int from handle_history where profile_id = ${owner.id}::uuid) as reserved`);
        });
        expect(seen).toEqual({ anonymised: true, name: "Deleted account", live_posts: 0, likes: 0, follows: 0, reserved: 1 });
      });
    });
  });

  describe("an intake that locks an account's images, racing the purge's ordered delete", () => {
    /** An account with two image posts and an upload on no post, committed. */
    async function account() {
      const owner = await profile(apiDb);
      const first = await imagePost(apiDb, 2, owner.id);
      const second = await imagePost(apiDb, 2, owner.id);
      const upload = await newImageRow(apiDb, owner.id, null);
      return { owner, attached: [...first.mediaIds, ...second.mediaIds], postIds: [first.postId, second.postId], upload };
    }

    test("the intake locks first: the purge waits, then keeps every attached row and takes only the upload on no post", async () => {
      const { owner, attached, upload } = await account();
      const [locked, wait] = [gate(), gate()];
      let reporting: Promise<void> = Promise.resolve();
      let purging: Promise<string[]> = Promise.resolve([]);
      try {
        // The module's own transaction is a savepoint of this one, which commits when the test lets it.
        reporting = withLockTimeout(apiDb, async (tx) => {
          await intake(tx, ground.csam(), anAccount(owner.id, owner.handle));
          locked.open();
          await wait.opened;
        });
        await Promise.race([locked.opened, reporting]);
        purging = withLockTimeout(apiDb, (tx) => repoOn(tx).purgeOwner(tx, owner.id));
        await untilBlocked(apiDb, "where owner_id = ");
        wait.open();
        await reporting;
        // The keep trigger read the freeze after the wait, in a statement of its own: it saw the committed item.
        expect(await purging).toEqual([upload]);
        expect(await existing(apiDb, attached)).toEqual(sorted(attached));
        expect(await holdsOf(apiDb, attached)).toEqual([]);
      } finally {
        wait.open();
        await Promise.allSettled([reporting, purging]);
        await removeFixtures(migrateDb, [owner.id]);
      }
    });

    test("the purge locks first: the intake waits, then locks nothing and is stored without an error; no attached row is kept", async () => {
      const { owner, attached, postIds, upload } = await account();
      const [deleted, wait] = [gate(), gate()];
      let purging: Promise<string[]> = Promise.resolve([]);
      let reporting: Promise<unknown> = Promise.resolve();
      try {
        purging = withLockTimeout(apiDb, async (tx) => {
          const ids = await repoOn(tx).purgeOwner(tx, owner.id);
          deleted.open();
          await wait.opened;
          return ids;
        });
        await Promise.race([deleted.opened, purging]);
        reporting = withLockTimeout(apiDb, (tx) => intake(tx, ground.csam(), anAccount(owner.id, owner.handle)));
        await untilBlocked(apiDb, "for key share of m");
        wait.open();
        expect(sorted(await purging)).toEqual(sorted([...attached, upload]));
        // The report came too late for these images, as it would have a moment later.
        expect(await refusal(reporting)).toBeNull();
        expect(await existing(apiDb, attached)).toEqual([]);
        expect(await postFrozen(apiDb, postIds[0]!)).toBe(true);
      } finally {
        wait.open();
        await Promise.allSettled([purging, reporting]);
        await removeFixtures(migrateDb, [owner.id]);
      }
    });

    test("the order of cases: two notices that name the same two image posts in opposite orders, at once, each land in one run, queued at their first case", async () => {
      // This says nothing about the order of image locks: every intake takes its cases in the targets' order, so the two
      // meet at the first case and the second waits there until the first has committed, its holds included. What it
      // holds is that naming the targets in another order changes nothing, and that no deadlock was absorbed on the way:
      // the module would run a deadlocked intake again, so its runs are counted.
      const owner = await profile(apiDb);
      const [a, b] = [await imagePost(apiDb, 4, owner.id), await imagePost(apiDb, 4, owner.id)];
      try {
        for (let round = 0; round < 6; round++) {
          const runs = await Promise.all([
            intakeRuns(apiDb, ground.illegal(null), [aPost(a.postId, 1), aPost(b.postId, 2)]),
            intakeRuns(apiDb, ground.illegal(null), [aPost(b.postId, 1), aPost(a.postId, 2)]),
          ]);
          expect(runs, `round ${round}`).toEqual([1, 1]);
        }
        // One hold an image from each post's case, however many notices joined it.
        expect(await holdsOf(apiDb, [...a.mediaIds, ...b.mediaIds])).toHaveLength(8);
      } finally {
        await removeFixtures(migrateDb, [owner.id]);
      }
    });
  });

  describe("hold racing dropDisposable on a deleted post's images whose hold has just ended", () => {
    /** A deleted post with two images that nothing retains any more, committed, with an open case that reaches it. */
    async function disposablePost() {
      // Rows other suites left disposable go first, in a transaction that commits: the race below must meet only its own.
      await withLockTimeout(apiDb, (tx) => drain(tx));
      const p = await imagePost(apiDb, 2);
      const caseId = await openCase(apiDb, "post", p.postId);
      await authorDeletes(apiDb, p.postId);
      return { ...p, caseId };
    }

    test("the hold locks first: the disposal waits, finds the rows held and skips them", async () => {
      const p = await disposablePost();
      const [locked, wait] = [gate(), gate()];
      let holding: Promise<void> = Promise.resolve();
      let dropping: Promise<string[]> = Promise.resolve([]);
      try {
        holding = withLockTimeout(apiDb, async (tx) => {
          const held = await casesMedia(tx).hold(tx, [{ caseId: p.caseId, postId: p.postId }]);
          expect(held.get(p.postId)!.map((image) => image.id)).toEqual(p.mediaIds);
          locked.open();
          await wait.opened;
        });
        await Promise.race([locked.opened, holding]);
        dropping = withLockTimeout(apiDb, (tx) => casesMedia(tx).dropDisposable(tx));
        await untilBlocked(apiDb, "delete from post_media where id in");
        wait.open();
        await holding;
        expect(await dropping).toEqual([]);
        expect(await existing(apiDb, p.mediaIds)).toEqual(sorted(p.mediaIds));
        expect(await holdsOf(apiDb, p.mediaIds)).toHaveLength(2);
      } finally {
        wait.open();
        await Promise.allSettled([holding, dropping]);
        await removeFixtures(migrateDb, [p.authorId]);
      }
    });

    test("the disposal deletes first: the hold waits, then skips the deleted rows: no foreign-key error, no hold, an empty answer", async () => {
      const p = await disposablePost();
      const [deleted, wait] = [gate(), gate()];
      let dropping: Promise<string[]> = Promise.resolve([]);
      let holding: Promise<Map<string, unknown[]>> = Promise.resolve(new Map());
      try {
        dropping = withLockTimeout(apiDb, async (tx) => {
          const ids = await casesMedia(tx).dropDisposable(tx);
          deleted.open();
          await wait.opened;
          return ids;
        });
        await Promise.race([deleted.opened, dropping]);
        holding = withLockTimeout(apiDb, (tx) => casesMedia(tx).hold(tx, [{ caseId: p.caseId, postId: p.postId }]));
        await untilBlocked(apiDb, "for key share of m");
        wait.open();
        expect(await dropping).toEqual(sorted(p.mediaIds));
        // An empty answer means the images are gone.
        expect([...(await holding).entries()]).toEqual([[p.postId, []]]);
        expect(await holdsOf(apiDb, p.mediaIds)).toEqual([]);
      } finally {
        wait.open();
        await Promise.allSettled([dropping, holding]);
        await removeFixtures(migrateDb, [p.authorId]);
      }
    });

    test("a report of child sexual abuse material about the account that commits while the disposal waits for its row locks: the candidates were chosen before it, and the keep trigger keeps them", async () => {
      const p = await disposablePost();
      const handle = (await apiDb.execute<{ handle: string }>(sql`select handle from profiles where id = ${p.authorId}::uuid`))[0]!.handle;
      const [locked, wait] = [gate(), gate()];
      let reporting: Promise<void> = Promise.resolve();
      let dropping: Promise<string[]> = Promise.resolve([]);
      try {
        reporting = withLockTimeout(apiDb, async (tx) => {
          await intake(tx, ground.csam(), anAccount(p.authorId, handle));
          locked.open();
          await wait.opened;
        });
        await Promise.race([locked.opened, reporting]);
        // Uncommitted, the item freezes nothing for the disposal's statement: both rows are its candidates.
        dropping = withLockTimeout(apiDb, (tx) => casesMedia(tx).dropDisposable(tx));
        await untilBlocked(apiDb, "delete from post_media where id in");
        wait.open();
        await reporting;
        expect(await dropping).toEqual([]);
        expect(await existing(apiDb, p.mediaIds)).toEqual(sorted(p.mediaIds));
      } finally {
        wait.open();
        await Promise.allSettled([reporting, dropping]);
        await removeFixtures(migrateDb, [p.authorId]);
      }
    });
  });

  test("this file left no moderation row behind: the moderation tables hold what they held before it", async () => {
    expect(await moderationCounts(apiDb)).toEqual(before);
  });
});
```

### Create `apps/api/test/integration/media-gates.test.ts`

```ts
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { PostView, mediaPath, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { purge } from "../../src/account/flows/deletion";
import { buildExport, writeExport } from "../../src/account/flows/export";
import { purgePending } from "../../src/account/purge";
import { createZipWriter } from "../../src/account/zip";
import type { AccountExport } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForAccount, mediaForCases, type MediaForCases, type MediaForPosts } from "../../src/media";
import { serve } from "../../src/media/flows/serve";
import { status } from "../../src/media/flows/status";
import { createMediaRepo, type MediaRepo } from "../../src/media/repo";
import { sweep } from "../../src/media/sweeper";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { explorePage } from "../../src/social/flows/explore";
import { exportProfile } from "../../src/social/flows/export";
import { deletePost, getPost, thread } from "../../src/social/flows/posts";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "../../src/social/flows/timelines";
import { webpBytes } from "../media/webp-bytes";
import { DAY, HOUR, accounts, before as earlier, likedBy, rank } from "./explore-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import {
  aPost,
  act,
  anAccount,
  decideIn,
  insertItem,
  moderationCounts,
  newImageRow,
  newPostRow,
  newTestStaff,
  openCase,
  postFrozen,
  report,
  staffProfile,
  suspectItemOn,
  uuids,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newPost, newProfile } from "./social-fixtures";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";
import { rolledBack } from "./staff-fixtures";

// Each test builds a store directory, uploads its images and runs dozens of statements inside one open transaction: on
// a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };

/**
 * Every method of the media repository, in one record (3c design, section 12). A method that deletes image rows is run
 * against a frozen post below; a method that gives an image, or what an image is, to someone is run against sealed
 * images; and a method that does neither says why. The record is typed over the repository's methods and compared with
 * them at run time, so a method added to createMediaRepo fails this file until whoever adds it has said which it is,
 * and a new deleter or reader fails it until it has a run of its own.
 */
type Role = { is: "deleter" } | { is: "reader" } | { is: "neither"; why: string };
const METHODS: Record<keyof MediaRepo, Role> = {
  accountCreatedAt: { is: "neither", why: "reads when an account was onboarded, and no image row" },
  pendingCount: { is: "neither", why: "counts an account's uploads that are on no post" },
  insertProcessing: { is: "neither", why: "inserts an upload on no post" },
  find: { is: "reader" },
  finalize: { is: "neither", why: "records the worker's verdict on an upload that is still processing" },
  deleteUnattached: { is: "deleter" },
  fileAccess: { is: "reader" },
  attach: { is: "neither", why: "puts its author's own upload on a new post" },
  detachAll: { is: "deleter" },
  purgeOwner: { is: "deleter" },
  forPosts: { is: "reader" },
  readyImages: { is: "reader" },
  isExportable: { is: "reader" },
  processingIds: { is: "neither", why: "lists uploads that are still processing, which are on no post" },
  failStale: { is: "neither", why: "fails uploads that are still processing, which are on no post" },
  deleteUnattachedBefore: { is: "deleter" },
  existing: { is: "neither", why: "says which ids have a row, to the reconcile pass, and must see every row" },
  deleteRow: { is: "deleter" },
  hold: { is: "neither", why: "locks image rows and places holds; what it answers is text and sizes for a case's snapshot" },
  reach: { is: "neither", why: "answers counts, a day and a time, never an id or anything of an image" },
  staffAccess: { is: "reader" },
  dropDisposable: { is: "deleter" },
  overdueDeletions: { is: "neither", why: "answers how many rows the disposal should have taken by now" },
};
const methodsThatAre = (role: Role["is"]) => (Object.keys(METHODS) as (keyof MediaRepo)[]).filter((name) => METHODS[name].is === role).sort();

/** What a deleter is run on: the repository on the test's transaction, and the frozen post with its author and images. */
interface Frozen {
  repo: MediaRepo;
  tx: DbTx;
  ownerId: string;
  postId: string;
  mediaIds: string[];
}

/** Each deleter run as hard as it can be against the post's images; it answers the ids it says are gone. */
const DELETERS = {
  deleteUnattached: async (f: Frozen) => {
    const gone: string[] = [];
    for (const id of f.mediaIds) if (await f.repo.deleteUnattached(id, f.ownerId)) gone.push(id);
    return gone;
  },
  detachAll: (f: Frozen) => f.repo.detachAll(f.tx, f.postId),
  purgeOwner: (f: Frozen) => f.repo.purgeOwner(f.tx, f.ownerId),
  // Every upload on no post that is older than tomorrow: every one there is.
  deleteUnattachedBefore: (f: Frozen) => f.repo.deleteUnattachedBefore(new Date(Date.now() + DAY)),
  deleteRow: async (f: Frozen) => {
    for (const id of f.mediaIds) await f.repo.deleteRow(id);
    return [] as string[];
  },
  // Batch after batch until one is not full: everything that is disposable now.
  dropDisposable: async (f: Frozen) => {
    const gone: string[] = [];
    for (;;) {
      const batch = await f.repo.dropDisposable(f.tx, 500);
      gone.push(...batch);
      if (batch.length < 500) return gone;
    }
  },
} satisfies Partial<Record<keyof MediaRepo, (f: Frozen) => Promise<string[]>>>;

/** What every test here works in: a transaction that is rolled back, the media module with a store of its own on it, and the social module's flows over both. */
interface World {
  tx: DbTx;
  h: MediaHarness;
  s: SocialHarness;
  repo: MediaRepo;
  cases: MediaForCases;
}

describe.skipIf(!process.env.INTEGRATION)("integration: every deleter and every reader of images, by enumeration", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  let counts: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    counts = await moderationCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const inWorld = (fn: (w: World) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      const h = await mediaHarness(tx as unknown as Db);
      // The media module's interface for posts, as createMedia hands it out.
      const forPosts: MediaForPosts = {
        attach: (within, input) => h.deps.repo.attach(within, input),
        detachAll: (within, postId) => h.deps.repo.detachAll(within, postId),
        requestDeletion: (ids) => h.files.requestDeletion(ids),
        forPosts: (postIds) => h.deps.repo.forPosts(postIds),
      };
      try {
        await fn({ tx, h, s: socialHarness(tx as unknown as Db, { media: forPosts }), repo: h.deps.repo, cases: mediaForCases(h.deps) });
      } finally {
        h.cleanup();
      }
    });

  const sorted = (ids: readonly string[]) => [...ids].sort();
  const page = { limit: 50 };
  /** An image as a reader who is shown it gets it: with its blurhash and both paths. */
  const whole = (id: string) => expect.objectContaining({ id, blurhash: "L2Eo_P_3jb_3~qoL", small: mediaPath(id, "small"), large: mediaPath(id, "large") });
  async function existing(tx: DbTx, ids: readonly string[]): Promise<string[]> {
    const rows = await tx.execute<{ id: string }>(sql`select id from post_media where id = any(${uuids(ids)}) order by id`);
    return rows.map((row) => row.id);
  }
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
  /** What serve answers for the large file, with the file it opened closed again. */
  async function ask(w: World, id: string, viewer: string | null, ifNoneMatch?: string) {
    const served = await serve(w.h.deps, { id, size: "large", ifNoneMatch, viewer: async () => viewer });
    if (served.kind === "file") await served.file.handle.close();
    return served.kind === "not_found" ? { kind: served.kind } : { kind: served.kind, cacheControl: served.cacheControl };
  }
  /** Whether the one function that opens an image for staff opens this one. */
  async function staffOpens(w: World, id: string): Promise<boolean> {
    const got = await w.cases.staffImage(id, "large");
    await got?.file.handle.close();
    return got !== null;
  }
  /** The account module's dependencies over this world: the real purge of profiles and images and the real export, with the auth module stood in for. */
  function accountDeps(w: World, pending: string[] = []): AccountDeps & { finished: string[] } {
    const finished: string[] = [];
    const notHere = async (): Promise<never> => {
      throw new Error("not exercised here");
    };
    const exported = (id: string): AccountExport => ({
      account: { id, email: "owner@korbat.local", createdAt: new Date(), role: "user", mfaEnabled: false, hasPassword: false, verified: false, termsVersion: null, termsAcceptedAt: null },
      passkeys: [],
      sessions: [],
      devices: [],
      events: [],
    });
    return {
      finished,
      auth: {
        startDeletion: notHere,
        confirmDeletion: notHere,
        pendingPurges: async () => pending,
        finishPurge: async (userId) => void finished.push(userId),
        exportAccount: async (userId) => exported(userId),
        appendEvent: async () => undefined,
      },
      social: { purgeProfile: (userId, now, within) => w.s.repo.purgeProfile(userId, now, within), exportProfile: (userId, pageSize) => exportProfile(w.s.deps, userId, pageSize) },
      media: mediaForAccount(w.h.deps),
      limits: new MemoryStore(),
      log: pino({ level: "silent" }),
      now: () => new Date(),
    };
  }
  /** The account's whole export as its archive holds it: the entries' names, and export.json. */
  async function exportOf(w: World, userId: string) {
    const plan = await buildExport(accountDeps(w), userId, "the-asking-session", new Date());
    const chunks: Uint8Array[] = [];
    await writeExport(createZipWriter(async (chunk) => void chunks.push(Uint8Array.from(chunk))), plan);
    const files = unzipSync(Buffer.concat(chunks));
    const json = JSON.parse(strFromU8(files["export.json"]!)) as { posts: { id: string; body: string; state: string; media: { id: string; file: string; altText: string }[] }[]; missingMedia: string[] };
    return { entries: Object.keys(files).sort(), json };
  }

  describe("the record over the repository's methods", () => {
    test("names every method createMediaRepo has, and no other", () => {
      expect(Object.keys(createMediaRepo(apiDb)).sort()).toEqual(Object.keys(METHODS).sort());
    });

    test("every deleter has a run against a frozen post, and every method that does neither says why", () => {
      expect(Object.keys(DELETERS).sort()).toEqual(methodsThatAre("deleter"));
      expect(methodsThatAre("deleter")).toEqual(["deleteRow", "deleteUnattached", "deleteUnattachedBefore", "detachAll", "dropDisposable", "purgeOwner"]);
      // The readers are run through what calls them: serve (fileAccess), the lists (forPosts), the export's files
      // (readyImages and isExportable), the status (find) and the staff's image (staffAccess).
      expect(methodsThatAre("reader")).toEqual(["fileAccess", "find", "forPosts", "isExportable", "readyImages", "staffAccess"]);
      for (const name of methodsThatAre("neither")) {
        const role = METHODS[name];
        expect(role.is === "neither" && role.why.length > 20, `${name}: ${role.is === "neither" ? role.why : ""}`).toBe(true);
      }
    });
  });

  describe("gate K: every deleter against a frozen post", () => {
    /** Each way a post comes to be frozen, with nothing else that would keep its rows: no hold stands on them. */
    const FREEZES: Record<string, (w: World, post: { postId: string; ownerId: string; handle: string }) => Promise<void>> = {
      "its own item": async (w, post) => {
        await suspectItemOn(w.tx, "post", post.postId);
      },
      "its author's account's item": async (w, post) => {
        await suspectItemOn(w.tx, "account", post.ownerId);
      },
      "an item korbat added for a post that quotes it": async (w, post) => {
        const quoting = await newPostRow(w.tx, (await newProfile(w.tx as unknown as Db)).id, { quoteOfId: post.postId });
        const named = await suspectItemOn(w.tx, "post", quoting);
        await insertItem(w.tx, { intakeId: named.intakeId, caseId: await openCase(w.tx, "post", post.postId), targetId: post.postId, position: 11, lane: 0 });
      },
      "a seal taken while deciding": async (w, post) => {
        const { caseId } = await report(w.tx, anAccount(post.ownerId, post.handle), "csam");
        await decideIn(w.tx, mod, caseId, SEAL_WHILE_DECIDING);
      },
      "a seal for good, whose case is closed": async (w, post) => {
        const { caseId } = await report(w.tx, anAccount(post.ownerId, post.handle), "csam");
        await decideIn(w.tx, admin, caseId, SEAL_FOR_GOOD);
      },
    };

    test.each(Object.keys(FREEZES))("frozen through %s: each deleter leaves the rows, answers no id of them and no file of them is requested, before and after the author deleted the post", async (freeze) => {
      await inWorld(async (w) => {
        const ada = await w.h.established();
        const p = await w.h.postWithImages(ada.id, 2);
        const upload = await w.h.readyImage(ada.id);
        await FREEZES[freeze]!(w, { postId: p.postId, ownerId: ada.id, handle: ada.handle });
        expect(await postFrozen(w.tx, p.postId)).toBe(true);
        // No hold stands on the rows: what keeps them is the freeze.
        expect(await w.tx.execute(sql`select 1 from media_holds where media_id = any(${uuids(p.mediaIds)})`)).toHaveLength(0);

        const frozen: Frozen = { repo: w.repo, tx: w.tx, ownerId: ada.id, postId: p.postId, mediaIds: p.mediaIds };
        for (const when of ["as posted", "deleted by its author"]) {
          if (when === "deleted by its author") await authorDeletes(w.tx, p.postId);
          for (const [name, run] of Object.entries(DELETERS)) {
            const answered = await run(frozen);
            expect(answered.filter((id) => p.mediaIds.includes(id)), `${name}, ${when}`).toEqual([]);
            expect(await existing(w.tx, p.mediaIds), `${name}, ${when}`).toEqual(sorted(p.mediaIds));
          }
        }
        // The account's upload on no post is reached by no case: the owner's purge took it.
        expect(await existing(w.tx, [upload])).toEqual([]);
        expect((await w.h.files.deletionRequests()).filter((id) => p.mediaIds.includes(id))).toEqual([]);
      });
    });

    test("once nothing freezes the post any more, the same deleters take its rows", async () => {
      await inWorld(async (w) => {
        const ada = await w.h.established();
        const p = await w.h.postWithImages(ada.id, 2);
        const { caseId } = await report(w.tx, anAccount(ada.id, ada.handle), "csam");
        expect(await w.repo.detachAll(w.tx, p.postId)).toEqual([]);
        await decideIn(w.tx, admin, caseId, { kind: "final", outcome: "no_violation" });
        expect(sorted(await w.repo.detachAll(w.tx, p.postId))).toEqual(sorted(p.mediaIds));
      });
    });

    test("a hold that is released on a frozen post's image frees nothing: the freeze keeps the row whether a hold stands or not", async () => {
      await inWorld(async (w) => {
        const ada = await w.h.established();
        const p = await w.h.postWithImages(ada.id, 1);
        // A report about the post itself places its case's hold and freezes the post.
        await report(w.tx, aPost(p.postId), "csam");
        await w.tx.execute(sql`update media_holds set released_at = now() where media_id = ${p.mediaIds[0]!}::uuid`);
        const [row] = await w.tx.execute<{ held: boolean }>(sql`select hold_until is not null as held from post_media where id = ${p.mediaIds[0]!}::uuid`);
        expect(row).toEqual({ held: false });
        await authorDeletes(w.tx, p.postId);
        for (const [name, run] of Object.entries(DELETERS)) {
          await run({ repo: w.repo, tx: w.tx, ownerId: ada.id, postId: p.postId, mediaIds: p.mediaIds });
          expect(await existing(w.tx, p.mediaIds), name).toEqual(p.mediaIds);
        }
      }, migrateDb);
    });
  });

  describe("gate K through the flows: the author's deletion, the purge, the sweeper and the reconcile pass", () => {
    /** Each kind of reach through a real report of child sexual abuse material; it answers nothing, the post is frozen. */
    const REPORTS: Record<string, (w: World, post: { postId: string; ownerId: string; handle: string }) => Promise<unknown>> = {
      "its own item": (w, post) => report(w.tx, aPost(post.postId), "csam"),
      "its author's account's item": (w, post) => report(w.tx, anAccount(post.ownerId, post.handle), "csam"),
      "an item korbat added for a post that quotes it": async (w, post) => report(w.tx, aPost(await newPostRow(w.tx, (await newProfile(w.tx as unknown as Db)).id, { quoteOfId: post.postId })), "csam"),
    };

    test.each(Object.keys(REPORTS))("a post frozen through %s: its rows outlive every flow that deletes, no file of them is requested, and no reader shows them once the post is deleted", async (kind) => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const frozen = await w.h.postWithImages(ada.id, 2);
        const free = await w.h.postWithImages(ada.id, 1);
        const upload = await w.h.readyImage(ada.id);
        await REPORTS[kind]!(w, { postId: frozen.postId, ownerId: ada.id, handle: ada.handle });
        // A case about the account reaches every post of the account, so there the other post's image is kept too.
        const kept = kind === "its author's account's item" ? [...frozen.mediaIds, ...free.mediaIds] : frozen.mediaIds;
        const requested = async () => (await w.h.files.deletionRequests()).filter((id) => kept.includes(id));

        // The author deletes the post, through the flow: the post is a tombstone, and its image rows stay.
        await deletePost(w.s.deps, ada.id, frozen.postId);
        expect(await rejection(getPost(w.s.deps, ada.id, frozen.postId))).toBe("not_found");
        expect(await existing(w.tx, frozen.mediaIds)).toEqual(sorted(frozen.mediaIds));
        expect(await requested()).toEqual([]);

        // No reader shows a kept image of a deleted post, to its owner either, so the freeze tells the author nothing.
        for (const id of frozen.mediaIds) {
          for (const viewer of [ada.id, null]) expect((await ask(w, id, viewer)).kind, `serve ${String(viewer)}`).toBe("not_found");
          expect(await w.repo.find(id)).toBeNull();
          expect(await rejection(status(w.h.deps, ada.id, id))).toBe("not_found");
          expect(await w.repo.isExportable(ada.id, id)).toBe(false);
        }
        expect((await w.repo.forPosts([frozen.postId])).size).toBe(0);
        expect(await w.repo.readyImages(ada.id)).toEqual([...free.mediaIds, upload]);
        // The reconcile pass asks which ids have a row: the kept rows are seen, so their files are no orphans.
        expect(await w.repo.existing(frozen.mediaIds)).toEqual(new Set(frozen.mediaIds));

        // The export names no image under the deleted post, holds no file of it, and lists none as missing.
        const { entries, json } = await exportOf(w, ada.id);
        expect(entries).toEqual(["export.json", `media/${free.mediaIds[0]}.webp`, `media/${upload}.webp`].sort());
        expect(json.posts.find((post) => post.id === frozen.postId)).toMatchObject({ state: "deleted_by_author", body: "", media: [] });
        expect(json.posts.find((post) => post.id === free.postId)!.media.map((image) => image.id)).toEqual(free.mediaIds);
        expect(json.missingMedia).toEqual([]);

        // The sweeper two days on, with its reconcile pass: every stored file is old by then, and none of the kept rows'
        // files is taken for an orphan.
        await sweep(w.h.deps, new Date(Date.now() + 2 * DAY), { reconcile: true });
        expect(await existing(w.tx, frozen.mediaIds)).toEqual(sorted(frozen.mediaIds));
        expect(await requested()).toEqual([]);

        // The account is purged, by the request and then again by the job: the kept rows stay, unserved, and only the
        // files of the rows that went are requested.
        const deps = accountDeps(w, [ada.id]);
        await purge(deps, ada.id);
        expect(await purgePending(deps)).toEqual({ purged: 1, failed: 0 });
        expect(deps.finished).toEqual([ada.id, ada.id]);
        expect(await existing(w.tx, [...frozen.mediaIds, ...free.mediaIds, upload])).toEqual(sorted(kept));
        expect(await requested()).toEqual([]);
        expect(await w.h.files.deletionRequests()).toEqual(expect.arrayContaining([...free.mediaIds, upload].filter((id) => !kept.includes(id))));
        for (const id of frozen.mediaIds) expect((await ask(w, id, ada.id)).kind).toBe("not_found");
        expect(await postFrozen(w.tx, frozen.postId)).toBe(true);
      });
    });

    test("a deleted post whose images a case holds, with no freeze: the same for every reader and for the export", async () => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const held = await w.h.postWithImages(ada.id, 2);
        const free = await w.h.postWithImages(ada.id, 1);
        // A report under a rule: its case holds the post's images as evidence.
        await report(w.tx, aPost(held.postId), "rule");
        expect(await postFrozen(w.tx, held.postId)).toBe(false);
        await deletePost(w.s.deps, ada.id, held.postId);
        expect(await existing(w.tx, held.mediaIds)).toEqual(sorted(held.mediaIds));
        expect((await w.h.files.deletionRequests()).filter((id) => held.mediaIds.includes(id))).toEqual([]);
        for (const id of held.mediaIds) {
          expect((await ask(w, id, ada.id)).kind).toBe("not_found");
          expect(await rejection(status(w.h.deps, ada.id, id))).toBe("not_found");
        }
        const { entries, json } = await exportOf(w, ada.id);
        expect(entries).toEqual(["export.json", `media/${free.mediaIds[0]}.webp`].sort());
        expect(json.posts.find((post) => post.id === held.postId)).toMatchObject({ state: "deleted_by_author", media: [] });
        expect(json.missingMedia).toEqual([]);
        // The sweeper's reconcile pass leaves the retained rows' files alone.
        await sweep(w.h.deps, new Date(Date.now() + 2 * DAY), { reconcile: true });
        expect((await w.h.files.deletionRequests()).filter((id) => held.mediaIds.includes(id))).toEqual([]);
        expect(await existing(w.tx, held.mediaIds)).toEqual(sorted(held.mediaIds));
      });
    });
  });

  describe("gates S and V: every reader, for a frozen post and for sealed images", () => {
    /** An author with an image post, a reply of their own with an image and a post Explore ranks, and a reader who follows them. */
    async function scene(w: World) {
      // Explore ranks as of a past this file has to itself, so no other suite's post is in the ranking read below.
      const asOf = new Date(Date.UTC(2019, 0, 10, 12));
      const [author, other, ...fans] = await accounts(w.tx as unknown as Db, asOf, 5);
      const top = await w.h.postWithImages(author!.id, 2);
      const strangerReply = await newPost(w.s.repo, other!.id, w.s.clock.next(), "a reply by someone else", { replyToId: top.postId });
      const reply = await newPost(w.s.repo, author!.id, w.s.clock.next(), "a reply with an image", { replyToId: top.postId });
      const replyImage = await w.h.readyImage(author!.id);
      await w.tx.execute(sql`update post_media set post_id = ${reply}::uuid, position = 0, alt_text = 'a reply image' where id = ${replyImage}::uuid`);
      const quoting = await newPost(w.s.repo, other!.id, w.s.clock.next(), "look at this", { quoteOfId: top.postId });
      const ranked = await newPostRow(w.tx, author!.id, { createdAt: sql`${earlier(asOf, 2 * HOUR).toISOString()}::timestamptz` });
      const rankedImage = await newImageRow(w.tx, author!.id, ranked, 0);
      await likedBy(w.s.repo, ranked, fans as { id: string }[], earlier(asOf, HOUR));
      // A round writes nothing while a ranking as new as its own time exists, and other suites leave theirs behind:
      // inside this transaction, which is rolled back, there is none.
      await w.tx.execute(sql`delete from explore_runs`);
      await rank(w.s.repo, asOf);
      for (const reader of [author!, other!]) {
        expect(await w.s.repo.like(reader.id, top.postId, w.s.clock.next())).toBe(true);
        expect(await w.s.repo.bookmark(reader.id, top.postId, w.s.clock.next())).toBe(true);
      }
      expect(await w.s.repo.follow(other!.id, author!.id, w.s.clock.next())).toBe(true);
      return { author: author!, other: other!, top, strangerReply, reply, replyImage, quoting, ranked, rankedImage };
    }
    type Scene = Awaited<ReturnType<typeof scene>>;
    type Listed = (MediaView | HiddenMedia)[] | undefined;

    /**
     * Every list a post's images are read through, each as the viewer gets it: the images of the named post in that list.
     * `signedIn` marks the lists only an account has; Following is read by the one who follows the author.
     */
    function lists(w: World, f: Scene): { name: string; images: string[]; signedIn?: boolean; onlyFor?: string; read: (viewer: string | null) => Promise<Listed> }[] {
      const top = [...f.top.mediaIds];
      const inItems = (items: { post: PostView }[], id: string) => items.find((item) => item.post.id === id)?.post.media;
      const inPosts = (items: PostView[], id: string) => items.find((post) => post.id === id)?.media;
      return [
        { name: "the single post", images: top, read: async (v) => (await getPost(w.s.deps, v, f.top.postId)).media },
        { name: "a thread's own post", images: top, read: async (v) => (await thread(w.s.deps, v, f.top.postId, page)).post.media },
        { name: "a thread's ancestor", images: top, read: async (v) => inPosts((await thread(w.s.deps, v, f.strangerReply, page)).ancestors as PostView[], f.top.postId) },
        { name: "a thread's reply", images: [f.replyImage], read: async (v) => inPosts((await thread(w.s.deps, v, f.top.postId, page)).replies.items, f.reply) },
        { name: "the Latest timeline", images: top, read: async (v) => inItems((await latestTimeline(w.s.deps, v, page)).items, f.top.postId) },
        { name: "the Following timeline", images: top, signedIn: true, onlyFor: f.other.id, read: async (v) => inItems((await followingTimeline(w.s.deps, v!, page)).items, f.top.postId) },
        { name: "Explore", images: [f.rankedImage], read: async (v) => inItems((await explorePage(w.s.deps, v, page)).items, f.ranked) },
        { name: "the profile's posts", images: top, read: async (v) => inItems((await profilePosts(w.s.deps, v, f.author.handle, page)).items, f.top.postId) },
        { name: "the profile's replies", images: [f.replyImage], read: async (v) => inPosts((await profileReplies(w.s.deps, v, f.author.handle, page)).items, f.reply) },
        { name: "likes", images: top, signedIn: true, read: async (v) => inPosts((await likedPosts(w.s.deps, v!, page)).items, f.top.postId) },
        { name: "bookmarks", images: top, signedIn: true, read: async (v) => inPosts((await bookmarkedPosts(w.s.deps, v!, page)).items, f.top.postId) },
        { name: "a quote embed", images: top, read: async (v) => { const quote = (await getPost(w.s.deps, v, f.quoting)).quoteOf; return quote && "media" in quote ? quote.media : undefined; } },
      ];
    }
    /** Runs every list for every viewer it has, and hands each answer to `check`. */
    async function everyList(w: World, f: Scene, check: (answer: Listed, images: string[], viewer: string | null, label: string) => void) {
      for (const list of lists(w, f)) {
        for (const viewer of [f.author.id, f.other.id, null]) {
          if (viewer === null && list.signedIn) continue;
          if (list.onlyFor && viewer !== list.onlyFor) continue;
          check(await list.read(viewer), list.images, viewer, `${list.name}, read by ${viewer === f.author.id ? "the author" : viewer === null ? "nobody signed in" : "another account"}`);
        }
      }
    }
    test("a frozen post whose images are not sealed: staff are refused, and every other reader is unchanged", async () => {
      await inWorld(async (w) => {
        const f = await scene(w);
        await report(w.tx, anAccount(f.author.id, f.author.handle), "csam");
        expect(await postFrozen(w.tx, f.top.postId)).toBe(true);

        let read = 0;
        await everyList(w, f, (answer, images, _viewer, label) => {
          read++;
          expect(answer, label).toEqual(images.map(whole));
          expect(answer!.some((image) => "hidden" in image), label).toBe(false);
        });
        // Twelve lists: nine for every reader, likes and bookmarks for the two accounts, Following for the one who follows.
        expect(read).toBe(9 * 3 + 2 * 2 + 1);
        for (const id of f.top.mediaIds) {
          for (const viewer of [f.author.id, f.other.id, null]) expect(await ask(w, id, viewer), String(viewer)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });
          expect(await status(w.h.deps, f.author.id, id)).toMatchObject({ status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
          expect(await w.repo.isExportable(f.author.id, id)).toBe(true);
        }
        expect(await w.repo.readyImages(f.author.id)).toEqual(expect.arrayContaining([...f.top.mediaIds, f.replyImage, f.rankedImage]));
        // Gate V: nobody at korbat opens an image of a frozen post, though everyone else is still served it.
        for (const id of f.top.mediaIds) {
          writeFileSync(w.h.files.store.image(id, "large"), webpBytes("VP8X", 2048, 1536));
          expect(await staffOpens(w, id)).toBe(false);
        }
      });
    });

    test("sealed images: nobody is served, the author included; every list carries the placeholder, with `sealed` only for the author and nothing of the image; the export holds none", async () => {
      await inWorld(async (w) => {
        const f = await scene(w);
        // The export's list of files is read before the seal, as an archive that is already streaming read it.
        const streaming = await mediaForAccount(w.h.deps).exportImages(f.author.id);
        const all = [...f.top.mediaIds, f.replyImage, f.rankedImage];
        expect(streaming.map((image) => image.id)).toEqual(expect.arrayContaining(all));

        const { caseId } = await report(w.tx, anAccount(f.author.id, f.author.handle), "csam");
        await decideIn(w.tx, mod, caseId, SEAL_WHILE_DECIDING);

        let read = 0;
        await everyList(w, f, (answer, images, viewer, label) => {
          read++;
          expect(answer, label).toEqual(images.map((id) => (viewer === f.author.id ? { id, hidden: true, sealed: true } : { id, hidden: true })));
          // Nothing made from the image, and nothing that leads to it.
          const text = JSON.stringify(answer);
          for (const part of ["blurhash", "L2Eo_P", "/api/media/", "width", "alt", "image 1"]) expect(text, `${label}: ${part}`).not.toContain(part);
          // What the contract's post view accepts in its media list.
          for (const image of answer!) expect(PostView.shape.media.element.safeParse(image).success, label).toBe(true);
        });
        expect(read).toBe(9 * 3 + 2 * 2 + 1);

        for (const id of all) {
          for (const viewer of [f.author.id, f.other.id, null]) expect((await ask(w, id, viewer)).kind, `serve ${String(viewer)}`).toBe("not_found");
          // A browser that holds the file's tag gets no "not modified" either.
          expect((await ask(w, id, f.author.id, `"${id}-large"`)).kind).toBe("not_found");
          expect(await w.repo.find(id)).toMatchObject({ id, status: "ready", blurhash: null });
          const answer = await status(w.h.deps, f.author.id, id);
          expect(answer).toMatchObject({ id, status: "ready" });
          expect("blurhash" in answer).toBe(false);
          expect(await w.repo.isExportable(f.author.id, id)).toBe(false);
          expect(await staffOpens(w, id)).toBe(false);
        }
        expect((await w.repo.forPosts([f.top.postId])).get(f.top.postId)).toEqual(f.top.mediaIds.map((id) => ({ id, state: "sealed" })));

        // The export: the posts keep their text and name no sealed image; no file of one is in the archive, and an
        // archive that was streaming when the seal committed opens none from then on.
        expect((await w.repo.readyImages(f.author.id)).filter((id) => all.includes(id))).toEqual([]);
        const { entries, json } = await exportOf(w, f.author.id);
        expect(entries.filter((name) => all.some((id) => name.includes(id)))).toEqual([]);
        for (const postId of [f.top.postId, f.reply, f.ranked]) expect(json.posts.find((post) => post.id === postId)!.media, postId).toEqual([]);
        expect(json.posts.find((post) => post.id === f.top.postId)!.body).toBe("a post with images");
        expect(json.missingMedia).toEqual([]);
        for (const image of streaming.filter((entry) => all.includes(entry.id))) expect(await image.open(), image.id).toBeNull();
        // The reconcile pass still sees every sealed row.
        expect(await w.repo.existing(all)).toEqual(new Set(all));
      });
    });

    test.each([
      ["withheld", { kind: "interim", ruleId: "R2", actions: [act("seal_media"), act("withhold")] }, "moderator"],
      ["removed", { kind: "final", ruleId: "R2", actions: [act("seal_media"), act("remove")] }, "admin"],
    ] as const)("a sealed image of a post that is itself %s answers not found to its author too: the seal is tested before the author's branch", async (state, decision, by) => {
      await inWorld(async (w) => {
        const ada = await w.s.established();
        const p = await w.h.postWithImages(ada.id, 1);
        const plain = await w.h.postWithImages(ada.id, 1);
        const { caseId } = await report(w.tx, aPost(p.postId), "csam");
        await decideIn(w.tx, by === "admin" ? admin : mod, caseId, decision as DecisionInput);
        const [row] = await w.tx.execute<{ state: string }>(sql`select state from posts where id = ${p.postId}::uuid`);
        expect(row!.state).toBe(state);
        expect((await ask(w, p.mediaIds[0]!, ada.id)).kind).toBe("not_found");
        // The author still reads the post, with the placeholder in the image's place.
        expect((await getPost(w.s.deps, ada.id, p.postId)).media).toEqual([{ id: p.mediaIds[0], hidden: true, sealed: true }]);
        // A post that is only withheld or removed, with an image that is not sealed, still shows it to its author alone.
        const other = await report(w.tx, aPost(plain.postId), "rule");
        await decideIn(w.tx, mod, other.caseId, state === "withheld" ? { kind: "interim", actions: [act("withhold")] } : { kind: "final", actions: [act("remove")] });
        expect(await ask(w, plain.mediaIds[0]!, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
        expect((await ask(w, plain.mediaIds[0]!, null)).kind).toBe("not_found");
        const view = (await getPost(w.s.deps, ada.id, plain.postId)).media[0]!;
        expect(view).toMatchObject({ id: plain.mediaIds[0], alt: "image 1" });
        // The image itself is not restricted: its post's chip says what the post is.
        expect("moderation" in view).toBe(false);
      });
    });
  });

  describe("an image that is itself withheld or removed", () => {
    test("its author gets it with its state and is served it; anyone else gets a placeholder that does not say which, and is not served it", async () => {
      await inWorld(async (w) => {
        const [ada, bob] = [await w.s.established(), await w.s.established()];
        const p = await w.h.postWithImages(ada.id, 3);
        const [first, second, third] = p.mediaIds as [string, string, string];
        const { caseId } = await report(w.tx, aPost(p.postId), "rule");
        const media = async (viewer: string | null) => (await getPost(w.s.deps, viewer, p.postId)).media;

        await decideIn(w.tx, mod, caseId, { kind: "interim", actions: [act("withhold_media", first)] });
        expect(await media(ada.id)).toEqual([expect.objectContaining({ id: first, moderation: "withheld", alt: "image 1", large: mediaPath(first, "large") }), whole(second), whole(third)]);
        for (const viewer of [bob.id, null]) expect(await media(viewer), String(viewer)).toEqual([{ id: first, hidden: true }, whole(second), whole(third)]);
        expect(await ask(w, first, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
        for (const viewer of [bob.id, null]) expect((await ask(w, first, viewer)).kind).toBe("not_found");
        expect(await ask(w, second, null)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });

        // The final decision removes another image and closes the case, which ends the withhold taken while deciding.
        await decideIn(w.tx, mod, caseId, { kind: "final", actions: [act("remove_media", second)] });
        const own = await media(ada.id);
        expect(own).toEqual([whole(first), expect.objectContaining({ id: second, moderation: "removed" }), whole(third)]);
        expect("moderation" in own[0]!).toBe(false);
        // The same placeholder as for a withheld image: it does not say which.
        for (const viewer of [bob.id, null]) expect(await media(viewer), String(viewer)).toEqual([whole(first), { id: second, hidden: true }, whole(third)]);
        // A removed image stays with its author: in their view, in their export's list and among its files.
        const { entries, json } = await exportOf(w, ada.id);
        expect(json.posts.find((post) => post.id === p.postId)!.media.map((image) => image.id)).toEqual(p.mediaIds);
        expect(entries).toEqual(["export.json", ...p.mediaIds.map((id) => `media/${id}.webp`)].sort());
        // Staff may open a removed image: it is what they judge an appeal on.
        writeFileSync(w.h.files.store.image(second, "large"), webpBytes("VP8X", 2048, 1536));
        expect(await staffOpens(w, second)).toBe(true);
      });
    });
  });

  test("this file left no moderation row behind: the moderation tables hold what they held before it", async () => {
    expect(await moderationCounts(apiDb)).toEqual(counts);
  });
});
```

### Create `apps/api/test/lab/hold.lab.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, test } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createMediaRepo } from "../../src/media/repo";
import { createSocialRepo } from "../../src/social/repo";
import { recordIntake, type LiveTarget } from "../../src/moderation/intake";
import { aPost, anAccount, casesMedia, gate, ground, intake, moderationDeps, newImageRow, raised, removeFixtures, untilBlocked } from "../integration/moderation-fixtures";
import { newProfile } from "../integration/social-fixtures";
import { rolledBack } from "../integration/staff-fixtures";

/**
 * The lab of the intake's lock statement (3c design, sections 5 and 12, Task 3): what MediaForCases.hold costs when a
 * report of child sexual abuse material names an account with thousands of images, measured at the repository against
 * the real database, and what the purge meets now that an intake locks image rows. Every measured transaction is rolled
 * back; the accounts the lab commits are removed when it ends. It writes one line of JSON for each measurement, with how
 * busy the machine's processors were just before it. Run it by hand (see README.md); no suite includes it.
 */

/** Where the measurements go, one line of JSON each: the file LAB_OUT names, or lab-hold.jsonl in the repository's .data folder (the lab runs from apps/api). */
const OUT = process.env.LAB_OUT ?? path.resolve(process.cwd(), "../../.data/lab-hold.jsonl");
function line(name: string, result: Record<string, unknown>): void {
  const text = JSON.stringify({ name, at: new Date().toISOString(), ...result });
  mkdirSync(path.dirname(OUT), { recursive: true });
  appendFileSync(OUT, text + String.fromCharCode(10));
  console.log(`LAB ${text}`);
}

/** The share of processor time that was not idle over this many milliseconds, across all cores: how loaded the machine is. */
async function busy(ms = 1500): Promise<number> {
  const read = () => os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, all: sum.all + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle }), { idle: 0, all: 0 });
  const before = read();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = read();
  return Math.round((1 - (after.idle - before.idle) / Math.max(1, after.all - before.all)) * 100);
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

describe.skipIf(!process.env.INTEGRATION)("lab: the intake's lock statement", () => {
  let apiDb: Db;
  let migrateDb: Db;
  const committed: string[] = [];

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 8 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  });
  afterAll(async () => {
    await removeFixtures(migrateDb, committed);
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** A committed account with this many posts of one image each, written in bulk by the migrator; it answers one of the posts too. */
  async function largeAccount(posts: number): Promise<{ id: string; handle: string; postId: string }> {
    const [id, handle] = [randomUUID(), `lab_${randomBytes(5).toString("hex")}`];
    committed.push(id);
    await migrateDb.execute(sql`insert into profiles (id, handle, display_name) values (${id}::uuid, ${handle}, 'Lab account')`);
    await migrateDb.execute(sql`insert into posts (author_id, body, created_at) select ${id}::uuid, 'a lab post', now() - interval '40 days' from generate_series(1, ${posts}::int)`);
    await migrateDb.execute(sql`insert into post_media (owner_id, status, width, height, blurhash) select ${id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL' from generate_series(1, ${posts}::int)`);
    await migrateDb.execute(sql`analyze posts`);
    await migrateDb.execute(sql`analyze post_media`);
    // Each image goes onto the post of the same rank; the two numbered sets are joined by a hash, since on fresh rows the
    // planner otherwise pairs them in a nested loop.
    await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local enable_nestloop = off`);
      await tx.execute(sql`
        with p as materialized (select id, row_number() over (order by id) as n from posts where author_id = ${id}::uuid),
             i as materialized (select id, row_number() over (order by id) as n from post_media where owner_id = ${id}::uuid)
        update post_media m set post_id = p.id, position = 0, alt_text = 'a lab image' from p join i on i.n = p.n where m.id = i.id`);
    });
    await migrateDb.execute(sql`analyze post_media`);
    const [post] = await migrateDb.execute<{ id: string }>(sql`select id from posts where author_id = ${id}::uuid order by id limit 1`);
    return { id, handle, postId: post!.id };
  }
  /** How many bytes of write-ahead log the server wrote while `fn` ran: nothing else writes to this server meanwhile. */
  async function walBytes(tx: DbTx, fn: () => Promise<unknown>): Promise<number> {
    const [before] = await tx.execute<{ lsn: string }>(sql`select pg_current_wal_insert_lsn()::text as lsn`);
    await fn();
    const [after] = await tx.execute<{ bytes: string }>(sql`select (pg_current_wal_insert_lsn() - ${before!.lsn}::pg_lsn)::text as bytes`);
    return Number(after!.bytes);
  }

  test("MediaForCases.hold with an owner pair at 5,000 and at 20,000 attached rows, alone and inside a whole intake", async () => {
    for (const rows of [5000, 20000]) {
      const owner = await largeAccount(rows);
      // The lock statement by itself, as the repository issues it for a suspect item about the account: three runs, each
      // in a transaction of its own, so each one writes its lock mark to every row anew.
      for (let run = 1; run <= 3; run++) {
        const load = await busy();
        await rolledBack(apiDb, async (tx) => {
          let ms = 0;
          const wal = await walBytes(tx, async () => {
            ms = await timed(() => casesMedia(tx).hold(tx, [{ ownerId: owner.id }]));
          });
          const [locked] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from post_media where owner_id = ${owner.id}::uuid and post_id is not null`);
          line("hold, owner pair", { attachedRows: rows, run, busyPercent: load, lockMs: ms, walKb: Math.round(wal / 1024), rowsReached: locked!.n });
        });
      }
      // The plan the statement runs under.
      await rolledBack(apiDb, async (tx) => {
        const plan = await tx.execute<{ "QUERY PLAN": string }>(sql`
          explain (analyze, buffers, costs off, timing off)
          select m.id, m.post_id, m.position, m.width, m.height, m.alt_text, (m.erased_at is not null or p.erased_at is not null) as erased
          from post_media m join posts p on p.id = m.post_id
          where m.post_id = any('{}'::uuid[]) or m.owner_id = any(${`{${owner.id}}`}::uuid[])
          order by m.id for key share of m`);
        line("hold, owner pair: plan", { attachedRows: rows, plan: plan.map((row) => row["QUERY PLAN"].trim()).slice(0, 12) });
      });
      // A whole notice on the path for child sexual abuse material that names the account, and one that names a post of
      // the account too: the intake's rows, the copies, the hold and the snapshots.
      for (const [name, targets] of [
        ["notice naming the account", [anAccount(owner.id, owner.handle)]],
        ["notice naming a post and its author's account", [aPost(owner.postId, 1), anAccount(owner.id, owner.handle, 2)]],
      ] as const) {
        const load = await busy();
        await rolledBack(apiDb, async (tx) => {
          const ms = await timed(() => intake(tx, ground.csam(), targets));
          line(name, { attachedRows: rows, busyPercent: load, intakeMs: ms });
        });
      }
      // The purge's ordered delete right after such a notice, in one transaction: every row is kept, each read by the
      // keep trigger, on rows this transaction already holds for key share.
      const load = await busy();
      await rolledBack(apiDb, async (tx) => {
        await intake(tx, ground.csam(), [anAccount(owner.id, owner.handle)]);
        let deleted = 0;
        const ms = await timed(async () => {
          deleted = (await createMediaRepo(tx as unknown as Db).purgeOwner(tx, owner.id)).length;
        });
        line("ordered delete of a frozen account's rows", { attachedRows: rows, busyPercent: load, deleteMs: ms, rowsDeleted: deleted });
      });
      // What the disposal costs on this table while nothing of the account is disposable: one batch's statement and the
      // count of overdue rows. Both test a row's marks of disposal first and read the freeze only for a row that carries one.
      const idle = await busy();
      await rolledBack(apiDb, async (tx) => {
        let taken = 0;
        const dropMs = await timed(async () => {
          taken = (await casesMedia(tx).dropDisposable(tx)).length;
        });
        const overdueMs = await timed(() => casesMedia(tx).overdueDeletions());
        line("disposal, nothing of the account disposable", { attachedRows: rows, busyPercent: idle, dropDisposableMs: dropMs, rowsTaken: taken, overdueDeletionsMs: overdueMs });
      });
      // The same once the account is reported and every post of it deleted: each row carries a mark and none may go, so
      // the freeze is read once for each, at every round of the disposal for as long as the freeze lasts.
      const frozen = await busy();
      await rolledBack(apiDb, async (tx) => {
        await intake(tx, ground.csam(), [anAccount(owner.id, owner.handle)]);
        await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now() - interval '2 days', body = '' where author_id = ${owner.id}::uuid`);
        let taken = 0;
        const dropMs = await timed(async () => {
          taken = (await casesMedia(tx).dropDisposable(tx)).length;
        });
        const overdueMs = await timed(() => casesMedia(tx).overdueDeletions());
        line("disposal, every row of the account marked and frozen", { attachedRows: rows, busyPercent: frozen, dropDisposableMs: dropMs, rowsTaken: taken, overdueDeletionsMs: overdueMs });
      });
    }
  });

  /**
   * A committed account with a post that quotes its own earlier post, four images on each: the shape a report of child
   * sexual abuse material makes common, since the module adds the quoted post as a target, and the notice copies the two
   * in id order. Unless said otherwise the quoting post has the lower id, and the purge's quote counter writes the other
   * one. With `deletedQuotedFirst` the quoted post has the lower id and its author has deleted it: the purge tombstones
   * only the quoting post, and its counter still writes the deleted one. `first` is the post a notice copies first.
   */
  async function selfQuote(deletedQuotedFirst = false) {
    const author = await newProfile(apiDb);
    committed.push(author.id);
    const [low, high] = [randomUUID(), randomUUID()].sort() as [string, string];
    const [quoting, quoted] = deletedQuotedFirst ? [high, low] : [low, high];
    await apiDb.execute(sql`insert into posts (id, author_id, body, quote_count, created_at) values (${quoted}::uuid, ${author.id}::uuid, 'the quoted post', 1, now() - interval '31 days')`);
    await apiDb.execute(sql`insert into posts (id, author_id, body, quote_of_id, created_at) values (${quoting}::uuid, ${author.id}::uuid, 'a post that quotes its author', ${quoted}::uuid, now() - interval '30 days')`);
    for (const postId of [quoting, quoted]) for (const position of [0, 1, 2, 3]) await newImageRow(apiDb, author.id, postId, position);
    if (deletedQuotedFirst) await apiDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${quoted}::uuid`);
    return { author, quoting, quoted, first: low };
  }
  /**
   * A notice through the moderation module, which runs its transaction again by itself after a deadlock or a lock
   * timeout; it answers how many runs the notice took, so a deadlock the module absorbed is still counted here.
   * `afterCopy`, when given, is called each time a post was copied under its share lock.
   */
  async function noticeRuns(tx: DbTx, live: LiveTarget[], afterCopy?: (postId: string) => Promise<void>): Promise<string> {
    const deps = moderationDeps(tx);
    let runs = 0;
    const counting = new Proxy(deps.apiDb, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver) as unknown;
        return (...args: Parameters<Db["transaction"]>) => {
          runs++;
          return target.transaction(...args);
        };
      },
    });
    const social: typeof deps.social = !afterCopy
      ? deps.social
      : {
          ...deps.social,
          capturePost: async (within, postId) => {
            const post = await deps.social.capturePost(within, postId);
            await afterCopy(postId);
            return post;
          },
        };
    await recordIntake({ ...deps, apiDb: counting, social }, { ground: ground.csam(), live });
    return runs === 1 ? "in one run" : `in ${runs} runs`;
  }
  /**
   * The account's purge as the social and media repositories issue it: the profile's row, the posts' rows in id order, the
   * counters, the tombstones, the engagement and the graph, the profile, and the image rows in id order as the
   * transaction's last act. Nothing runs a purge again: a deadlock that picks it is counted as its error.
   */
  const purgeOf = (tx: DbTx, authorId: string) =>
    createSocialRepo(tx as unknown as Db).purgeProfile(authorId, new Date(), async (within) => void (await createMediaRepo(within as unknown as Db).purgeOwner(within, authorId)));
  /** How one side of a round ended: "ok" with what it noted, or the error the database raised. */
  const ended = (work: Promise<unknown>, note: () => string = () => "") =>
    work.then(
      () => `ok${note()}`,
      (err: unknown) => {
        const fromDatabase = raised(err);
        return fromDatabase ? `${fromDatabase.code} ${fromDatabase.message}` : ((err as { code?: string }).code ?? String(err));
      },
    );

  test("the purge against a notice about a post that quotes its author's own post: rounds in both orders", async () => {
    const { author, quoting } = await selfQuote();
    const pause = (tx: DbTx) => tx.execute(sql`select pg_sleep(0.015)`);

    const sides: Record<string, (tx: DbTx) => Promise<unknown>> = {
      purge: (tx) => purgeOf(tx, author.id),
      // The notice through the moderation module's own transaction: it names the quoting post and the account, and the
      // module adds the quoted post. Its cases and items, the two posts for share in id order, then the hold's lock
      // statement over both posts' images and every image on the account's posts.
      notice: (tx) => noticeRuns(tx, [aPost(quoting, 1), anAccount(author.id, author.handle, 2)]),
    };
    // Forty rounds unless LAB_ROUNDS says otherwise.
    const ROUNDS = Number(process.env.LAB_ROUNDS ?? 40);
    const load = await busy();
    const counts: Record<string, number> = {};
    let longest = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const side = (fn: (tx: DbTx) => Promise<unknown>, delay: number) => async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const start = performance.now();
        let note = "";
        const outcome = await ended(
          rolledBack(apiDb, async (tx) => {
            const answer = await fn(tx);
            if (typeof answer === "string") note = ` ${answer}`;
            await pause(tx);
          }),
          () => note,
        );
        longest = Math.max(longest, performance.now() - start);
        return outcome;
      };
      // Each side starts first in half the rounds, a few milliseconds ahead.
      const ahead = Math.floor(Math.random() * 8);
      const [a, b] = await Promise.all(round % 2 === 0 ? [side(sides.purge!, 0)(), side(sides.notice!, ahead)()] : [side(sides.purge!, ahead)(), side(sides.notice!, 0)()]);
      for (const [who, outcome] of [["purge", a], ["notice", b]] as const) counts[`${who}: ${outcome}`] = (counts[`${who}: ${outcome}`] ?? 0) + 1;
    }
    line("purge against a notice about a post that quotes its author's own post", { rounds: ROUNDS, busyPercent: load, outcomes: counts, longestMs: Math.round(longest) });
  });

  test("the same pair, staged ten times in each shape: the notice holds the first of the two posts, the purge comes to wait, and the notice goes on to the second", async () => {
    // The rounds above meet by chance, and the order that matters is a narrow one: the notice has copied the first of
    // the two posts and not yet the second when the purge arrives. Here every round is made to be that order.
    for (const [shape, deletedQuotedFirst] of [["the quoting post has the lower id", false], ["the quoted post has the lower id and was deleted by its author", true]] as const) {
      const { author, quoting, first } = await selfQuote(deletedQuotedFirst);
      const STAGED = 10;
      const load = await busy();
      const counts: Record<string, number> = {};
      for (let round = 0; round < STAGED; round++) {
        const [held, wait] = [gate(), gate()];
        let runs = "";
        let stopped = false;
        const notice = ended(
          rolledBack(apiDb, async (tx) => {
            runs = await noticeRuns(tx, [aPost(quoting, 1), anAccount(author.id, author.handle, 2)], async (postId) => {
              // Only the first run is stopped: a run the module makes again after a deadlock goes straight through.
              if (postId !== first || stopped) return;
              stopped = true;
              held.open();
              await wait.opened;
            });
          }),
          () => ` ${runs}`,
        );
        await Promise.race([held.opened, notice]);
        const purge = ended(rolledBack(apiDb, (tx) => purgeOf(tx, author.id)));
        // The purge comes to wait for a post the notice holds: in the statement that takes its posts in id order, or, in
        // a purge that wrote before it locked, in a later statement over the account's posts.
        await untilBlocked(apiDb, "where author_id = ");
        wait.open();
        for (const [who, outcome] of [["purge", await purge], ["notice", await notice]] as const) counts[`${who}: ${outcome}`] = (counts[`${who}: ${outcome}`] ?? 0) + 1;
      }
      line("purge against such a notice, staged: the notice holds the first post", { shape, rounds: STAGED, busyPercent: load, outcomes: counts });
    }
  });
});
```

### Create `apps/api/test/media/webp-bytes.ts`

```ts
/**
 * The first bytes of a WebP file, built by hand for the tests of the checked open that serves staff an image: a RIFF
 * container named WEBP whose first chunk says how large the picture is, in each of the three forms the format has. Nothing
 * here is a picture: the bytes after the header are filler, since the API never decodes a file of the store.
 */
export type WebpKind = "VP8 " | "VP8L" | "VP8X";

const ascii = (text: string) => Buffer.from(text, "ascii");
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};
const u24 = (value: number) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
const u16 = (value: number) => Buffer.from([value & 0xff, (value >> 8) & 0xff]);

/** The chunk that carries the size, from its name on: 18 bytes in each form, so that the whole header is 30. */
function sizeChunk(kind: WebpKind, width: number, height: number): Buffer {
  if (kind === "VP8X") {
    // Flags and three reserved bytes, then the canvas' width and height, each less one, in 24 bits.
    return Buffer.concat([ascii("VP8X"), u32(10), Buffer.from([0, 0, 0, 0]), u24(width - 1), u24(height - 1)]);
  }
  if (kind === "VP8L") {
    // The signature byte, then 14 bits of width less one, 14 of height less one, the alpha bit and three bits of version.
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    return Buffer.concat([ascii("VP8L"), u32(64), Buffer.from([0x2f]), u32(bits), Buffer.alloc(5)]);
  }
  // A key frame's three-byte tag (its lowest bit clear), the start code, then the width and the height in 14 bits each.
  return Buffer.concat([ascii("VP8 "), u32(64), Buffer.from([0x10, 0x02, 0x00]), Buffer.from([0x9d, 0x01, 0x2a]), u16(width & 0x3fff), u16(height & 0x3fff)]);
}

/** A file that begins as a WebP of this size does: the 30 bytes of its header, then filler that names the file. */
export function webpBytes(kind: WebpKind, width: number, height: number, filler = "not a picture"): Buffer {
  const body = Buffer.concat([ascii("WEBP"), sizeChunk(kind, width, height), ascii(filler)]);
  return Buffer.concat([ascii("RIFF"), u32(body.length), body]);
}
```

### Create `apps/api/test/media/webp.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { WEBP_HEADER_BYTES, webpSize } from "../../src/media/webp";
import { webpBytes, type WebpKind } from "./webp-bytes";

/**
 * The header check behind the one function that opens an image file for staff (3c design, section 7.3, gate V): the
 * store is written by the worker, which runs the decoder, so a file is given to the console only when its first 30 bytes
 * say that it is a WebP and how large. The check reads bytes; it decodes nothing.
 */
describe("the size a WebP file's header states", () => {
  const head = (kind: WebpKind, width: number, height: number) => webpBytes(kind, width, height).subarray(0, WEBP_HEADER_BYTES);

  test("the header is 30 bytes: the container, the first chunk's name and its size fields in each of the three forms", () => {
    expect(WEBP_HEADER_BYTES).toBe(30);
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) expect(webpBytes(kind, 4, 3, "").length, kind).toBe(30);
  });

  test.each(["VP8 ", "VP8L", "VP8X"] as const)("a %s file states its width and height", (kind) => {
    expect(webpSize(head(kind, 2048, 1536))).toEqual({ width: 2048, height: 1536 });
    expect(webpSize(head(kind, 1, 1))).toEqual({ width: 1, height: 1 });
    expect(webpSize(head(kind, 683, 1024))).toEqual({ width: 683, height: 1024 });
    // The whole file gives the same answer as its header: only the first 30 bytes are read.
    expect(webpSize(webpBytes(kind, 800, 600))).toEqual({ width: 800, height: 600 });
  });

  test("the extended form holds sizes beyond what the other two can state", () => {
    expect(webpSize(head("VP8X", 16_383, 16_383))).toEqual({ width: 16_383, height: 16_383 });
    expect(webpSize(head("VP8X", 70_000, 3))).toEqual({ width: 70_000, height: 3 });
  });

  test("fewer than 30 bytes state nothing", () => {
    const whole = head("VP8X", 800, 600);
    for (const length of [0, 4, 12, 16, 29]) expect(webpSize(whole.subarray(0, length)), String(length)).toBeNull();
  });

  test("a file that is not a RIFF container named WEBP states nothing", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 0x20)]);
    const text = Buffer.from("large-webp-of-3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab and more text", "ascii");
    const wave = Buffer.from(head("VP8X", 800, 600));
    wave.write("WAVE", 8, "ascii");
    const riff = Buffer.from(head("VP8X", 800, 600));
    riff.write("RIFX", 0, "ascii");
    for (const bytes of [jpeg, text, wave, riff, Buffer.alloc(30)]) expect(webpSize(bytes)).toBeNull();
  });

  test("a first chunk that is none of the three states nothing", () => {
    for (const name of ["ALPH", "ANIM", "VP8Y", "vp8x", "VP8_"]) {
      const bytes = Buffer.from(head("VP8X", 800, 600));
      bytes.write(name, 12, "ascii");
      expect(webpSize(bytes), name).toBeNull();
    }
  });

  test("a lossy chunk without a key frame's start code, and a lossless one without its signature or of another version, state nothing", () => {
    const noStartCode = Buffer.from(head("VP8 ", 800, 600));
    noStartCode[23] = 0x00;
    expect(webpSize(noStartCode)).toBeNull();
    // The lowest bit of the frame tag is clear in a key frame, the only frame that states a size.
    const interFrame = Buffer.from(head("VP8 ", 800, 600));
    interFrame[20] = interFrame[20]! | 0x01;
    expect(webpSize(interFrame)).toBeNull();
    const noSignature = Buffer.from(head("VP8L", 800, 600));
    noSignature[20] = 0x2e;
    expect(webpSize(noSignature)).toBeNull();
    const otherVersion = Buffer.from(head("VP8L", 800, 600));
    otherVersion[24] = otherVersion[24]! | 0x20;
    expect(webpSize(otherVersion)).toBeNull();
  });

  test("a lossy frame's scaling bits are not part of its size", () => {
    const scaled = Buffer.from(head("VP8 ", 800, 600));
    scaled[27] = scaled[27]! | 0xc0;
    scaled[29] = scaled[29]! | 0x40;
    expect(webpSize(scaled)).toEqual({ width: 800, height: 600 });
  });
});
```

### Create `apps/app/test/hidden-media.test.tsx`

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { HiddenMedia, MediaView, PostView } from "@korbat/contracts";
import { PopularPosts } from "../src/components/PopularNow";
import { HIDDEN_IMAGE, SEALED_IMAGE, hiddenImageWords } from "../src/components/social/HiddenImage";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard } from "../src/components/social/PostCard";

/**
 * The placeholder of a hidden image in the web app (3c design, section 9). A post's media list holds, in an image's
 * place, a hidden image when the reader is not shown it: anyone but the author for an image moderation withheld or
 * removed, and everyone, the author included, for a sealed one. The components are server-rendered, as explore.test.tsx
 * renders its screens; what a static render cannot show (that pressing a placeholder opens nothing) is read from the
 * markup's roles and from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

// expo-router cannot load in Node: Link with `asChild` hands the child its href, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
// expo-image reaches native modules; here an image is the address it would load and its description, so a test can see
// exactly which files a render asks for.
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, spaces collapsed. */
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The address of every image the markup would load. */
const loaded = (markup: string): string[] => [...markup.matchAll(/data-uri="([^"]+)"/g)].map((match) => match[1]!);
/** How often `part` occurs in `whole`. */
const count = (whole: string, part: string): number => whole.split(part).length - 1;
/** The accessible name of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<[a-z]+\b[^>]*\brole="button"[^>]*>/g)].map((match) => /aria-label="([^"]*)"/.exec(match[0])?.[1] ?? "");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = (n: number, alt = `picture ${n}`): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
const sealed = (n: number): HiddenMedia => ({ id: id(n), hidden: true, sealed: true });

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}

describe("the words", () => {
  test("a hidden image reads as the design gives it, and the reader's own sealed image says that nobody is shown it", () => {
    expect(HIDDEN_IMAGE).toBe("Image hidden by korbat moderation");
    expect(SEALED_IMAGE).toBe("Sealed: not shown to anyone, you included");
    expect(hiddenImageWords(hidden(1))).toBe(HIDDEN_IMAGE);
    expect(hiddenImageWords(sealed(1))).toBe(SEALED_IMAGE);
  });
});

describe("a post's images", () => {
  test("a hidden image is drawn as the placeholder in its place: nothing is loaded for it and nothing opens it, while the others are shown as before", () => {
    const out = html(<MediaGrid media={[image(1), hidden(2), image(3)]} />);
    expect(textOf(out)).toContain(HIDDEN_IMAGE);
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(1)}/small.webp`), expect.stringContaining(`/api/media/${id(3)}/small.webp`)]);
    expect(out).not.toContain(id(2));
    // Two images open the viewer; the placeholder is no button. The third control shows the descriptions.
    expect(buttons(out)).toEqual(["Open image: picture 1", "Open image: picture 3", "Show image descriptions"]);
  });

  test("the reader's own sealed image is drawn with the sealed words, and not with the others'", () => {
    const out = html(<MediaGrid media={[sealed(1), image(2)]} />);
    expect(textOf(out)).toContain(SEALED_IMAGE);
    expect(textOf(out)).not.toContain(HIDDEN_IMAGE);
    expect(loaded(out)).toHaveLength(1);
    expect(buttons(out)).toEqual(["Open image: picture 2", "Show image descriptions"]);
  });

  test("a post whose every image is hidden shows the placeholders alone: no image, no viewer, no description control", () => {
    for (const media of [[hidden(1)], [sealed(1), sealed(2)], [hidden(1), hidden(2), hidden(3), hidden(4)]]) {
      const out = html(<MediaGrid media={media} />);
      expect(loaded(out)).toEqual([]);
      expect(buttons(out)).toEqual([]);
      expect(textOf(out).split(media[0]!.sealed ? SEALED_IMAGE : HIDDEN_IMAGE).length - 1).toBe(media.length);
    }
    expect(html(<MediaGrid media={[]} />)).toBe("");
  });

  test("a quoted post's row of small squares keeps a square in a hidden image's place and says the sentence once, as text, under the row", () => {
    const out = html(<MediaGrid compact media={[image(1), hidden(2), hidden(3)]} />);
    const text = textOf(out);
    expect(loaded(out)).toHaveLength(1);
    expect(out).not.toContain(id(2));
    expect(buttons(out)).toEqual([]);
    // Each square keeps its short word; the sentence is text, said once however many images are hidden, and it is not
    // repeated anywhere in the markup as a name of each square.
    expect(count(text, "Hidden")).toBe(2);
    expect(count(text, HIDDEN_IMAGE)).toBe(1);
    expect(count(out, HIDDEN_IMAGE)).toBe(1);
    expect(text).not.toContain(SEALED_IMAGE);
    // It comes after the squares: under the row.
    expect(text.indexOf(HIDDEN_IMAGE)).toBeGreaterThan(text.lastIndexOf("Hidden"));
  });

  test("the author of a sealed image in a quoted post reads the sealed sentence there, once, and not the other one", () => {
    const out = html(<MediaGrid compact media={[sealed(1), image(2), sealed(3)]} />);
    const text = textOf(out);
    expect(count(text, SEALED_IMAGE)).toBe(1);
    expect(count(out, SEALED_IMAGE)).toBe(1);
    expect(text).not.toContain(HIDDEN_IMAGE);
    expect(count(text, "Hidden")).toBe(2);
    expect(loaded(out)).toHaveLength(1);
  });

  test("a quoted post's row with no hidden image says neither sentence", () => {
    const text = textOf(html(<MediaGrid compact media={[image(1), image(2)]} />));
    for (const words of [HIDDEN_IMAGE, SEALED_IMAGE, "Hidden"]) expect(text).not.toContain(words);
  });

  test("a card renders a post that holds hidden images, on the post and in the post it quotes", () => {
    const quoted = { ...post(2, { media: [hidden(21), image(22)] }), quoteOf: null };
    const out = html(<PostCard post={post(1, { media: [image(11), sealed(12)], quoteOf: quoted })} />);
    const text = textOf(out);
    // The post's own sealed image says so in its place in the frame.
    expect(count(text, SEALED_IMAGE)).toBe(1);
    // The quoted post's hidden image: the sentence once, as text, inside the quote, which comes after the quoted post's
    // own words and before the card's actions.
    expect(count(out, HIDDEN_IMAGE)).toBe(1);
    expect(text.indexOf(HIDDEN_IMAGE)).toBeGreaterThan(text.indexOf("post number 2"));
    expect(text.indexOf(HIDDEN_IMAGE)).toBeLessThan(text.indexOf("Reply"));
    expect(loaded(out)).toHaveLength(2);
  });
});

describe("the viewer", () => {
  const media = [image(1), hidden(2), sealed(3)];
  const noop = () => undefined;

  test("shows an image in its large size with its description and its place among the post's images", () => {
    const out = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />);
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(1)}/large.webp`)]);
    expect(textOf(out)).toContain("1 of 3");
    expect(textOf(out)).toContain("picture 1");
  });

  test("never opens a hidden image: stepped onto, it shows the placeholder's words in the image's place and loads nothing", () => {
    const second = html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} />);
    expect(loaded(second)).toEqual([]);
    expect(textOf(second)).toContain("2 of 3");
    expect(textOf(second)).toContain(HIDDEN_IMAGE);
    const third = html(<MediaViewerContent media={media} index={2} onIndex={noop} onClose={noop} />);
    expect(loaded(third)).toEqual([]);
    expect(textOf(third)).toContain(SEALED_IMAGE);
    // The viewer's own controls stay.
    expect(buttons(third)).toEqual(["Close the image viewer", "Previous image", "Next image"]);
  });

  test("is opened only from an image's own cell: the placeholder has no press handler", () => {
    const grid = readFileSync(path.join(SRC, "components", "social", "MediaGrid.tsx"), "utf8");
    const placeholder = readFileSync(path.join(SRC, "components", "social", "HiddenImage.tsx"), "utf8");
    expect(grid).toMatch(/isHiddenMedia\(item\) \? <HiddenImage/);
    expect(placeholder).not.toMatch(/onPress|Pressable|accessibilityRole="button"/);
  });
});

describe("Popular now", () => {
  test("an image-only post is named by the first image the reader is shown; hidden images are skipped, and a post of hidden images alone has no image line", () => {
    const out = html(
      <PopularPosts
        posts={[
          post(1, { body: "", media: [hidden(11), image(12, "A green square")] }),
          post(2, { body: "", media: [sealed(21), hidden(22)] }),
          post(3, { body: "", media: [image(31, "A red circle"), hidden(32)] }),
        ]}
      />,
    );
    const lines = [...out.matchAll(/<a\b[^>]*href="\/post\/[^"]+"[^>]*>(.*?)<\/a>/g)].map((match) => textOf(match[1]!));
    expect(lines).toEqual(["Ada Image: A green square", "Ada", "Ada Image: A red circle"]);
    expect(out).not.toContain("undefined");
  });
});
```

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2, 3a design section 5, 3c design section 5). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
// The command lines open both pools: grant-role changes a role on the auth pool, and staff.js reads there the staff keys
// that audit-verify checks the record against.
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts", "cli/staff.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. */
const MODULES = ["auth", "social", "media", "account", "staff", "moderation"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");
const insideMedia = (path: string) => path.startsWith("media/");
const insideAccount = (path: string) => path.startsWith("account/");
const insideStaff = (path: string) => path.startsWith("staff/");
const insideModeration = (path: string) => path.startsWith("moderation/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    // The staff module (role korbat_api) reads and writes the public audit log; staff keys, staff sessions and enrolments
    // are credentials, the auth module's alone (3a design, section 5). The moderation module owns the moderation tables on
    // the same role: a notifier's contact and the staff links live in the auth schema, out of its reach (3c design, section 5).
    if (insideSocial(path) || insideMedia(path) || insideStaff(path) || insideModeration(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
    // The account module sequences the other three through their index files and holds no table access of its own
    // (1b spec, section 5): no table or enum of either schema may be named in it. Db and DbTx, which are not schema
    // names, stay allowed, since a transaction is passed through it.
    if (insideAccount(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the account module holds no table access)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db (the account module holds no table access)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db (the account module holds no table access)`);
      }
    }
    // The staff module uses the auth module's interface as the other modules do, never its repository or its session
    // store, which would hand it the auth tables; the moderation module likewise. Any mention counts, so a renamed,
    // namespace or dynamic import is caught as surely as a named one.
    if (insideStaff(path) || insideModeration(path)) {
      const module = insideStaff(path) ? "staff" : "moderation";
      for (const name of new Set([...source.matchAll(/\b(createAuthRepo|createSessions)\b/g)].map((m) => m[1]!))) {
        violations.push(`${path}: uses the auth module's ${name} (the ${module} module goes through the auth module's interface)`);
      }
    }
  }
  return violations;
}

/**
 * The source pins of the freeze (3c design, sections 6.1 and 6.5). The freeze of the path for suspected child sexual abuse
 * material holds only while every path of a kind passes one gate, so who may name what is pinned here, beside the
 * database's own pins of who names the predicate there:
 *   - `post_frozen` is named only in the media repository and the moderation repository, and `frozen_for` nowhere in the
 *     API: no other file decides by itself what is frozen;
 *   - a delete of `post_media` is written only in the media repository, whose every delete the keep trigger judges and
 *     whose every answer names only rows that are gone;
 *   - `requestDeletion` (asking the worker to delete an image's files) and `openImage` (opening an image file of the
 *     store) are named in a pinned list of files, each a pinned number of times, comments included: a new caller of
 *     either fails the test until whoever adds it has checked it against the gates and listed it.
 */
const POST_FROZEN_ALLOWED = new Set(["media/repo.ts", "moderation/repo.ts"]);
const POST_MEDIA_DELETE_ALLOWED = new Set(["media/repo.ts"]);
const POST_MEDIA_DELETE = /\bdelete\s+from\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?post_media\b|\btruncate\b[^;`]*\bpost_media\b|\.delete\(\s*postMedia\b/i;

function findFreezeViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (/\bfrozen_for\b/.test(source)) violations.push(`${path}: names frozen_for, which only the database's own functions name`);
    if (/\bpost_frozen\b/.test(source) && !POST_FROZEN_ALLOWED.has(path)) violations.push(`${path}: names post_frozen, which only the media and moderation repositories may`);
    if (POST_MEDIA_DELETE.test(source) && !POST_MEDIA_DELETE_ALLOWED.has(path)) violations.push(`${path}: deletes from post_media, which only the media repository may`);
  }
  return violations;
}

/** Every file that names `name` as a whole word, with how often, comments included. */
function mentions(files: SourceFile[], name: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const { path, source } of files) {
    // Cut at every word boundary: a whole word is then a piece of its own.
    const count = source.split(/\b/).filter((piece) => piece === name).length;
    if (count > 0) found[path] = count;
  }
  return found;
}

/**
 * Where `requestDeletion` is named. A deletion request names an id that a delete of post_media answered, an upload that
 * failed before it could be put on a post, or a file that has no row: the files module writes the request; the upload's
 * removal, the sweeper, the author's deletion (after its commit), the account's purge (inside its transaction) and the
 * disposal's caller (after its commit) ask for it through the module's interfaces.
 */
const REQUEST_DELETION = {
  "account/flows/deletion.ts": 1,
  "media/cases.ts": 4,
  "media/context.ts": 2,
  "media/files.ts": 1,
  "media/flows/remove.ts": 1,
  "media/index.ts": 5,
  "media/sweeper.ts": 2,
  "social/context.ts": 1,
  "social/flows/posts.ts": 1,
};

/**
 * Where `openImage` is named: the files module, which opens a file of the store under its checks, and its three callers,
 * each behind its own reader's rule: serve (gate S), the export's open (which reads the row again) and the staff's image
 * (gate V).
 */
const OPEN_IMAGE = {
  "media/cases.ts": 1,
  "media/files.ts": 1,
  "media/flows/serve.ts": 1,
  "media/index.ts": 1,
};

describe("the freeze's source pins", () => {
  test("apps/api/src names post_frozen only in the two repositories, frozen_for nowhere, and deletes from post_media only in the media repository", () => {
    expect(findFreezeViolations(loadSources())).toEqual([]);
    // The media repository does name the predicate and does delete: the pins are about a file that exists.
    const repo = loadSources().find((file) => file.path === "media/repo.ts")!;
    expect(repo.source).toMatch(/\bpost_frozen\b/);
    expect(POST_MEDIA_DELETE.test(repo.source)).toBe(true);
  });

  test("catches the predicate named outside the two repositories, and its core named anywhere", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "sql`select public.post_frozen(m.post_id) as frozen from post_media m`" },
      { path: "moderation/repo.ts", source: "sql`select not public.post_frozen(${postId}::uuid) as images_allowed`" },
      { path: "moderation/cases.ts", source: "const [row] = await tx.execute(sql`select public.post_frozen(${postId}::uuid) as frozen`);" },
      { path: "media/flows/serve.ts", source: "const frozen = await db.execute(sql`select post_frozen(${postId})`);" },
      { path: "staff/cases.ts", source: "await db.execute(sql`select public.frozen_for(${postId}::uuid, ${authorId}::uuid)`);" },
      { path: "media/repo.ts", source: "sql`select public.frozen_for(m.post_id, m.owner_id) from post_media m`" },
      // Another word that only contains the name is not the name.
      { path: "social/views.ts", source: "const post_frozen_label = 1; const unfrozen_for_now = 2;" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "moderation/cases.ts: names post_frozen, which only the media and moderation repositories may",
      "media/flows/serve.ts: names post_frozen, which only the media and moderation repositories may",
      "staff/cases.ts: names frozen_for, which only the database's own functions name",
      "media/repo.ts: names frozen_for, which only the database's own functions name",
    ]);
  });

  test("catches a delete of post_media outside the media repository, in SQL and through the query builder", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "await tx.execute(sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`);\nawait db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/sweeper.ts", source: "await db.execute(sql`delete from post_media where post_id is null and created_at < ${before}`);" },
      { path: "media/flows/remove.ts", source: "await deps.db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/cases.ts", source: 'await tx.execute(sql`DELETE FROM "public"."post_media" WHERE "id" = ${id}`);' },
      { path: "media/index.ts", source: "await tx.execute(sql`truncate table post_media cascade`);" },
      // Reading and updating image rows, and deleting something else, is not a delete of image rows.
      { path: "media/flows/status.ts", source: "await db.update(postMedia).set({ status }).where(eq(postMedia.id, id));\nawait db.delete(posts).where(eq(posts.id, id));\nconst rows = await db.execute(sql`select id from post_media`);" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "media/sweeper.ts: deletes from post_media, which only the media repository may",
      "media/flows/remove.ts: deletes from post_media, which only the media repository may",
      "media/cases.ts: deletes from post_media, which only the media repository may",
      "media/index.ts: deletes from post_media, which only the media repository may",
    ]);
  });

  test("requestDeletion and openImage are named in exactly the pinned files, each the pinned number of times", () => {
    expect(mentions(loadSources(), "requestDeletion")).toEqual(REQUEST_DELETION);
    expect(mentions(loadSources(), "openImage")).toEqual(OPEN_IMAGE);
  });

  test("catches a new caller of either, in a file of the list and in one outside it", () => {
    const real = loadSources();
    // A second request in the purge's flow, and a first one in a file that had none.
    const withCallers = real
      .map((file) => (file.path === "account/flows/deletion.ts" ? { ...file, source: `${file.source}\nawait deps.media.requestDeletion(kept);` } : file))
      .concat([{ path: "moderation/retention.ts", source: "await deps.media.requestDeletion(ids);" }]);
    expect(mentions(withCallers, "requestDeletion")).not.toEqual(REQUEST_DELETION);
    expect(mentions(withCallers, "requestDeletion")).toMatchObject({ "account/flows/deletion.ts": 2, "moderation/retention.ts": 1 });
    // A fourth opener of the store's files.
    const withOpener = real.concat([{ path: "staff/cases.ts", source: 'const file = await files.openImage(id, "large");' }]);
    expect(mentions(withOpener, "openImage")).not.toEqual(OPEN_IMAGE);
    // A name that only contains the word is not counted.
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "requestDeletion")).toEqual({});
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "openImage")).toEqual({});
  });
});

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("account/index.ts");
    expect(paths).toContain("staff/index.ts");
    expect(paths).toContain("moderation/index.ts");
    expect(paths).toContain("cli/staff.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
      { path: "index.ts", source: `import { createAccount } from "./account";\nimport { createMedia } from "./media";` },
      { path: "account/routes.ts", source: `import type { AuthForAccount } from "../auth";\nimport type { SocialForAccount } from "../social";\nimport { buildExport } from "./flows/export";` },
      { path: "account/flows/deletion.ts", source: `import type { DbTx } from "@korbat/db";\nimport type { MediaForAccount } from "../../media";` },
      { path: "cli/staff.ts", source: `import { createStaff } from "../staff";\nconst authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `import { auditHead, auditLog, profiles, type Db, type DbTx } from "@korbat/db";` },
      { path: "staff/routes.ts", source: `import { AuthError, type Auth } from "../auth";\nimport { staffGate } from "./gate";` },
      { path: "staff/cases.ts", source: `import { ModerationError, type ModerationForStaff } from "../moderation";` },
      { path: "index.ts", source: `import { createModeration } from "./moderation";\nimport { socialForModeration } from "./social";` },
      { path: "moderation/repo.ts", source: `import { cases, decisions, evidenceSnapshots, intakes, type Db, type DbTx } from "@korbat/db";\nimport { ModerationError } from "./context";` },
      { path: "moderation/decide.ts", source: `import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";\nimport { boundLockWaits } from "../lib/lock-bounds";\nimport type { SocialForModeration } from "../social";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts", "auditLog", "auditHead", "cases", "decisions", "evidenceSnapshots", "intakes"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches a deep import into the account module, and a table or enum of either schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createZipWriter } from "./account/zip";\nimport { createAccount } from "./account";` },
      { path: "social/flows/graph.ts", source: `import { buildExport } from "../../account/flows/export";` },
      { path: "account/flows/export.ts", source: `import { posts, users, type DbTx } from "@korbat/db";` },
      { path: "account/purge.ts", source: `import * as db from "@korbat/db";` },
      { path: "account/zip.ts", source: `import type { Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./account/zip, which is inside the account module (use ./account)",
      "social/flows/graph.ts: imports ../../account/flows/export, which is inside the account module (use ./account)",
      "account/flows/export.ts: imports public-schema posts from @korbat/db (the account module holds no table access)",
      "account/flows/export.ts: imports auth-schema users from @korbat/db (the account module holds no table access)",
      "account/purge.ts: namespace import of @korbat/db (the account module holds no table access)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
      // The staff command line may open the auth pool; another command line, or the staff module itself, may not.
      { path: "cli/other.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `export function readKeys(authDb: Db) {}` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
      "cli/other.ts: references the auth database pool",
      "staff/audit.ts: references the auth database pool",
    ]);
  });

  test("catches a deep import into the staff module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { staffGate } from "./staff/gate";\nimport { createStaff } from "./staff";` },
      { path: "cli/staff.ts", source: `import { canonicalText } from "../staff/chain";` },
      { path: "auth/staff/flows.ts", source: `import { appendAuditRow } from "../../staff/audit";` },
      { path: "staff/routes.ts", source: `import { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./staff/gate, which is inside the staff module (use ./staff)",
      "cli/staff.ts: imports ../staff/chain, which is inside the staff module (use ./staff)",
      "auth/staff/flows.ts: imports ../../staff/audit, which is inside the staff module (use ./staff)",
    ]);
  });

  test("catches auth-schema imports inside the staff module", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { auditLog, staffKeys, type Db } from "@korbat/db";` },
      { path: "staff/reader.ts", source: `import type { staffSessions as s } from "@korbat/db";` },
      { path: "staff/writer.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["auditLog"]), new Set(["staffKeys", "staffSessions"]))).toEqual([
      "staff/audit.ts: imports auth-schema staffKeys from @korbat/db",
      "staff/reader.ts: imports auth-schema staffSessions from @korbat/db",
      "staff/writer.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });

  test("catches the auth module's repository or session store inside the staff module, however it is imported", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { AuthError, createAuthRepo } from "../auth";` },
      { path: "staff/routes.ts", source: `import { createSessions as sessionsOf } from "../auth";` },
      { path: "staff/flows/x.ts", source: `import * as auth from "../../auth";\nconst repo = auth.createAuthRepo(db);\nconst s = auth.createSessions(deps);` },
      { path: "staff/flows/y.ts", source: `const { createSessions } = await import("../../auth");` },
      // Outside the staff module the rule does not apply: the command lines build the auth module's parts themselves.
      { path: "cli/grant-role.ts", source: `import { createAuthRepo, createSessions } from "../auth";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "staff/audit.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/routes.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/y.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
    ]);
  });

  test("catches a deep import into the moderation module, from outside it and from another module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { decide } from "./moderation/decide";\nimport { createModeration } from "./moderation";` },
      { path: "staff/cases.ts", source: `import { ModerationError } from "../moderation/context";` },
      { path: "social/views.ts", source: `import { authorFacts } from "../moderation/repo";` },
      { path: "cli/staff.ts", source: `const { recordIntake } = await import("../moderation/intake");` },
      { path: "moderation/decide.ts", source: `import { ModerationError } from "./context";\nimport { insertDecision } from "./repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./moderation/decide, which is inside the moderation module (use ./moderation)",
      "staff/cases.ts: imports ../moderation/context, which is inside the moderation module (use ./moderation)",
      "social/views.ts: imports ../moderation/repo, which is inside the moderation module (use ./moderation)",
      "cli/staff.ts: imports ../moderation/intake, which is inside the moderation module (use ./moderation)",
    ]);
  });

  test("catches the moderation module reaching into another module, naming post_media, or opening the auth pool", () => {
    const files: SourceFile[] = [
      { path: "moderation/intake.ts", source: `import { createSocialRepo } from "../social/repo";` },
      { path: "moderation/decide.ts", source: `import { verifyStepUp } from "../auth/staff/step-up";` },
      { path: "moderation/repo.ts", source: `import { cases, postMedia, type Db } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: "const rows = await tx.execute(sql`select id from post_media where post_id = ${postId}`);" },
      { path: "moderation/context.ts", source: `export interface ModerationDeps { authDb: Db }` },
    ];
    expect(findViolations(files, new Set(["cases", "postMedia"]), new Set())).toEqual([
      "moderation/intake.ts: imports ../social/repo, which is inside the social module (use ./social)",
      "moderation/decide.ts: imports ../auth/staff/step-up, which is inside the auth module (use ./auth)",
      "moderation/repo.ts: references post_media, which only the media module may touch",
      "moderation/cases.ts: references post_media, which only the media module may touch",
      "moderation/context.ts: references the auth database pool",
    ]);
  });

  test("catches auth-schema imports inside the moderation module, and the auth module's repository or session store", () => {
    const files: SourceFile[] = [
      { path: "moderation/repo.ts", source: `import { decisions, notifierContacts, type Db } from "@korbat/db";` },
      { path: "moderation/decide.ts", source: `import type { staffPersonalAccounts as links, users } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: `import * as db from "@korbat/db";` },
      { path: "moderation/intake.ts", source: `import { createAuthRepo } from "../auth";` },
      { path: "moderation/reveal.ts", source: `const { createSessions } = await import("../auth");` },
    ];
    expect(findViolations(files, new Set(["decisions"]), new Set(["notifierContacts", "staffPersonalAccounts", "users"]))).toEqual([
      "moderation/repo.ts: imports auth-schema notifierContacts from @korbat/db",
      "moderation/decide.ts: imports auth-schema staffPersonalAccounts from @korbat/db",
      "moderation/decide.ts: imports auth-schema users from @korbat/db",
      "moderation/cases.ts: namespace import of @korbat/db (import public-schema names explicitly)",
      "moderation/intake.ts: uses the auth module's createAuthRepo (the moderation module goes through the auth module's interface)",
      "moderation/reveal.ts: uses the auth module's createSessions (the moderation module goes through the auth module's interface)",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });
});
```

### Replace `apps/api/test/integration/http-media.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, HealthResponse, MEDIA_MAX_BYTES, MediaStatusResponse, MediaView, PostView, TimelinePage, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { uploadsLayout } from "@korbat/media-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";

type App = ReturnType<typeof createApp>;

/**
 * Images through the real app: 1a sign-up for the accounts, cookie sessions with CSRF, the media and
 * social modules wired as the server wires them, and a stand-in for the worker on the store directory.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: images over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-media-"));
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();
  let offsetMs = 0;
  let tick = 0;
  const now = () => new Date(Date.now() + offsetMs + ++tick);

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore(() => now().getTime());
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: uploads.root,
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
      now,
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, advisoryChecks: { image_worker: media.healthCheck }, auth, social, media });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await closeDecisions();
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `media-${randomUUID()}@korbat.local`;
    const handle = `m${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    return { b, handle };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const jpeg = { type: "image/jpeg", body: BYTES.jpeg };

  /** Uploads an image and lets the stand-in worker accept it. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: jpeg });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }

  test("upload, wait, post, and read the image back, signed in and signed out", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const sent = await ada.b.fetch("/api/media", { raw: jpeg });
    expect(sent.status).toBe(202);
    const { id } = UploadResponse.parse(await sent.json());
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${id}`)).json())).toEqual({ id, status: "processing" });
    expect((await app.request(`/api/media/${id}/large.webp`)).status).toBe(404);

    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${id.toUpperCase()}`)).json())).toMatchObject({ id, status: "ready", width: 1200, height: 800 });
    expect(existsSync(uploads.upload(id))).toBe(false);

    const created = await ada.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id, alt: "  a harbour\n at dawn " }] } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());
    expect(post.media).toEqual([{ id, width: 1200, height: 800, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a harbour at dawn", small: `/api/media/${id}/small.webp`, large: `/api/media/${id}/large.webp` }]);

    const first = MediaView.parse(post.media[0]);
    const image = await app.request(first.large);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("cache-control")).toBe("public, max-age=300");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await image.text()).toBe(`large-webp-of-${id}`);
    const again = await app.request(first.large, { headers: { "if-none-match": image.headers.get("etag")! } });
    expect(again.status).toBe(304);

    const latest = TimelinePage.parse(await (await app.request("/api/timeline/latest?limit=50")).json());
    expect(latest.items.find((item) => item.post.id === post.id)?.post.media[0]).toMatchObject({ alt: "a harbour at dawn" });
  });

  test("uploads need a session, the CSRF token and the app's origin", async () => {
    const ada = await signUp();
    expect((await app.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: BYTES.jpeg })).status).toBe(401);
    const noToken = await ada.b.fetch("/api/media", { raw: jpeg, csrf: false });
    expect([noToken.status, await errorCode(noToken)]).toEqual([403, "csrf_failed"]);
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/media", { raw: jpeg });
    expect([crossOrigin.status, await errorCode(crossOrigin)]).toEqual([403, "csrf_failed"]);
  });

  test("refusals come back in the error envelope with the right status", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const svg = await ada.b.fetch("/api/media", { raw: { type: "image/svg+xml", body: Buffer.from("<svg/>") } });
    expect([svg.status, await errorCode(svg)]).toEqual([415, "unsupported_media_type"]);
    const disguised = await ada.b.fetch("/api/media", { raw: { type: "image/png", body: BYTES.pdf } });
    expect([disguised.status, await errorCode(disguised)]).toEqual([415, "unsupported_media_type"]);
    const heic = await ada.b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.heic } });
    expect(ErrorEnvelope.parse(await heic.json()).error.message).toMatch(/Export the photo as JPEG/);
    const declaredTooLarge = await ada.b.fetch("/api/media", { raw: jpeg, headers: { "content-length": String(MEDIA_MAX_BYTES + 1) } });
    expect([declaredTooLarge.status, await errorCode(declaredTooLarge)]).toEqual([413, "file_too_large"]);

    const id = await readyImage(ada.b);
    expect((await bob.b.fetch(`/api/media/${id}`)).status).toBe(404);
    expect((await bob.b.fetch(`/api/media/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await ada.b.fetch(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}`)).status).toBe(404);
    expect(existsSync(uploads.deletion(id))).toBe(true);
    expect((await ada.b.fetch("/api/media/not-an-id")).status).toBe(400);
  });

  test("a post takes only the author's own ready images, at most four, each described", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const bobs = await readyImage(bob.b);
    const stolen = await ada.b.fetch("/api/posts", { json: { body: "not mine", media: [{ id: bobs, alt: "x" }] } });
    expect([stolen.status, await errorCode(stolen)]).toEqual([400, "media_unavailable"]);

    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await readyImage(ada.b));
    const five = await ada.b.fetch("/api/posts", { json: { body: "too many", media: ids.map((id) => ({ id, alt: "x" })) } });
    expect([five.status, await errorCode(five)]).toEqual([400, "invalid_request"]);
    const undescribed = await ada.b.fetch("/api/posts", { json: { body: "no alt", media: [{ id: ids[0], alt: "   " }] } });
    expect([undescribed.status, await errorCode(undescribed)]).toEqual([400, "invalid_request"]);
    const empty = await ada.b.fetch("/api/posts", { json: { body: "  ", media: [] } });
    expect([empty.status, await errorCode(empty)]).toEqual([400, "invalid_request"]);

    const four = await ada.b.fetch("/api/posts", { json: { media: ids.slice(0, 4).map((id, i) => ({ id, alt: `image ${i + 1}` })) } });
    expect(four.status).toBe(201);
    expect(PostView.parse(await four.json())).toMatchObject({ body: "", media: [{ alt: "image 1" }, { alt: "image 2" }, { alt: "image 3" }, { alt: "image 4" }] });
  });

  test("images of a withheld post reach their author only; deleting a post takes its images with it, unless a case holds them", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const id = await readyImage(ada.b);
    const post = PostView.parse(await (await ada.b.fetch("/api/posts", { json: { body: "under review", media: [{ id, alt: "an image" }] } })).json());
    // The decision's case holds the post's image as evidence from the finding on.
    await decideForTest(apiDb, post.id, "withheld");

    const own = await ada.b.fetch(`/api/media/${id}/small.webp`);
    expect([own.status, own.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
    expect((await bob.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect((await app.request(`/api/media/${id}/small.webp`)).status).toBe(404);

    // The author deletes the post: the held image's row stays, the image is served to nobody, its status answers as
    // for an upload that does not exist, and no deletion of its files is requested.
    await decideForTest(apiDb, post.id, "visible");
    expect((await ada.b.fetch(`/api/posts/${post.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect((await ada.b.fetch(`/api/media/${id}`)).status).toBe(404);
    const [kept] = await apiDb.execute<{ held: boolean }>(sql`select hold_until > now() as held from post_media where id = ${id}::uuid`);
    expect(kept).toEqual({ held: true });
    expect(existsSync(uploads.deletion(id))).toBe(false);

    // A post that no case concerns: its image goes with it, and the worker is asked to delete the files.
    const other = await readyImage(ada.b);
    const plain = PostView.parse(await (await ada.b.fetch("/api/posts", { json: { body: "nobody reported this", media: [{ id: other, alt: "another image" }] } })).json());
    expect((await app.request(`/api/media/${other}/small.webp`)).status).toBe(200);
    expect((await ada.b.fetch(`/api/posts/${plain.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${other}/small.webp`)).status).toBe(404);
    expect(await apiDb.execute(sql`select 1 from post_media where id = ${other}::uuid`)).toHaveLength(0);
    expect(existsSync(uploads.deletion(other))).toBe(true);
    // The states come from real, confirmed decisions: a staff key's enrolment, a sign-in, and a step-up for each.
  }, 30_000);

  test("an account in its first day may upload 20 images an hour", async () => {
    offsetMs = 0;
    const newcomer = await signUp();
    for (let i = 0; i < 20; i++) expect((await newcomer.b.fetch("/api/media", { raw: jpeg })).status).toBe(202);
    const refused = await newcomer.b.fetch("/api/media", { raw: jpeg });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorCode(refused)).toBe("rate_limited");
    offsetMs = 3 * DAY_MS;
  });

  test("health names the image worker without turning the API unhealthy", async () => {
    worker.beat(now().getTime() - 5 * 60_000);
    const stale = await app.request("/api/health");
    expect(stale.status).toBe(200);
    expect(HealthResponse.parse(await stale.json())).toMatchObject({ status: "degraded", checks: { image_worker: "fail" } });
    worker.beat(now().getTime());
    expect(HealthResponse.parse(await (await app.request("/api/health")).json())).toMatchObject({ status: "ok", checks: { image_worker: "ok" } });
  });

  leavesNoModerationRows(() => apiDb);
});
```

### Replace `apps/api/test/integration/http-staff-decisions.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CaseDecisionResponse, ErrorEnvelope, StaffStepUpOptionsResponse, type AuthenticationResponseJSON, type CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { RULES_VERSION } from "@korbat/rules";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type ModerationForStaff } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { aPost, act, casesMedia, decisionParams, gate, ground, newPostRow, postRow, removeFixtures, rowCounts, uuids, type DecisionInput } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount, withLockTimeout } from "./staff-fixtures";

// Each test signs a staff key in over HTTP and confirms a decision with it: on a loaded machine that takes longer than
// the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/**
 * POST /api/staff/cases/:case/decisions through the real app (3c design, section 7.5, steps 1 to 3): the console's
 * browser signs in with a staff key, asks for step-up options over exactly the decision's params, has the key confirm
 * them, and posts the params with the assertion. Every decision here is confirmed by a real key, so the audit rows that
 * stay are ones audit-verify accepts; the posts, cases and decisions are removed again, and the file's last test holds it
 * to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: deciding a case over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createModeration>["deps"];
  let moderator: Awaited<ReturnType<typeof staffBrowser>>;
  let admin: Awaited<ReturnType<typeof staffBrowser>>;
  /** A moderator whose session began while the auth module's clock stood back, for the tests that issue a challenge with little time left. */
  let slow: Awaited<ReturnType<typeof staffBrowser>>;
  let before: Record<string, number>;
  const staffIds: string[] = [];
  /** How far the auth module's clock stands from the real one, in milliseconds; 0 but where a test sets it back. */
  let skewMs = 0;
  /** What a test runs inside the request, once the step-up verified and before the decision's transaction begins. */
  let insideRequest: (() => Promise<unknown>) | null = null;
  /** How often the route handed a verified confirmation to the moderation module. */
  let decides = 0;

  beforeAll(async () => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    // The real clock, unless a test sets it back: a decision's audit row is stamped by the database and held against the
    // challenge's expiry, which the auth module's clock sets.
    const clock = () => Date.now() + skewMs;
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), now: () => new Date(clock()) });
    const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: casesMedia(apiDb), config, logger });
    deps = moderation.deps;
    // The staff routes get the moderation module through a wrapper that counts the route's calls and lets a test act
    // inside the request, between the step-up's verification and the decision's own transaction.
    const observed: ModerationForStaff = {
      ...moderation.forStaff,
      decide: async (...args) => {
        decides++;
        const run = insideRequest;
        insideRequest = null;
        await run?.();
        return moderation.forStaff.decide(...args);
      },
    };
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: observed }) });
    moderator = await staffBrowser("moderator");
    admin = await staffBrowser("admin");
    // Signed in nine minutes and twenty seconds back: a challenge issued later under a clock set back by less still finds
    // this session begun.
    skewMs = -560_000;
    try {
      slow = await staffBrowser("moderator");
    } finally {
      skewMs = 0;
    }
    before = await rowCounts(apiDb);
  }, 120_000);
  afterAll(async () => {
    await migrateDb.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** A live staff account with a profile and one key enrolled through the flow, signed in from the console's browser. */
  async function staffBrowser(role: "moderator" | "admin") {
    const { user } = await newStaffAccount(authDb, repo, role);
    await apiDb.insert(profiles).values({ id: user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
    staffIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = consoleBrowser();
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    expect(options.status, await options.clone().text()).toBe(200);
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, keyId: enrolled.key.id, role, b, assert };
  }

  /** A committed post reported under this rule, with its open case. Everything is removed after `fn`. */
  async function withReported(fn: (made: { postId: string; caseId: string }) => Promise<void>, rule: "R1" | "R5" = "R1") {
    const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
    try {
      const postId = await newPostRow(apiDb, author.id);
      const recorded = await recordIntake(deps, { ground: ground.rule(reporter.id, rule), live: [aPost(postId)] });
      await fn({ postId, caseId: recorded.items[0]!.caseId! });
    } finally {
      await removeFixtures(migrateDb, [author.id, reporter.id]);
    }
  }
  /** The key's confirmation of exactly these params on the case, asked for as the console asks for it. */
  async function confirmation(s: typeof moderator, caseId: string, params: CaseDecidedParams): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: { action: "case_decided", target: { type: "case", id: caseId }, params }, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }
  const post = (s: typeof moderator, caseId: string, body: unknown) => s.b.fetch(`/api/staff/cases/${caseId}/decisions`, { json: body, headers: MARKED });
  /** The whole exchange: the params as the console builds them, the confirmation, and the decision's request. */
  async function decide(s: typeof moderator, caseId: string, input: DecisionInput) {
    const params = await decisionParams(apiDb, s, caseId, input);
    return post(s, caseId, { ...params, stepUp: await confirmation(s, caseId, params) });
  }
  const decisionsOf = async (caseId: string) => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions where case_id = ${caseId}::uuid`))[0]!.n;

  test("a confirmed decision is answered 201 with its id; it is stored with its measure and its audit row, and its author's mail is pending", async () => {
    await withReported(async ({ postId, caseId }) => {
      const res = await decide(moderator, caseId, { kind: "interim", actions: [act("withhold")] });
      expect(res.status, await res.clone().text()).toBe(201);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { decisionId } = CaseDecisionResponse.parse(await res.json());
      const [stored] = await apiDb.execute<Record<string, unknown>>(sql`
        select d.case_id, d.kind, d.outcome, d.decided_by, d.author_mail,
               (select count(*)::int from decision_actions a where a.decision_id = d.id and a.kind = 'withhold') as measures,
               (select count(*)::int from audit_log l where l.action = 'case_decided' and l.target_id = d.case_id::text and l.metadata ->> 'decisionId' = d.id::text and l.actor_id = d.decided_by and l.step_up is not null) as audits
          from decisions d where d.id = ${decisionId}::uuid`);
      expect({ ...stored! }).toEqual({ case_id: caseId, kind: "interim", outcome: "restricted", decided_by: moderator.id, author_mail: "pending", measures: 1, audits: 1 });
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
    });
  });

  test("it needs a staff session and the key's confirmation of exactly this decision on exactly this case", async () => {
    await withReported(async ({ postId, caseId }) => {
      await withReported(async (other) => {
        const params = await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] });
        const stepUp = await confirmation(moderator, caseId, params);
        // No session at all.
        const stranger = await consoleBrowser().fetch(`/api/staff/cases/${caseId}/decisions`, { json: { ...params, stepUp }, headers: MARKED, csrf: false });
        expect([stranger.status, (await error(stranger)).code]).toEqual([401, "staff_session_required"]);
        const answers: Record<string, [number, string]> = {};
        const refusedAs = async (label: string, res: Response) => void (answers[label] = [res.status, (await error(res)).code]);
        // No confirmation, and a member the params do not take.
        await refusedAs("no confirmation", await post(moderator, caseId, params));
        await refusedAs("a member the params do not take", await post(moderator, caseId, { ...params, extra: true, stepUp }));
        // The confirmation of this decision does not confirm another one: other params, another case, another person's session.
        await refusedAs("other params", await post(moderator, caseId, { ...params, category: "STATEMENT_CATEGORY_VIOLENCE", stepUp }));
        await refusedAs("another case", await post(moderator, other.caseId, { ...params, stepUp }));
        await refusedAs("another person's session", await post(admin, caseId, { ...params, stepUp }));
        expect(answers).toEqual({
          "no confirmation": [403, "staff_step_up_required"],
          "a member the params do not take": [400, "invalid_request"],
          "other params": [403, "staff_step_up_invalid"],
          "another case": [403, "staff_step_up_invalid"],
          "another person's session": [403, "staff_step_up_invalid"],
        });
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await decisionsOf(other.caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
        // A fresh confirmation of the same params still decides: nothing above spent the decision.
        const fresh = await confirmation(moderator, caseId, params);
        const res = await post(moderator, caseId, { ...params, stepUp: fresh });
        expect(res.status, await res.clone().text()).toBe(201);
        // And a confirmation decides once: its challenge is spent.
        const again = await post(moderator, caseId, { ...params, stepUp: fresh });
        expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
        expect(await decisionsOf(caseId)).toBe(1);
      });
    });
  });

  test("what the database refuses is answered with its code: a case that changed, a decision only an admin takes, a case that does not exist", async () => {
    await withReported(async ({ caseId }) => {
      // The case moved on since the console read it.
      const stale = await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] });
      expect((await decide(moderator, caseId, { kind: "interim", actions: [act("withhold")] })).status).toBe(201);
      const late = await post(moderator, caseId, { ...stale, stepUp: await confirmation(moderator, caseId, stale) });
      expect([late.status, (await error(late)).code]).toEqual([409, "case_changed"]);
      // A final decision on a report under R5 needs an admin.
      const refused = await decide(moderator, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect([refused.status, (await error(refused)).code]).toEqual([403, "admin_required"]);
      expect(await decisionsOf(caseId)).toBe(1);
      const taken = await decide(admin, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      expect(taken.status, await taken.clone().text()).toBe(201);
      // A case nobody has: the params are the console's, the id is not.
      const params = await decisionParams(apiDb, admin, caseId, { kind: "correction", reviewsDecisionId: CaseDecisionResponse.parse(await taken.json()).decisionId, actions: [act("restore")] });
      const nowhere = randomUUID();
      const missing = await post(admin, nowhere, { ...params, stepUp: await confirmation(admin, nowhere, params) });
      expect([missing.status, (await error(missing)).code]).toEqual([404, "not_found"]);
    }, "R5");
  });

  test("a key revoked, or an account demoted to user, between the confirmation and the decision's transaction ends the session: 401 with both staff cookies cleared, and nothing stored", async () => {
    type Staff = typeof moderator;
    const ends: [string, (s: Staff) => Promise<unknown>][] = [
      ["the key revoked", (s) => authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${s.keyId}::uuid`)],
      ["the account demoted to user", (s) => authDb.execute(sql`update auth.users set role = 'user' where id = ${s.id}::uuid`)],
    ];
    for (const [label, end] of ends) {
      const leaving = await staffBrowser("moderator");
      try {
        await withReported(async ({ postId, caseId }) => {
          const params = await decisionParams(apiDb, leaving, caseId, { kind: "interim", actions: [act("withhold")] });
          const stepUp = await confirmation(leaving, caseId, params);
          // The change is made inside the request, once requireStaff has read the session live and requireStaffStepUp has
          // verified the confirmation: only the decision's own audit statement can notice it.
          const ran = decides;
          insideRequest = () => end(leaving);
          const res = await post(leaving, caseId, { ...params, stepUp });
          expect(decides - ran, label).toBe(1);
          expect(insideRequest, label).toBeNull();
          expect(res.status, label).toBe(401);
          expect((await error(res.clone())).code, label).toBe("staff_session_required");
          const cleared = res.headers.getSetCookie().filter((line) => line.includes("Max-Age=0")).map((line) => line.slice(0, line.indexOf("=")));
          expect(cleared.sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
          expect(await decisionsOf(caseId), label).toBe(0);
          expect(await postRow(apiDb, postId), label).toMatchObject({ state: "visible", level: "visible" });
        });
      } finally {
        staffIds.splice(staffIds.indexOf(leaving.id), 1);
        await migrateDb.execute(sql`delete from profiles where id = ${leaving.id}::uuid`);
      }
    }
  });

  test("a decision under another rulebook than the API serves is answered 422 invalid_decision, and stores nothing", async () => {
    await withReported(async ({ caseId }) => {
      const params = { ...(await decisionParams(apiDb, moderator, caseId, { kind: "interim", actions: [act("withhold")] })), rulesVersion: RULES_VERSION - 1 };
      const ran = decides;
      const res = await post(moderator, caseId, { ...params, stepUp: await confirmation(moderator, caseId, params) });
      // The key confirmed it and the route handed it over: the moderation module refuses it before it reads or writes.
      expect(decides - ran).toBe(1);
      expect([res.status, (await error(res)).code]).toEqual([422, "invalid_decision"]);
      expect(await decisionsOf(caseId)).toBe(0);
    });
  });

  describe("a decision that waits for a lock", () => {
    /** The key's confirmation of the params, its challenge issued so that about `seconds` of its ten minutes are left now. */
    async function confirmationWithLeft(caseId: string, params: CaseDecidedParams, seconds: number) {
      skewMs = -(600 - seconds) * 1000;
      try {
        return await confirmation(slow, caseId, params);
      } finally {
        skewMs = 0;
      }
    }
    /**
     * Posts the decision while a transaction of the migrator holds the audit chain's head, which every decision's last
     * statement waits for, and notes each transaction it sees waiting there (by the time it began). `during` runs while the
     * request is under way and may let the head go; it goes in any case once the request is answered.
     */
    async function postBehindHead(caseId: string, body: unknown, during: (waiting: Set<string>, letGo: () => Promise<void>) => Promise<void>) {
      const [held, release] = [gate(), gate()];
      const holder = withLockTimeout(migrateDb, async (tx) => {
        await tx.execute(sql`select 1 from public.audit_head where id = 1 for update`);
        held.open();
        await release.opened;
      });
      await held.opened;
      const letGo = async () => {
        release.open();
        await holder;
      };
      const waiting = new Set<string>();
      let watching = true;
      const watch = (async () => {
        while (watching) {
          const rows = await apiDb.execute<{ began: string }>(
            sql`select xact_start::text as began from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like '%append_confirmed_audit%'`,
          );
          for (const row of rows) waiting.add(row.began);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      try {
        const posting = post(slow, caseId, body);
        await during(waiting, letGo);
        return { res: await posting, waiting };
      } finally {
        watching = false;
        await watch;
        await letGo();
      }
    }
    const until = async (condition: () => boolean, what: string) => {
      const deadline = Date.now() + 40_000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error(`nothing came of waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const withhold: DecisionInput = { kind: "interim", actions: [act("withhold")] };

    test("a lock timeout is retried once with the same confirmation, and the second run commits: 201 and one decision", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        const stepUp = await confirmationWithLeft(caseId, params, 75);
        const ran = decides;
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async (seen, letGo) => {
          // The first run's wait is bounded by a fifteenth of the 75 seconds left. The second run waits in a transaction
          // of its own; then the head is let go.
          await until(() => seen.size === 2, "the second run to wait for the head");
          await letGo();
        });
        expect(res.status, await res.clone().text()).toBe(201);
        expect(waiting.size).toBe(2);
        // One confirmation, handed over once: the second run is the moderation module's own.
        expect(decides - ran).toBe(1);
        expect(await decisionsOf(caseId)).toBe(1);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
      });
    });

    test("a second lock timeout is answered 400 challenge_expired, with nothing written", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        const stepUp = await confirmationWithLeft(caseId, params, 75);
        // The head is held through both runs.
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async () => undefined);
        expect([res.status, (await error(res)).code]).toEqual([400, "challenge_expired"]);
        expect(waiting.size).toBe(2);
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });

    test("a lock timeout met with a minute or less of the challenge left is not retried: 400 challenge_expired after the one run, with nothing written", async () => {
      await withReported(async ({ postId, caseId }) => {
        const params = await decisionParams(apiDb, slow, caseId, withhold);
        // 64 seconds: the step-up itself is refused within a minute of the expiry, so the decision starts with a little
        // more than that, and its one bounded wait, a fifteenth of what is left, ends with less than a minute to go.
        const stepUp = await confirmationWithLeft(caseId, params, 64);
        const { res, waiting } = await postBehindHead(caseId, { ...params, stepUp }, async () => undefined);
        expect([res.status, (await error(res)).code]).toEqual([400, "challenge_expired"]);
        expect(waiting.size).toBe(1);
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Replace `apps/api/test/integration/http-staff-enroll.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, StaffEnrollOptionsResponse, StaffEnrollVerifyResponse, type RegistrationResponseJSON } from "@korbat/contracts";
import { auditLog, closeDb, createDb, staffKeys, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge } from "../../src/auth/passkeys/challenge";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { decodeKey } from "../../src/auth/crypto";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator, type CborValue, type SoftCreateInput } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { casesMedia } from "./moderation-fixtures";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

/**
 * The enrolment routes over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090,
 * through the staff gate to the auth module's flows. Every refusal answers a staff code, never a passkey_* one, and no
 * answer carries CORS headers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the enrolment routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mailer: MemoryMailer;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer, profiles: createProfileStore(apiDb) });
    const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: casesMedia(apiDb), config, logger });
    const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: "__Host-korbat_staff_csrf", csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** The options for a link over HTTP, parsed as the console parses them. */
  async function options(b: Browser, token: string, kind: "security_key" | "this_device" = "security_key") {
    const res = await b.fetch("/api/staff/enroll/options", { json: { token, name: "Blue key", kind } });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = StaffEnrollOptionsResponse.parse(await res.json());
    // The contract checks the challenge alone and passes the rest to the browser's library, which knows its shape.
    return { rpShared: answer.rpShared, options: answer.options as unknown as PublicKeyCredentialCreationOptionsJSON };
  }

  const verify = (b: Browser, token: string, response: RegistrationResponseJSON) => b.fetch("/api/staff/enroll/verify", { json: { token, name: "Blue key", response } });

  test("a whole enrolment from the console's page: the options, the verification, the stored key and its mail", { timeout: 30_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const b = consoleBrowser();
    const answer = await options(b, enrolment.token);
    expect(answer.rpShared).toBe(false);
    expect(answer.options.rp.id).toBe(TEST_CONSOLE_RP_ID);
    const response = new SoftAuthenticator().create({
      rpId: TEST_CONSOLE_RP_ID,
      challenge: answer.options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(answer.options.user.id, "base64url"),
      flags: DEVICE_BOUND,
      transports: ["usb"],
    });
    const res = await verify(b, enrolment.token, response);
    expect(res.status, await res.clone().text()).toBe(200);
    expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { key } = StaffEnrollVerifyResponse.parse(await res.json());
    const [stored] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, key.id));
    expect(stored).toMatchObject({ userId: user.id, name: "Blue key", credentialId: response.id, origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID });
    // The key's audit row carries the request's id, which the access log carries too.
    const [row] = await migrateDb.select().from(auditLog).where(eq(auditLog.keyId, key.id));
    expect(row!.requestId).toBe(res.headers.get("x-request-id"));
    expect(mailer.sent.filter((m) => m.to === user.email).map((m) => m.template)).toEqual(["staff_key_added"]);
  });

  test("a spent challenge, one of another purpose, one bound to another enrolment and a bad signature are each staff_key_refused, never a passkey code, and the link still works", { timeout: 60_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const other = await newStaffAccount(authDb, repo);
    const otherEnrolment = await issueEnrolment(migrateDb, other.user.id);
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
    const create = (challenge: string, overrides: Partial<SoftCreateInput> = {}) =>
      auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND, ...overrides });

    // The first answer is refused on its flags, after its challenge was spent.
    const spent = create((await options(b, enrolment.token)).options.challenge, { flags: { up: true, uv: false, be: false, bs: false } });
    const first = await verify(b, enrolment.token, spent);
    expect([first.status, (await error(first)).code]).toEqual([403, "staff_key_not_user_verified"]);

    const cases: [string, RegistrationResponseJSON][] = [
      ["a spent challenge", spent],
      ["a staff sign-in challenge", create(issueChallenge(key, "staff_signin", new Date()))],
      ["a personal passkey's registration challenge", create(issueChallenge(key, "register", new Date(), enrolment.id))],
      ["a challenge bound to another enrolment", create((await options(b, otherEnrolment.token)).options.challenge)],
      [
        "a self attestation with a bad signature",
        create((await options(b, enrolment.token)).options.challenge, { fmt: "packed", attStmt: new Map<string | number, CborValue>([["alg", -7], ["sig", randomBytes(70)]]) }),
      ],
    ];
    for (const [label, response] of cases) {
      const res = await verify(b, enrolment.token, response);
      const { code, message } = await error(res);
      expect([label, res.status, code]).toEqual([label, 400, "staff_key_refused"]);
      expect(message, label).toContain("this link still works");
      expect(code, label).not.toMatch(/^passkey_/);
    }
    // Then a good answer on the same link.
    const good = create((await options(b, enrolment.token)).options.challenge);
    expect((await verify(b, enrolment.token, good)).status).toBe(200);
  });

  test("an unknown link and a spent one are each staff_enrollment_invalid at both steps", { timeout: 30_000 }, async () => {
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const unknown = await b.fetch("/api/staff/enroll/options", { json: { token: randomBytes(32).toString("base64url"), name: "Blue key", kind: "this_device" } });
    expect([unknown.status, (await error(unknown)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const response = auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
    const late = await verify(b, `${randomUUID().replace(/-/g, "")}${"a".repeat(11)}`, response);
    expect([late.status, (await error(late)).code]).toEqual([400, "staff_enrollment_invalid"]);

    // A link that has enrolled a key. The second answer was made on it before the first was sent, on a challenge of its own
    // that nothing spent, so only the link being spent can refuse it.
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const answer = async () => {
      const { options: creation } = await options(b, enrolment.token);
      return auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: creation.challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: Buffer.from(creation.user.id, "base64url"), flags: DEVICE_BOUND });
    };
    const first = await answer();
    const second = await answer();
    const enrolled = await verify(b, enrolment.token, first);
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);
    const again = await b.fetch("/api/staff/enroll/options", { json: { token: enrolment.token, name: "Blue key", kind: "security_key" } });
    expect([again.status, (await error(again)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const spent = await verify(b, enrolment.token, second);
    expect([spent.status, (await error(spent)).code]).toEqual([400, "staff_enrollment_invalid"]);
    expect(await migrateDb.select({ id: staffKeys.id }).from(staffKeys).where(eq(staffKeys.userId, user.id))).toHaveLength(1);
  });
});
```

### Replace `apps/api/test/integration/http-staff-sessions.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AuditPage,
  ErrorEnvelope,
  STAFF_STEP_UP_CHALLENGE,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffStepUpOptionsResponse,
  stepUpActionHash,
  stepUpBinding,
  type AuthenticationResponseJSON,
} from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, revokeStaffKeys, type Auth } from "../../src/auth";
import { decodeKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runGrantRole } from "../../src/cli/grant-role";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { fakeClock } from "./auth-fixtures";
import { Browser, randomIp } from "./http-client";
import { casesMedia } from "./moderation-fixtures";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { revokeRequest } from "./staff-step-up";

const CONSOLE_HOST = new URL(TEST_CONSOLE_ORIGIN).host;
const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/** The Set-Cookie lines of an answer, by cookie name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));
}

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

/** A response's signature with its last byte changed. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * Staff sessions over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090 signs
 * in with a staff key, and every staff request after it passes the staff gate and requireStaff, which reads the session
 * from the database each time. The auth module runs on a clock the tests move, so the idle and absolute ends are reached
 * without waiting.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sessions over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  const mailer = new MemoryMailer();
  const clock = fakeClock();

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock.ms), mailer, profiles: createProfileStore(apiDb), now: clock.now });
    const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: casesMedia(apiDb), config, logger });
    const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  /** A request to the console's host with exactly these headers, for what the browser above never sends. */
  const raw = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    app.request(`${TEST_CONSOLE_ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: CONSOLE_HOST, "cf-connecting-ip": randomIp(), ...init.headers } });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionRow = async (token: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.id, sha256Hex(token))))[0]!;
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;

  /** The 401 that ends a staff session in the console: staff_session_required, with both staff cookies cleared. */
  async function expectEnded(res: Response, label: string) {
    expect(res.status, label).toBe(401);
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
    for (const line of cookies.values()) {
      expect(line, label).toContain("Max-Age=0");
      expect(line, label).toContain("Path=/");
      expect(line, label).toContain("Secure");
    }
    expect((await error(res)).code, label).toBe("staff_session_required");
  }

  /**
   * A live staff account with a handle and one key enrolled through the flow, signed in from the console's browser with
   * Firefox's user agent. `signIn` signs in again, from any browser, with the next counter unless told one.
   */
  async function staffBrowser(role: "moderator" | "admin" = "moderator") {
    const { user, device } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    // The flows run on the moved clock: the link is valid 30 minutes from it, which is never earlier than the database's.
    const link = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) });
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    async function signIn(browser: Browser, options: { counter?: number; headers?: Record<string, string> } = {}) {
      const answer = await browser.fetch("/api/staff/signin/options", { method: "POST" });
      expect(answer.status, await answer.clone().text()).toBe(200);
      const { options: request } = StaffSignInOptionsResponse.parse(await answer.json());
      counter = options.counter ?? counter + 1;
      const response = soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: request.challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const res = await browser.fetch("/api/staff/signin/verify", { json: { response }, headers: options.headers });
      return { res, response };
    }
    const b = consoleBrowser();
    const first = await signIn(b, { headers: { "user-agent": FIREFOX_LINUX } });
    expect(first.res.status, await first.res.clone().text()).toBe(200);
    return { user, device, handle, soft, keyId: enrolled.key.id, credentialId: enrolled.credentialId, b, token: b.cookie(STAFF_COOKIE)!, signIn, first };
  }

  /**
   * The key's answer to step-up options for revoking the staff session `handle`, asked for from `s`'s browser as the
   * console asks for them, or over a challenge of the test's own.
   */
  async function confirmation(s: Awaited<ReturnType<typeof staffBrowser>>, handle: string, options: { counter: number; challenge?: string }) {
    let challenge = options.challenge;
    if (challenge === undefined) {
      const res = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(handle), headers: MARKED });
      expect(res.status, await res.clone().text()).toBe(200);
      challenge = StaffStepUpOptionsResponse.parse(await res.json()).options.challenge;
    }
    return s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: options.counter });
  }
  const revokeSession = (b: Browser, handle: string, stepUp?: AuthenticationResponseJSON) =>
    b.fetch(`/api/staff/sessions/${handle}`, { method: "DELETE", ...(stepUp ? { json: { stepUp } } : {}), headers: MARKED });

  describe("signing in", () => {
    test("sets both staff cookies, __Host-, Secure, Path=/, SameSite=Strict and 12 hours long, the session's HttpOnly; answers /me's body with no CORS header and no-store", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const res = s.first.res;
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      const session = cookies.get(STAFF_COOKIE)!;
      const csrf = cookies.get(STAFF_CSRF_COOKIE)!;
      expect(session).toMatch(/^__Host-korbat_staff=[A-Za-z0-9_-]{43};/);
      expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
      for (const line of [session, csrf]) {
        for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
        expect(line).not.toContain("Domain=");
      }
      expect(session).toContain("HttpOnly");
      expect(csrf).not.toContain("HttpOnly");
      // No app cookie is set on the console.
      expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") || line.startsWith("__Host-korbat_csrf="))).toBe(false);
      expect(accessControlHeaders(res)).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const me = StaffSignInVerifyResponse.parse(await res.json());
      const row = await sessionRow(s.token);
      expect(me).toMatchObject({ handle: s.handle, role: "moderator", sessionHandle: row.handle, idleSecondsLeft: 900, absoluteSecondsLeft: 43_200 });
      // The coarse label of the browser that signed in, never its user agent, as the session list and the mail show it.
      expect(row.browser).toBe("Firefox on Linux");
      expect(mailer.sent.filter((m) => m.to === s.user.email).map((m) => [m.template, m.data.browser])).toEqual([
        ["staff_key_added", undefined],
        ["staff_session_started", "Firefox on Linux"],
      ]);
    });

    test("one answer before the signature: a spent challenge, one of another purpose, one with another binding and a bad signature are staff_key_invalid, never a passkey code, and a bad signature on a live key reads as an unknown key", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const b = consoleBrowser();
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const fresh = async () => StaffSignInOptionsResponse.parse(await (await b.fetch("/api/staff/signin/options", { method: "POST" })).json()).options.challenge;
      const assert = (challenge: string, counter: number) =>
        s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const spentChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });

      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", assert(spentChallenge, 20)],
        ["the app's sign-in challenge", assert(issueChallenge(key, "signin", clock.now()), 21)],
        ["a staff registration challenge", assert(issueChallenge(key, "staff_register", clock.now(), randomUUID()), 22)],
        ["a staff sign-in challenge with a binding", assert(issueChallenge(key, "staff_signin", clock.now(), randomUUID()), 23)],
        ["a bad signature on a live key", badSignature(assert(await fresh(), 24))],
        ["an unknown key", stranger.get({ credentialId: unknown.id, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 })],
      ];
      const answers: Record<string, { status: number; code: string; message: string }> = {};
      for (const [label, response] of cases) {
        const res = await b.fetch("/api/staff/signin/verify", { json: { response } });
        const { code, message } = await error(res);
        answers[label] = { status: res.status, code, message };
        expect([label, res.status, code]).toEqual([label, 401, "staff_key_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(answers["a bad signature on a live key"]).toEqual(answers["an unknown key"]);
      expect((await migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, s.user.id))).length).toBe(1);
    });
  });

  describe("the person's own reads", () => {
    test("/me with the seconds left, /sessions with every live session and this one marked, /keys with the live keys and never a public key; no answer sets a cookie", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      // Another account's session is never listed, nor a key the account no longer holds.
      await staffBrowser();
      const red = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Red key" });
      const old = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Old key" });
      await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, old.key.id));
      clock.advance(MINUTE);

      for (const headers of [{}, MARKED]) {
        const me = await s.b.fetch("/api/staff/me", { headers });
        expect(me.status).toBe(200);
        expect(me.headers.getSetCookie()).toEqual([]);
        const body = StaffMe.parse(await me.json());
        expect(body.sessionHandle).toBe((await sessionRow(s.token)).handle);
        expect(body.absoluteSecondsLeft).toBe(12 * 60 * 60 - 60);
      }

      const sessions = await s.b.fetch("/api/staff/sessions");
      expect(sessions.headers.getSetCookie()).toEqual([]);
      const listed = StaffSessionsResponse.parse(await sessions.json()).sessions;
      const mine = await sessionRow(s.token);
      const theirs = await sessionRow(other.cookie(STAFF_COOKIE)!);
      expect(listed.map((x) => [x.handle, x.current, x.browser]).sort()).toEqual(
        [
          [mine.handle, true, "Firefox on Linux"],
          [theirs.handle, false, "Browser on unknown OS"],
        ].sort(),
      );
      // The other browser sees the same two, with its own marked.
      const fromOther = StaffSessionsResponse.parse(await (await other.fetch("/api/staff/sessions")).json()).sessions;
      expect(fromOther.find((x) => x.current)!.handle).toBe(theirs.handle);

      const keys = await s.b.fetch("/api/staff/keys");
      const text = await keys.clone().text();
      expect(StaffKeysResponse.parse(await keys.json()).keys.map((k) => [k.id, k.name])).toEqual([
        [s.keyId, "Blue key"],
        [red.key.id, "Red key"],
      ]);
      // The key that signed in shows when it was last used; nothing of any key's credential leaves the server.
      const [blue] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, s.keyId));
      expect(text).toContain(blue!.lastUsedAt!.toISOString());
      for (const secret of [blue!.publicKey, blue!.credentialId]) expect(text).not.toContain(secret);
    });
  });

  describe("the idle and absolute limits", () => {
    test("only marked requests count: unmarked reads neither slide the idle end nor move last_used_at, so the session ends 15 minutes after the last marked one", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t0 = (await sessionRow(s.token)).createdAt.getTime();
      clock.advance(10 * MINUTE);
      const unmarked = await s.b.fetch("/api/staff/me");
      expect(StaffMe.parse(await unmarked.json()).idleSecondsLeft).toBe(5 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0), idleExpiresAt: new Date(t0 + 15 * MINUTE) });

      clock.advance(4 * MINUTE);
      const marked = await s.b.fetch("/api/staff/me", { headers: MARKED });
      expect(StaffMe.parse(await marked.json()).idleSecondsLeft).toBe(15 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // Any other value of the header marks nothing.
      clock.advance(MINUTE);
      expect((await s.b.fetch("/api/staff/sessions", { headers: { "x-staff-activity": "true" } })).status).toBe(200);
      clock.advance(13 * MINUTE);
      expect((await s.b.fetch("/api/staff/keys")).status).toBe(200);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // At the idle end, the next request is refused and the cookies cleared; a marked one revives nothing.
      clock.advance(MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me"), "at the idle end");
      expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), "marked, after the idle end");
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE), revokedAt: null });
    });

    test("a marked request slides the idle end, never past the absolute end, which ends the session after 12 hours whatever its person does", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const t0 = row.createdAt.getTime();
      expect(row.absoluteExpiresAt).toEqual(new Date(t0 + 12 * HOUR));
      // A marked request every 14 minutes for 11 hours and 54 minutes.
      for (let i = 0; i < 51; i++) {
        clock.advance(14 * MINUTE);
        expect((await s.b.fetch("/api/staff/me", { headers: MARKED })).status, `request ${i}`).toBe(200);
      }
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 714 * MINUTE), idleExpiresAt: new Date(t0 + 12 * HOUR) });
      const me = StaffMe.parse(await (await s.b.fetch("/api/staff/me", { headers: MARKED })).json());
      expect([me.idleSecondsLeft, me.absoluteSecondsLeft]).toEqual([6 * 60, 6 * 60]);
      expect(me.idleExpiresAt).toBe(me.absoluteExpiresAt);
      clock.advance(6 * MINUTE);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "unmarked, at the absolute end");
      await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), "at the absolute end");
    });
  });

  describe("every way a session ends, refused at its next request", () => {
    type Ender = [string, (s: Awaited<ReturnType<typeof staffBrowser>>) => Promise<void>];
    const enders: Ender[] = [
      ["a revocation by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, s.keyId))],
      ["a revocation of every key by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, "all"))],
      [
        "a counter that went backwards in another browser",
        async (s) => {
          const { res } = await s.signIn(consoleBrowser(), { counter: 1 });
          expect((await error(res)).code).toBe("staff_key_suspended");
        },
      ],
      ["a demotion by grant-role", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "user"))],
      ["a change from moderator to admin", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "admin"))],
      ["the account's take-down", async (s) => void (await repo.takeDown(s.user.id, clock.now(), null))],
      // Changes that revoke nothing: the session is read with its key and its account at every request, so no tombstone is needed.
      ["its key revoked in the database alone", async (s) => void (await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId)))],
      ["the account's role set to user in the database alone", async (s) => void (await authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id)))],
      ["the account marked deleted in the database alone", async (s) => void (await authDb.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, s.user.id)))],
      ["the session revoked in the database", async (s) => void (await authDb.update(staffSessions).set({ revokedAt: clock.now() }).where(eq(staffSessions.id, sha256Hex(s.token))))],
      [
        "a revocation confirmed with the key in another browser",
        async (s) => {
          const other = consoleBrowser();
          expect((await s.signIn(other)).res.status).toBe(200);
          const handle = (await sessionRow(s.token)).handle;
          const stepUp = await confirmation({ ...s, b: other }, handle, { counter: 3 });
          expect((await revokeSession(other, handle, stepUp)).status).toBe(204);
        },
      ],
      [
        "a counter that went backwards at a step-up",
        async (s) => {
          const handle = (await sessionRow(s.token)).handle;
          const res = await revokeSession(s.b, handle, await confirmation(s, handle, { counter: 1 }));
          expect([res.status, (await error(res)).code]).toEqual([403, "staff_key_suspended"]);
        },
      ],
    ];
    for (const [label, end] of enders) {
      test(label, { timeout: 30_000 }, async () => {
        const s = await staffBrowser();
        expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
        await end(s);
        // Both of requireStaff's reads refuse it: the plain read (no mark, as the console's idle timer and 3c's refreshes
        // read) and the marked one, which slides the idle end in the same statement. Each is sent with the token by hand,
        // since the first 401 clears the browser's cookies; then the browser's own request.
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), `${label}, unmarked`);
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), `${label}, marked`);
        await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), label);
        expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE)).toBeUndefined();
      });
    }

    test("signing out: 204, both cookies cleared, the session revoked with staff_signed_out and its audit row, and no mail", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const sent = mailer.sent.length;
      const before = await head();
      clock.advance(MINUTE);
      const res = await s.b.fetch("/api/staff/signout", { method: "POST" });
      expect(res.status).toBe(204);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      for (const line of cookies.values()) expect(line).toContain("Max-Age=0");
      expect((await sessionRow(s.token)).revokedAt).toEqual(clock.now());

      const [event] = await migrateDb
        .select({ metadata: authEvents.metadata })
        .from(authEvents)
        .where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_signed_out")));
      expect(event!.metadata).toEqual({ handle: row.handle });
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.requestId, r.metadata])).toEqual([
        ["staff_signed_out", s.user.id, "staff_session", row.handle, row.handle, s.keyId, res.headers.get("x-request-id"), {}],
      ]);
      expect(mailer.sent.length).toBe(sent);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "after signing out");
      // Signing out again is a session that has ended.
      await expectEnded(await raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=x`, "x-staff-csrf": "x" } }), "signing out twice");
    });
  });

  describe("revoking a session, confirmed with the staff key", () => {
    test("the options name the session's key alone over a challenge the console can check; DELETE with the confirmation answers 204, the session ends at its next request, and the row carries the request's id and the confirmation", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const request = revokeRequest(target.handle);

      const optionsRes = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
      expect(optionsRes.status).toBe(200);
      expect(accessControlHeaders(optionsRes)).toEqual([]);
      expect(optionsRes.headers.getSetCookie()).toEqual([]);
      const { options } = StaffStepUpOptionsResponse.parse(await optionsRes.json());
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
      expect(options.userVerification).toBe("required");
      // What the console checks before it asks for the key: the layout, the purpose, and the binding of its own session's
      // handle and the hash of what it sent.
      const actionHash = await stepUpActionHash(request);
      const challenge = Buffer.from(options.challenge, "base64url");
      const L = STAFF_STEP_UP_CHALLENGE;
      expect(challenge).toHaveLength(L.bytes);
      expect(challenge[L.purposeAt]).toBe(L.purpose);
      expect(challenge.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(mine.handle, actionHash)))).toBe(true);

      const stepUp = await confirmation(s, target.handle, { counter: 3, challenge: options.challenge });
      const before = await head();
      clock.advance(MINUTE);
      const res = await revokeSession(s.b, target.handle, stepUp);
      expect(res.status, await res.clone().text()).toBe(204);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(accessControlHeaders(res)).toEqual([]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toEqual(clock.now());
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
        [
          "staff_session_revoked",
          s.user.id,
          "staff_session",
          target.handle,
          mine.handle,
          s.keyId,
          actionHash,
          { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
          { params: {} },
          res.headers.get("x-request-id"),
        ],
      ]);
      await expectEnded(await other.fetch("/api/staff/me"), "the revoked session");
      expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
      // The person may end the session they ask from as well; it ends at its next request.
      expect((await revokeSession(s.b, mine.handle, await confirmation(s, mine.handle, { counter: 4 }))).status).toBe(204);
      await expectEnded(await s.b.fetch("/api/staff/me"), "the session that revoked itself");
    });

    test("without a confirmation the answer is staff_step_up_required; a body, target or options request the schemas refuse is invalid_request; without the staff CSRF header, csrf_failed; nothing changes", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const before = await head();
      for (const [label, init] of [
        ["no body", { method: "DELETE" }],
        ["an empty body", { method: "DELETE", json: {} }],
      ] as const) {
        const res = await s.b.fetch(`/api/staff/sessions/${target.handle}`, init);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "staff_step_up_required"]);
      }
      // Any assertion's shape will do for the schemas: the sign-in's is one.
      const shaped = s.first.response;
      for (const [label, path, body] of [
        ["a member the action's params do not take", `/api/staff/sessions/${target.handle}`, { all: true, stepUp: shaped }],
        ["a stepUp that is not an assertion", `/api/staff/sessions/${target.handle}`, { stepUp: { id: "x" } }],
        ["a handle that is not a uuid", "/api/staff/sessions/not-a-handle", { stepUp: shaped }],
      ] as const) {
        const res = await s.b.fetch(path, { method: "DELETE", json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      for (const [label, body] of [
        ["an action no step-up confirms", { ...revokeRequest(target.handle), action: "role_granted" }],
        ["another target type", { ...revokeRequest(target.handle), target: { type: "user", id: target.handle } }],
        ["params the action does not take", { ...revokeRequest(target.handle), params: { all: true } }],
        ["a target that is not a uuid", revokeRequest("not-a-handle")],
      ] as const) {
        const res = await s.b.fetch("/api/staff/step-up/options", { json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      // A write without the staff CSRF header is refused before the session is read, the options included.
      const stepUp = await confirmation(s, target.handle, { counter: 3 });
      expect((await s.b.fetch(`/api/staff/sessions/${target.handle}`, { method: "DELETE", json: { stepUp }, csrf: false })).status).toBe(403);
      expect((await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), csrf: false })).status).toBe(403);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The confirmation the refused write carried was never read, so it still confirms what it was given for.
      expect((await revokeSession(s.b, target.handle, stepUp)).status).toBe(204);
    });

    test("a spent challenge, one of another purpose, one with another binding and a bad signature are staff_step_up_invalid, never a passkey code; an expired one is challenge_expired", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const actionHash = await stepUpActionHash(revokeRequest(target.handle));
      const fresh = await confirmation(s, target.handle, { counter: 3 });
      const freshChallenge = JSON.parse(Buffer.from(fresh.response.clientDataJSON, "base64url").toString()).challenge as string;
      const signInChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const cases: [string, () => Promise<AuthenticationResponseJSON>][] = [
        // The library refuses it, after the challenge was spent: the same challenge signed well is then a spent one.
        ["a bad signature", async () => badSignature(fresh)],
        ["a spent step-up challenge", () => confirmation(s, target.handle, { counter: 4, challenge: freshChallenge })],
        ["the sign-in's challenge", () => confirmation(s, target.handle, { counter: 5, challenge: signInChallenge })],
        ["a staff sign-in challenge", () => confirmation(s, target.handle, { counter: 6, challenge: issueChallenge(key, "staff_signin", clock.now()) })],
        ["a re-authentication challenge for this session", () => confirmation(s, target.handle, { counter: 7, challenge: issueChallenge(key, "reauth", clock.now(), mine.handle) })],
        ["a step-up challenge for another session", () => confirmation(s, target.handle, { counter: 8, challenge: issueStepUpChallenge(key, clock.now(), target.handle, actionHash) })],
        [
          "a step-up challenge for another target",
          async () => confirmation(s, target.handle, { counter: 9, challenge: issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(mine.handle))) }),
        ],
      ];
      for (const [label, make] of cases) {
        const res = await revokeSession(s.b, target.handle, await make());
        const { code } = await error(res);
        expect([label, res.status, code]).toEqual([label, 403, "staff_step_up_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
      }
      const late = await confirmation(s, target.handle, { counter: 10 });
      clock.advance(10 * MINUTE);
      const expired = await revokeSession(s.b, target.handle, late);
      expect([expired.status, (await error(expired)).code]).toEqual([400, "challenge_expired"]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
    });

    test("another account's session is no session of the person's: 404, it lives on, and the confirmation is spent", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t = await staffBrowser();
      const theirs = await sessionRow(t.token);
      const before = await head();
      const stepUp = await confirmation(s, theirs.handle, { counter: 3 });
      const res = await revokeSession(s.b, theirs.handle, stepUp);
      expect([res.status, (await error(res)).code]).toEqual([404, "not_found"]);
      expect((await sessionRow(t.token)).revokedAt).toBeNull();
      expect((await t.b.fetch("/api/staff/me")).status).toBe(200);
      expect(await head()).toEqual(before);
      const again = await revokeSession(s.b, theirs.handle, stepUp);
      expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
    });

    test("a handle in upper case is invalid_request, for the options and for the revocation even with a confirmation bound to that spelling: the id is hashed as sent but recorded as the database writes it, so only that spelling is taken", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const upper = target.handle.toUpperCase();
      expect(upper).not.toBe(target.handle);
      const before = await head();
      const options = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(upper), headers: MARKED });
      expect(options.status, await options.clone().text()).toBe(400);
      expect((await error(options)).code).toBe("invalid_request");
      // The challenge such options would have carried, bound to the upper-case spelling and signed by the session's key.
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const bound = issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(upper)));
      const res = await revokeSession(s.b, upper, await confirmation(s, upper, { counter: 3, challenge: bound }));
      expect(res.status, await res.clone().text()).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The spelling the console reads from /sessions revokes it.
      expect((await revokeSession(s.b, target.handle, await confirmation(s, target.handle, { counter: 4 }))).status).toBe(204);
    });

    test("a session that ends inside the step-up is answered as requireStaff answers it, staff_session_required with both cookies cleared: its key revoked just before the options, or its key revoked or its account demoted between the confirmation and the action", { timeout: 60_000 }, async () => {
      type Staff = Awaited<ReturnType<typeof staffBrowser>>;
      const revokeKey = (s: Staff) => authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId));
      const demote = (s: Staff) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id));
      // Each change is made inside the request, after requireStaff read the session live: just before the options read
      // the session's key, or just before the revocation's transaction.
      const cases: [string, "findStaffKeyCredential" | "revokeConfirmedStaffSession", (s: Staff) => Promise<unknown>][] = [
        ["the key revoked before the options", "findStaffKeyCredential", revokeKey],
        ["the key revoked after the confirmation", "revokeConfirmedStaffSession", revokeKey],
        ["the account demoted after the confirmation", "revokeConfirmedStaffSession", demote],
      ];
      for (const [label, method, end] of cases) {
        const s = await staffBrowser();
        const other = consoleBrowser();
        expect((await s.signIn(other)).res.status, label).toBe(200);
        const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
        const stepUp = method === "revokeConfirmedStaffSession" ? await confirmation(s, target.handle, { counter: 3 }) : undefined;
        const flows = auth.deps.repo;
        const original = flows[method].bind(flows) as (...args: unknown[]) => Promise<unknown>;
        const spy = vi.spyOn(flows, method).mockImplementationOnce((async (...args: unknown[]) => {
          await end(s);
          return original(...args);
        }) as never);
        try {
          const res = stepUp
            ? await revokeSession(s.b, target.handle, stepUp)
            : await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), headers: MARKED });
          expect(spy, label).toHaveBeenCalledOnce();
          await expectEnded(res, label);
        } finally {
          spy.mockRestore();
        }
        expect(s.b.cookie(STAFF_COOKIE), label).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE), label).toBeUndefined();
        expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt, label).toBeNull();
      }
    });
  });

  describe("what opens a staff route", () => {
    test("the staff cookie only: the app's session cookie and a bearer token are refused, a staff cookie opens no app route, and a session created after now is refused", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `__Host-korbat_session=${app_.token}` } }), "the app's session cookie");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${app_.token}` } }), "a bearer token");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${s.token}` } }), "the staff token as a bearer token");
      // The staff cookie under the app's name, and on the app's host, opens nothing there.
      const onApp = await app.request("/api/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(onApp.status).toBe(401);
      expect((await error(onApp)).code).toBe("unauthenticated");
      const asApp = await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(asApp.status).toBe(401);

      // A row written behind the flows' back that starts in the future, within the database's 12 hours.
      const token = randomToken();
      const start = new Date(clock.ms() + HOUR);
      await authDb.insert(staffSessions).values({
        id: sha256Hex(token),
        userId: s.user.id,
        keyId: s.keyId,
        createdAt: start,
        lastUsedAt: start,
        idleExpiresAt: new Date(start.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(start.getTime() + 12 * HOUR),
        browser: "Firefox on Linux",
      });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${token}` } }), "a session created after now");
    });

    test("CSRF: a write needs x-staff-csrf equal to the staff CSRF cookie; the app's CSRF cookie and header do not count, and a refused write touches nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const before = await sessionRow(s.token);
      clock.advance(MINUTE);
      const post = (headers: Record<string, string>) => raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, ...MARKED, ...headers } });
      const cases: [string, Record<string, string>][] = [
        ["no header", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}` }],
        ["another value", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`, "x-staff-csrf": `${csrf.slice(1)}A` }],
        ["the header without its cookie", { cookie: `${STAFF_COOKIE}=${s.token}`, "x-staff-csrf": csrf }],
        ["the app's CSRF cookie and header", { cookie: `${STAFF_COOKIE}=${s.token}; __Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf }],
      ];
      for (const [label, headers] of cases) {
        const res = await post(headers);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect((await s.b.fetch("/api/staff/signout", { method: "POST", csrf: false })).status).toBe(403);
      expect(await sessionRow(s.token)).toEqual(before);
      expect((await s.b.fetch("/api/staff/signout", { method: "POST" })).status).toBe(204);
    });
  });

  describe("the staff gate over HTTP", () => {
    test("a console POST sent with the app's session and CSRF cookies present reaches its route and is not csrf_failed", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const res = await raw("/api/staff/signout", {
        method: "POST",
        headers: {
          origin: TEST_CONSOLE_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: `__Host-korbat_session=${app_.token}; __Host-korbat_csrf=app-csrf; ${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`,
          "x-csrf-token": "app-csrf",
          "x-staff-csrf": csrf,
        },
      });
      expect(res.status, await res.clone().text()).toBe(204);
      expect((await sessionRow(s.token)).revokedAt).not.toBeNull();
      // The app's session was neither read nor ended.
      expect(await repo.findActiveSession(app_.session.sessionId, clock.now())).toBeDefined();
    });

    test("no answer under /api/staff/ carries an Access-Control-* header, even to an Origin the app trusts", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const trusted = config.TRUSTED_ORIGINS[0]!;
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, path, init] of [
        ["a read with the trusted Origin", "/api/staff/me", { headers: { cookie, origin: trusted } }],
        ["a preflight from the trusted Origin", "/api/staff/signout", { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
        ["a read of the audit log", "/api/staff/audit", { headers: { cookie } }],
        ["a read with the console's Origin", "/api/staff/sessions", { headers: { cookie, origin: TEST_CONSOLE_ORIGIN } }],
        ["the sign-in options", "/api/staff/signin/options", { method: "POST", headers: { origin: trusted } }],
        // The case routes of sub-project 3c stand behind the same gate.
        ["a decision on a case, from the trusted Origin", `/api/staff/cases/${randomUUID()}/decisions`, { method: "POST", headers: { cookie, origin: trusted } }],
        ["a preflight for a decision on a case", `/api/staff/cases/${randomUUID()}/decisions`, { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
      ] as const) {
        const res = await raw(path, init);
        expect(accessControlHeaders(res), label).toEqual([]);
      }
      expect(accessControlHeaders(s.first.res)).toEqual([]);
    });

    test("Sec-Fetch-Site other than same-origin, or another Origin, is refused and leaves the idle end and the last use unchanged; another Host is the unknown route", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const before = await sessionRow(s.token);
      clock.advance(5 * MINUTE);
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, headers] of [
        ["same-site", { "sec-fetch-site": "same-site" }],
        ["cross-site", { "sec-fetch-site": "cross-site" }],
        ["the app's Origin", { origin: "http://localhost:8081" }],
        ["another localhost port", { origin: "http://localhost:8090" }],
      ] as const) {
        const res = await raw("/api/staff/me", { headers: { cookie, ...MARKED, ...headers } });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
      // Another Host, the console's cookie and mark notwithstanding: the 404 of an unknown route, the session untouched.
      for (const host of ["localhost:8080", "console.localhost", "localhost:8090"]) {
        const res = await app.request(`http://${host}/api/staff/me`, { headers: { host, cookie, ...MARKED, "cf-connecting-ip": randomIp() } });
        expect([host, res.status, (await error(res)).code]).toEqual([host, 404, "not_found"]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
    });
  });

  describe("the audit log", () => {
    test("newest first by place, the sign-in's row naming its actor by handle; the staff_sign_in filter, cursor pages and ?at=; reading writes nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const [signInRow] = await migrateDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "staff_sign_in"), eq(auditLog.actorId, s.user.id)));
      const before = await head();

      const page = AuditPage.parse(await (await s.b.fetch("/api/staff/audit")).json());
      expect(page.entries[0]!.seq).toBe(before.seq);
      expect(page.entries.map((e) => e.seq)).toEqual([...page.entries.map((e) => e.seq)].sort((a, b) => b - a));
      const mine = page.entries.find((e) => e.seq === signInRow!.chainSeq)!;
      expect(mine).toEqual({
        seq: signInRow!.chainSeq,
        hash: signInRow!.hash,
        createdAt: signInRow!.createdAt.toISOString(),
        actorHandle: s.handle,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: signInRow!.targetId,
        actionHash: null,
      });

      const signIns = AuditPage.parse(await (await s.b.fetch("/api/staff/audit?action=staff_sign_in")).json());
      expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
      expect(signIns.entries[0]!.seq).toBe(signInRow!.chainSeq);

      const at = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?at=${signInRow!.chainSeq}`)).json());
      expect(at.entries[0]!.seq).toBe(signInRow!.chainSeq);
      const older = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?cursor=${signInRow!.chainSeq}`)).json());
      expect(older.entries.every((e) => e.seq < signInRow!.chainSeq)).toBe(true);

      for (const query of ["?at=0", "?cursor=2&at=2", "?action=role_granted", "?cursor=abc"]) {
        const res = await s.b.fetch(`/api/staff/audit${query}`);
        expect([query, res.status, (await error(res)).code]).toEqual([query, 400, "invalid_request"]);
      }
      expect(await head()).toEqual(before);
      await expectEnded(await raw("/api/staff/audit"), "without a session");
    });
  });
});
```

### Replace `apps/api/test/integration/media-sealed.test.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MediaStatusResponse, mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { mediaForAccount } from "../../src/media";
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
 * The image readers fail closed (3c design, sections 5 and 7.10, gate S): an image in the state `sealed` is served,
 * listed with content and exported to nobody, its author included, and its status carries no blurhash; an image follows
 * its own state as well as its post's; and a kept image of a deleted post, and an erased one, reach nobody. Only the migrator-owned
 * moderation_apply writes an image's moderation state, from a decision's ledger; these tests are about the readers, so
 * each runs as the migrator inside one transaction that is rolled back: it makes its accounts, posts and images there,
 * sets the state by hand, and runs the readers on that same transaction. A sealed image that no decision sealed never
 * reaches the database's other readers, and the file's last test holds it to leaving no row behind.
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
  /** Sets the images' moderation state as the migrator, which stands in for a seal's decision. */
  const seal = (tx: DbTx, mediaIds: readonly string[]) => tx.execute(sql`update post_media set moderation_state = 'sealed' where id = any(${`{${mediaIds.join(",")}}`}::uuid[])`);
  /** The same for one image and another state: what a decision on that image alone leaves. */
  const setState = (tx: DbTx, mediaId: string, state: "withheld" | "removed") => tx.execute(sql`update post_media set moderation_state = ${state}::media_moderation_state where id = ${mediaId}::uuid`);
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

  test("forPosts lists each image with its state, and a sealed one as its id and its state only: no size, no blurhash, no alt text, no path", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 3);
      const listed = async () => (await h.deps.repo.forPosts([postId])).get(postId) ?? [];
      const whole = (id: string, position: number, state: string) => ({ id, state, width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3~qoL", alt: `image ${position + 1}`, small: mediaPath(id, "small"), large: mediaPath(id, "large") });
      expect(await listed()).toEqual(mediaIds.map((id, position) => whole(id, position, "visible")));
      await seal(tx, [mediaIds[1]!]);
      expect(await listed()).toEqual([whole(mediaIds[0]!, 0, "visible"), { id: mediaIds[1], state: "sealed" }, whole(mediaIds[2]!, 2, "visible")]);
      // A withheld and a removed image are listed whole, with their state: who is shown them is the view builder's to say.
      await setState(tx, mediaIds[0]!, "withheld");
      await setState(tx, mediaIds[2]!, "removed");
      expect(await listed()).toEqual([whole(mediaIds[0]!, 0, "withheld"), { id: mediaIds[1], state: "sealed" }, whole(mediaIds[2]!, 2, "removed")]);
      await seal(tx, mediaIds);
      expect(await listed()).toEqual(mediaIds.map((id) => ({ id, state: "sealed" })));
    });
  });

  test("forPosts never gives an image of a deleted post, an erased image or an image of a post whose content was erased", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const deleted = await h.postWithImages(ada.id, 2);
      const partly = await h.postWithImages(ada.id, 2);
      const erased = await h.postWithImages(ada.id, 1);
      // The rows of the deleted post are kept, as a hold or a freeze keeps them; the marks are what an R4 redaction leaves.
      await h.setPostState(deleted.postId, "deleted_by_author");
      await tx.execute(sql`update post_media set erased_at = now() where id = ${partly.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now() where id = ${erased.postId}::uuid`);
      const listed = await h.deps.repo.forPosts([deleted.postId, partly.postId, erased.postId]);
      expect([...listed.keys()]).toEqual([partly.postId]);
      expect(listed.get(partly.postId)!.map((image) => image.id)).toEqual([partly.mediaIds[1]]);
      // The rows are all there: only the reader does not give them.
      const all = [...deleted.mediaIds, ...partly.mediaIds, ...erased.mediaIds];
      expect(await h.deps.repo.existing(all)).toEqual(new Set(all));
    });
  });

  test.each(["withheld", "removed"] as const)("an image that is itself %s on a visible post is served to its author only, never cached, and to nobody else", async (state) => {
    await inWorld(async (h, tx) => {
      const [ada, bob] = [await h.established(), await h.established()];
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      await setState(tx, mediaIds[0]!, state);
      expect(await ask(h.deps, mediaIds[0]!, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
      for (const viewer of [bob.id, null]) expect((await ask(h.deps, mediaIds[0]!, viewer)).kind, String(viewer)).toBe("not_found");
      // The post's other image stays public.
      expect(await ask(h.deps, mediaIds[1]!, null)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });
    });
  });

  test("serve answers an erased image, an image of a post whose content was erased and a kept image of a deleted post as not found, to their author too", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const own = await h.postWithImages(ada.id, 1);
      const ofPost = await h.postWithImages(ada.id, 1);
      const deleted = await h.postWithImages(ada.id, 1);
      await tx.execute(sql`update post_media set erased_at = now() where id = ${own.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now(), state = 'removed' where id = ${ofPost.postId}::uuid`);
      await h.setPostState(deleted.postId, "deleted_by_author");
      for (const id of [own.mediaIds[0]!, ofPost.mediaIds[0]!, deleted.mediaIds[0]!]) {
        for (const viewer of [ada.id, null]) expect((await ask(h.deps, id, viewer)).kind, `${id} ${String(viewer)}`).toBe("not_found");
      }
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

  test("readyImages keeps the author's withheld and removed images, and leaves out an image of a deleted post, an erased image and an image of an erased post", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const kept = await h.postWithImages(ada.id, 2);
      const deleted = await h.postWithImages(ada.id, 1);
      const partly = await h.postWithImages(ada.id, 2);
      const erased = await h.postWithImages(ada.id, 1);
      const upload = await h.readyImage(ada.id);
      await setState(tx, kept.mediaIds[0]!, "withheld");
      await setState(tx, kept.mediaIds[1]!, "removed");
      await h.setPostState(deleted.postId, "deleted_by_author");
      await tx.execute(sql`update post_media set erased_at = now() where id = ${partly.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now() where id = ${erased.postId}::uuid`);
      expect(await h.deps.repo.readyImages(ada.id)).toEqual([...kept.mediaIds, partly.mediaIds[1], upload]);
    });
  });

  test("the export opens a file only for an image its list would still name: one sealed, erased or deleted with its post since the list was read is not opened", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const sealed = await h.postWithImages(ada.id, 1);
      const deleted = await h.postWithImages(ada.id, 1);
      const erased = await h.postWithImages(ada.id, 1);
      const still = await h.postWithImages(ada.id, 1);
      // The list is read first, as the export reads it before the archive's first byte.
      const images = await mediaForAccount(h.deps).exportImages(ada.id);
      expect(images.map((image) => image.id)).toEqual([...sealed.mediaIds, ...deleted.mediaIds, ...erased.mediaIds, ...still.mediaIds]);
      await seal(tx, sealed.mediaIds);
      await h.setPostState(deleted.postId, "deleted_by_author");
      await tx.execute(sql`update post_media set erased_at = now() where id = ${erased.mediaIds[0]!}::uuid`);
      const opened: (number | null)[] = [];
      for (const image of images) {
        const file = await image.open();
        opened.push(file ? file.size : null);
        await file?.handle.close();
      }
      expect(opened).toEqual([null, null, null, `large-webp-of-${still.mediaIds[0]}`.length]);
      // Another account's id opens nothing through this account's list.
      expect(await h.deps.repo.isExportable((await h.established()).id, still.mediaIds[0]!)).toBe(false);
      expect(await h.deps.repo.isExportable(ada.id, still.mediaIds[0]!)).toBe(true);
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

### Replace `apps/api/test/integration/moderation-decide.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import { beforeAll, expect, test } from "vitest";
import type { CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { createAuthRepo } from "../../src/auth/repo";
import { verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { createModeration, type DecideOutcome } from "../../src/moderation";
import { recordIntake } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { act, casesMedia, decisionParams, ground, moderationCounts, removeDecided, uuids, type DecisionInput, type TestStaff } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { signedIn, stepUpAssertion } from "./staff-step-up";

/**
 * Decisions that commit (3c design, section 12). A committed decision carries an audit row for good, and audit-verify
 * refuses every case_decided row whose step-up is not a real assertion of its actor's staff key over exactly that action.
 * So a test that commits a decision confirms it as the console does: a staff account with a key enrolled through the
 * enrolment flow on the software authenticator, a staff session opened by the sign-in flow, step-up options for the
 * action, the authenticator's assertion, the auth module's verification, and then the moderation module's decide.
 */

/** A staff account whose key the software authenticator holds, signed in at the test console. */
export interface RealStaff extends TestStaff {
  handle: string;
  soft: SoftAuthenticator;
  credentialId: string;
  session: ActiveStaffSession;
  /** The signature counter the authenticator last reported; each use reports the next. */
  counter: number;
}

export interface DeciderWorld {
  authDb: Db;
  migrateDb: Db;
  /** The moderation module on the API's pool, as the server builds it. */
  moderation: ReturnType<typeof createModeration>;
  /** A new staff account with a profile, a real key and a staff session. */
  staff(role?: "moderator" | "admin"): Promise<RealStaff>;
  /** A verified confirmation of exactly these params, by the member's own key in the member's session. */
  confirm(member: RealStaff, caseId: string, params: CaseDecidedParams): Promise<StaffStepUpConfirmed>;
  /** A whole confirmed decision on the case: the params as the console builds them, the confirmation, and decide. */
  decideAs(member: RealStaff, caseId: string, input?: DecisionInput): Promise<DecideOutcome>;
  /** Removes the staff profiles this world made (their decisions, findings and texts must be gone by then) and closes its pools. */
  close(options?: { keepStaff?: boolean }): Promise<void>;
}

export function deciderWorld(apiDb: Db): DeciderWorld {
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  // The migrate role issues enrolment links, which only it may; the test environment carries its URL.
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const h = flowHarness(repo, { console: TEST_CONSOLE });
  const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: casesMedia(apiDb), config, logger: pino({ level: "silent" }) });
  const members: RealStaff[] = [];
  /**
   * The harness's clock stands still unless moved, and a step-up challenge lives ten minutes from it; the audit row is
   * stamped by the database's clock. So the harness's clock is brought to the real time before every flow.
   */
  const sync = () => h.clock.advance(Date.now() - h.clock.ms());

  async function staff(role: "moderator" | "admin" = "moderator"): Promise<RealStaff> {
    sync();
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `st_${randomBytes(5).toString("hex")}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    const enrolled = await enrolKey(h, soft, (await issueEnrolment(migrateDb, user.id)).token);
    const { session } = await signedIn(h, soft, enrolled.credentialId, 1);
    const member: RealStaff = { id: user.id, keyId: enrolled.key.id, role, handle, soft, credentialId: enrolled.credentialId, session, counter: 1 };
    members.push(member);
    return member;
  }

  async function confirm(member: RealStaff, caseId: string, params: CaseDecidedParams): Promise<StaffStepUpConfirmed> {
    sync();
    const request = { action: "case_decided" as const, target: { type: "case" as const, id: caseId }, params };
    const stepUp = await stepUpAssertion(h, member.soft, member.credentialId, member.session, request, { counter: ++member.counter });
    return verifyStepUp(h.deps, member.session, request, stepUp, { ...h.ctx, requestId: `req-${randomUUID()}` });
  }

  async function decideAs(member: RealStaff, caseId: string, input: DecisionInput = {}): Promise<DecideOutcome> {
    const params = await decisionParams(apiDb, member, caseId, input);
    return moderation.forStaff.decide(member.session, await confirm(member, caseId, params), { requestId: `req-${randomUUID()}` });
  }

  async function close(options: { keepStaff?: boolean } = {}): Promise<void> {
    try {
      if (!options.keepStaff && members.length > 0) await migrateDb.execute(sql`delete from profiles where id = any(${uuids(members.map((member) => member.id))})`);
    } finally {
      await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
    }
  }

  return { authDb, migrateDb, moderation, staff, confirm, decideAs, close };
}

// ---------------------------------------------------------------- decideForTest

let world: DeciderWorld | null = null;
let admin: Promise<RealStaff> | null = null;
/** The posts decideForTest decided in this test file. */
const decidedPosts = new Set<string>();

/** The id of a committed decision, or a failure that says why none committed. */
function decided(outcome: DecideOutcome, what: string): string {
  if (typeof outcome === "string") throw new Error(`decideForTest: ${what} was not recorded (${outcome})`);
  return outcome.decisionId;
}

/**
 * Puts a post into a moderation state the only way one comes about: by a real, confirmed decision (3c design, section
 * 12). The suites of posting, timelines, Explore and images used to write posts.state themselves; the posts' guard now
 * refuses that for the API role, and nothing but the ledger of measures moves a post's level.
 *
 * - `withheld`: an admin's own finding under R1 opens a case on the post, and an interim decision withholds it.
 * - `removed`: the same finding, and a final decision removes it, which closes the case.
 * - `visible`: what was done is undone: the post's open case is closed by a final decision that finds no breach, which
 *   ends its interim withhold, and every removal in force is reversed in full by a correction.
 *
 * It takes the API's pool. The staff account, its key and its session are made once for each test file; closeDecisions
 * removes what the decisions left.
 */
export async function decideForTest(apiDb: Db, postId: string, state: "withheld" | "removed" | "visible"): Promise<void> {
  world ??= deciderWorld(apiDb);
  admin ??= world.staff("admin");
  const [w, staff] = [world, await admin];
  decidedPosts.add(postId);
  if (state === "visible") {
    const [open] = await apiDb.execute<{ id: string }>(sql`select id from cases where target_type = 'post' and target_id = ${postId}::uuid and closed_at is null`);
    if (open) decided(await w.decideAs(staff, open.id, { kind: "final", outcome: "no_violation" }), "the closing decision");
    const removals = await apiDb.execute<{ decision_id: string; case_id: string }>(sql`select decision_id, case_id from measures_in_force where post_id = ${postId}::uuid and kind = 'remove'`);
    for (const removal of removals) {
      decided(await w.decideAs(staff, removal.case_id, { kind: "correction", reviewsDecisionId: removal.decision_id, actions: [act("restore")] }), "the correction");
    }
    return;
  }
  const recorded = await recordIntake(w.moderation.deps, { ground: ground.finding(staff.id, "R1"), live: [{ type: "post", id: postId, position: 1 }] });
  const caseId = recorded.items[0]!.caseId!;
  decided(await w.decideAs(staff, caseId, state === "withheld" ? { kind: "interim", actions: [act("withhold")] } : { kind: "final", actions: [act("remove")] }), `the decision that makes the post ${state}`);
}

/**
 * Removes what decideForTest committed in this test file, if it was used, and closes the pools it opened: the cases of
 * the posts it decided with their items, decisions, measures, texts, snapshots and intakes, and the staff account's
 * profile; the posts' levels are derived again. Two kinds of row stay, and no suite counts either. The audit rows (the
 * staff account's enrolment and sign-in, and one case_decided row for each decision): the audit log is an append-only
 * chain, and audit-verify refuses a record with a row gone. And the staff account's rows in the auth schema (the account,
 * its key, its session and its events), which the auth suites leave for their own accounts too. Calling it again does
 * nothing.
 */
export async function closeDecisions(): Promise<void> {
  const [used, member, posts] = [world, admin, [...decidedPosts]];
  world = null;
  admin = null;
  decidedPosts.clear();
  if (!used) return;
  try {
    const staff = member ? await member.catch(() => null) : null;
    await removeDecided(used.migrateDb, posts, staff ? [staff.id] : []);
  } finally {
    await used.close({ keepStaff: true });
  }
}

/**
 * Holds a test file that uses decideForTest to leaving no moderation row behind. Called last inside the file's describe,
 * with a getter of its pool: it reads the moderation tables' row counts before the file's first test, and adds the file's
 * last test, which removes what decideForTest committed and expects the counts unchanged. The file's own posts and
 * profiles stay, as they always did.
 */
export function leavesNoModerationRows(db: () => Db): void {
  let before: Record<string, number>;
  beforeAll(async () => {
    before = await moderationCounts(db());
  });
  test("this file left no moderation row behind: what put its posts into their states is removed, and the moderation tables hold what they held before it", async () => {
    await closeDecisions();
    expect(await moderationCounts(db())).toEqual(before);
  }, 30_000);
}
```

### Replace `apps/api/test/integration/moderation-fixtures.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import pino from "pino";
import { RULE_DEFAULT_CATEGORY, compareDecisionActions, textDigest, type ActionKind, type CaseDecidedParams, type RuleId, type TdbCategory } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import type { AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForCases, type MediaForCases } from "../../src/media";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "../../src/moderation/context";
import { decide } from "../../src/moderation/decide";
import { recordIntake, type IntakeGround, type IntakeRecorded, type LiveTarget } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { newProfile } from "./social-fixtures";
import { newStaffKey } from "./staff-fixtures";

/**
 * Rows for the database tests of the moderation tables (3c design, sections 6.1 and 6.2), written as SQL the way the
 * intake transaction writes them: an insert names only what the API supplies, and the triggers of migrations 0015 and
 * 0016 force the rest. The helpers take a pool or a transaction, so a test chooses the role and whether anything commits.
 * The suites share one database, so a test leaves nothing behind: it runs inside a transaction that is rolled back, or,
 * where a second session must see its rows, it commits them and removes them again with removeFixtures.
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
export const uuids = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * A post row straight in the table: these tests need the row, not the flow and its counters. It is dated a month back.
 * The suites share one database, and others read the public Latest timeline from its newest post down and Explore's
 * 48-hour window: a visible post dated now would stand among theirs, and dozens of them push theirs off the first page.
 */
export async function newPostRow(db: Runner, authorId: string, options: { quoteOfId?: string; replyToId?: string; body?: string; createdAt?: SQL } = {}): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into posts (author_id, body, quote_of_id, reply_to_id, created_at)
        values (${authorId}::uuid, ${options.body ?? "a post"}, ${orNull(options.quoteOfId, "uuid")}, ${orNull(options.replyToId, "uuid")}, ${options.createdAt ?? sql`now() - interval '30 days'`})
        returning id`,
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

/** The items of a case, in the order they attached. */
export async function itemsOf(db: Runner, caseId: string): Promise<ItemRow[]> {
  const rows = await db.execute<ItemRow & Record<string, unknown>>(sql`select * from intake_items where case_id = ${caseId}::uuid order by seq`);
  return [...rows];
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

/** Whether the post is frozen, as the role of the runner reads it. */
export async function postFrozen(db: Runner, postId: string): Promise<boolean> {
  const [row] = await db.execute<{ frozen: boolean }>(sql`select public.post_frozen(${postId}::uuid) as frozen`);
  return row!.frozen;
}

// ---------------------------------------------------------------- the moderation module on a pool or a transaction

/**
 * The moderation module's dependencies over a pool, or over a transaction that the test rolls back: the module opens its
 * own transactions on what it is given, which on a transaction are savepoints, so the intake and the decision run their
 * real statements and nothing commits.
 */
export function moderationDeps(db: Runner): ModerationDeps {
  return { apiDb: db as Db, social: socialForModeration(db as Db), media: casesMedia(db), config: loadConfig(), log: pino({ level: "silent" }), now: () => new Date() };
}

/**
 * The media module's interface for cases over a pool or a transaction, as the server hands it to the moderation module.
 * Its volumes are folders that nothing creates: the database tests lock, hold and count image rows and never open or
 * request a file, and a test that does builds the interface over a store of its own.
 */
export function casesMedia(db: Runner): MediaForCases {
  const log = pino({ level: "silent" });
  const root = path.join(tmpdir(), "korbat-test-no-volumes");
  return mediaForCases({ repo: createMediaRepo(db as Db), files: createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log }), log });
}

const NO_GROUND = { reporterId: null, findingBy: null, contactId: null, ruleId: null, allegesIllegal: false, csam: false, categoryKeyword: null, citedLaw: null, explanation: null, bonaFide: false } as const;

/** What an intake alleges and who sent it, for each way a report arrives. */
export const ground = {
  /** A signed-in report under a korbat rule. */
  rule: (reporterId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_in", reporterId, ruleId, category: TC }),
  /** A notice that the target is illegal: signed in, or signed out without a contact when no reporter is given. */
  illegal: (reporterId: string | null, category: TdbCategory = SPEECH): IntakeGround => ({
    ...NO_GROUND,
    kind: "user",
    channel: reporterId === null ? "signed_out" : "signed_in",
    reporterId,
    allegesIllegal: true,
    category,
    explanation: "It breaks the law.",
    bonaFide: true,
  }),
  /** A notice on the path for child sexual abuse material: no account, no contact. */
  csam: (): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_out", allegesIllegal: true, csam: true, category: MINORS }),
  /** A moderator's own finding under a rule; citing R2 it is suspect. */
  finding: (staffId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "finding", channel: "staff", findingBy: staffId, ruleId, category: RULE_DEFAULT_CATEGORY[ruleId] }),
};

/** One intake through the module's own transaction. A single target gets position 1. */
export function intake(db: Runner, ground: IntakeGround, targets: LiveTarget | readonly LiveTarget[]): Promise<IntakeRecorded> {
  const live = Array.isArray(targets) ? (targets as readonly LiveTarget[]) : [targets as LiveTarget];
  return recordIntake(moderationDeps(db), { ground, live });
}

/** A post as an intake's first target. */
export const aPost = (id: string, position = 1): LiveTarget => ({ type: "post", id, position });
/** An account as an intake's first target, named by a handle. */
export const anAccount = (id: string, namedHandle = "named", position = 1): LiveTarget => ({ type: "account", id, position, namedHandle });

/** An author (a new profile unless one is given) and a post of theirs with this many images. */
export async function imagePost(db: Runner, images = 0, authorId?: string, options: { quoteOfId?: string; replyToId?: string } = {}): Promise<{ authorId: string; postId: string; mediaIds: string[] }> {
  const owner = authorId ?? (await newProfile(db as Db)).id;
  const postId = await newPostRow(db, owner, options);
  const mediaIds: string[] = [];
  for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(db, owner, postId, position));
  return { authorId: owner, postId, mediaIds };
}

/**
 * One report about the target by someone new, into the target's open case (opened when there is none): under a rule, as
 * a notice of illegality, or on the path for child sexual abuse material, which records no sender.
 */
export async function report(db: Runner, target: LiveTarget, by: "rule" | "illegal" | "csam" = "rule", rule: RuleId = "R1"): Promise<{ caseId: string; recorded: IntakeRecorded }> {
  const sender = by === "csam" ? null : (await newProfile(db as Db)).id;
  const recorded = await intake(db, by === "csam" ? ground.csam() : by === "illegal" ? ground.illegal(sender) : ground.rule(sender!, rule), target);
  return { caseId: recorded.items.find((item) => item.position === target.position)!.caseId!, recorded };
}

// ---------------------------------------------------------------- staff and decisions

/** A staff account as the database tests need it: its id, a live staff key of its own and its role. It has no profile until a test gives it one. */
export interface TestStaff {
  id: string;
  keyId: string;
  role: "moderator" | "admin";
}

/**
 * A live staff account with one live key, committed on the auth side: the decision triggers read the account's role and
 * the audit function its key, in the auth schema, which a transaction of the API role cannot write. The key's public key
 * is a placeholder: no test that commits an audit row signs with it.
 */
export async function newTestStaff(authDb: Db, migrateDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator"): Promise<TestStaff> {
  const { user, key } = await newStaffKey(authDb, migrateDb, repo, role);
  return { id: user.id, keyId: key.id, role };
}

/** The staff account's profile row, which a decision, a finding and a staff text refer to. Its handle is random. */
export async function staffProfile(db: Runner, staff: { id: string }): Promise<void> {
  await db.execute(sql`insert into profiles (id, handle, display_name) values (${staff.id}::uuid, ${`st_${randomBytes(5).toString("hex")}`}, 'Staff')`);
}

/** Saves a staff text on a case as the console will: a fresh salt, and the digest of the salt and the text. Answers the digest. */
export async function saveText(db: Runner, caseId: string, authorId: string, kind: string, text = `a ${kind} text ${randomUUID()}`): Promise<string> {
  const salt = hex64();
  const digest = await textDigest(salt, text);
  await db.execute(sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest) values (${caseId}::uuid, ${authorId}::uuid, ${kind}::staff_text_kind, ${text}, ${salt}, ${digest})`);
  return digest;
}

/** The case's newest snapshot, as a decision names it. */
export async function newestSnapshot(db: Runner, caseId: string): Promise<{ id: string; digest: string }> {
  const [row] = await db.execute<{ id: string; digest: string }>(sql`select id, digest from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`);
  if (!row) throw new Error("the case holds no snapshot");
  return { id: row.id, digest: row.digest };
}

/** What a test says about a decision; everything left out is filled in from the case as the console would. */
export interface DecisionInput {
  /** `interim` unless said. */
  kind?: "interim" | "final" | "correction";
  /** `restricted` for an interim or final decision, `reversed` for a correction, unless said. */
  outcome?: CaseDecidedParams["outcome"];
  /** For a restriction `incompatible` unless said; else none. */
  ground?: "incompatible" | "illegal" | null;
  /** R1 for the ground `incompatible` unless said. */
  ruleId?: RuleId | null;
  category?: TdbCategory;
  categoryKeyword?: "KEYWORD_TERRORIST_CONTENT" | null;
  actions?: readonly { kind: ActionKind; mediaId?: string | null }[];
  /** For a final decision the case's newest item unless said. */
  throughSeq?: number;
  /** The case's version now unless said. */
  stateVersion?: number;
  reviewsDecisionId?: string | null;
  snapshotId?: string;
  snapshotDigest?: string;
  /** Each text is saved fresh where the decision needs one, unless a digest (or null) is given. */
  factsDigest?: string | null;
  reasonDigest?: string | null;
  legalReferenceDigest?: string | null;
  rulesVersion?: number;
  redressVersion?: number;
}

/** A measure on the post, the account's field or the case's images; an image measure with its image. */
export const act = (kind: ActionKind, mediaId: string | null = null) => ({ kind, mediaId });

/**
 * The params of a decision on the case as the console builds them: the case's version, the range a final decision
 * answers, the newest snapshot with its digest, the digests of freshly saved texts, and the actions in their one order.
 */
export async function decisionParams(db: Runner, staff: { id: string }, caseId: string, input: DecisionInput = {}): Promise<CaseDecidedParams> {
  const kind = input.kind ?? "interim";
  const outcome = input.outcome ?? (kind === "correction" ? "reversed" : "restricted");
  const groundOf = input.ground !== undefined ? input.ground : outcome === "restricted" ? "incompatible" : null;
  const ruleId = input.ruleId !== undefined ? input.ruleId : groundOf === "incompatible" ? "R1" : null;
  const current = await readCase(db, caseId);
  const snapshot = input.snapshotId !== undefined && input.snapshotDigest !== undefined ? { id: input.snapshotId, digest: input.snapshotDigest } : await newestSnapshot(db, caseId);
  let category: TdbCategory = input.category ?? (ruleId !== null ? RULE_DEFAULT_CATEGORY[ruleId] : groundOf === "illegal" ? SPEECH : TC);
  let rulesVersion = input.rulesVersion ?? RULES_VERSION;
  if (kind === "correction" && input.reviewsDecisionId) {
    // A correction carries the category and the rules version of the decision it corrects.
    const [corrected] = await db.execute<{ category: TdbCategory; rules_version: number }>(sql`select category, rules_version from decisions where id = ${input.reviewsDecisionId}::uuid`);
    category = input.category ?? corrected?.category ?? category;
    rulesVersion = input.rulesVersion ?? corrected?.rules_version ?? rulesVersion;
  }
  const text = async (given: string | null | undefined, needed: boolean, textKind: string) => (given !== undefined ? given : needed ? await saveText(db, caseId, staff.id, textKind) : null);
  return {
    kind,
    stateVersion: input.stateVersion ?? current.state_version,
    throughSeq: input.throughSeq ?? (kind === "final" ? current.intake_seq : 0),
    reviewsDecisionId: input.reviewsDecisionId ?? null,
    snapshotId: input.snapshotId ?? snapshot.id,
    snapshotDigest: input.snapshotDigest ?? snapshot.digest,
    outcome,
    ground: groundOf,
    ruleId,
    rulesVersion,
    redressVersion: input.redressVersion ?? REDRESS_VERSION,
    category,
    categoryKeyword: input.categoryKeyword ?? null,
    actions: (input.actions ?? []).map((action) => ({ kind: action.kind, mediaId: action.mediaId ?? null })).sort(compareDecisionActions),
    factsDigest: await text(input.factsDigest, outcome === "restricted", "facts"),
    reasonDigest: await text(input.reasonDigest, outcome === "restricted" || kind === "correction", kind === "correction" ? "review_reason" : "reason"),
    legalReferenceDigest: await text(input.legalReferenceDigest, groundOf === "illegal", "legal_reference"),
  };
}

/**
 * A staff session and a confirmation as the staff routes hand them to the moderation module, made up: the hash and the
 * assertion are placeholders that audit-verify would refuse, so the audit row they lead to is only ever written inside a
 * transaction that is rolled back. A decision that commits is confirmed with a real key (moderation-decide.ts).
 */
export function madeUpConfirmation(staff: TestStaff, caseId: string, params: CaseDecidedParams, expiresAt = new Date(Date.now() + 10 * 60_000)): { session: ActiveStaffSession; confirmed: StaffStepUpConfirmed } {
  const now = new Date();
  return {
    session: {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    },
    confirmed: {
      action: "case_decided",
      target: { type: "case", id: caseId },
      params,
      actionHash: hex64(),
      keyId: staff.keyId,
      assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
      expiresAt,
    },
  };
}

/** What the database raised, however deeply the driver wrapped it: its SQLSTATE, message and detail. */
export function raised(err: unknown): { code: string; message: string; detail: string | null } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((current as { code: string }).code)) {
      const found = current as { code: string; message?: unknown; detail?: unknown };
      return { code: found.code, message: String(found.message ?? ""), detail: typeof found.detail === "string" ? found.detail : null };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * A decision inside a transaction that the test rolls back, through the module's own decide: the decision's row, its
 * measures and its audit row, with a made-up confirmation of exactly these params. The deferred check, which a real
 * decision meets at its commit, is made to run right after, inside the same savepoint, so a decision it refuses leaves
 * nothing behind and a later decision of the test is checked alone. Answers the decision's id; a refusal is thrown as the
 * module throws it, with the detail the database gave.
 */
export async function decideWith(tx: DbTx, staff: TestStaff, caseId: string, params: CaseDecidedParams): Promise<string> {
  const { session, confirmed } = madeUpConfirmation(staff, caseId, params);
  try {
    return await tx.transaction(async (sp) => {
      const outcome = await decide(moderationDeps(sp), session, confirmed, { requestId: `req-${randomUUID()}` });
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
      return outcome.decisionId;
    });
  } catch (err) {
    // The check at commit raises its code as the triggers do; decide maps the same code when a real commit fails.
    const refused = raised(err);
    if (!(err instanceof ModerationError) && refused?.code === "P0001" && isModerationErrorCode(refused.message)) {
      throw Object.assign(new ModerationError(refused.message), { detail: refused.detail });
    }
    throw err;
  }
}

/** The same, with the params filled in from the case as the console would build them. */
export async function decideIn(tx: DbTx, staff: TestStaff, caseId: string, input: DecisionInput = {}): Promise<string> {
  return decideWith(tx, staff, caseId, await decisionParams(tx, staff, caseId, input));
}

/** The code a flow or a statement was refused with, or null when it went through: a module's error code, or what the database raised. */
export async function refusal(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof ModerationError) return err.code;
    const fromDatabase = raised(err);
    if (fromDatabase) return fromDatabase.code === "P0001" ? fromDatabase.message : `${fromDatabase.code} ${fromDatabase.message}`;
    if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
    throw err;
  }
}

/** The detail a refusal at commit names: the member of the audit row, or the rule, that did not hold. */
export async function refusalDetail(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { detail?: string | null }).detail ?? raised(err)?.detail ?? null;
  }
}

/** A decision's row as the triggers left it, with the columns these tests read. */
export interface DecisionRow {
  id: string;
  case_id: string;
  kind: string;
  outcome: string;
  ground: string | null;
  rule_id: string | null;
  through_seq: number;
  answers_from_seq: number | null;
  source: string;
  suspect: boolean;
  unseen: boolean;
  needs_admin: boolean;
  ended_interim: boolean;
  author_mail: string;
  decided_by: string;
  automated_detection: boolean;
  automated_decision: string;
  territorial_scope: string;
  puid: string;
  redacted_at: string | null;
}

export async function decisionRow(db: Runner, id: string): Promise<DecisionRow> {
  const [row] = await db.execute<DecisionRow & Record<string, unknown>>(sql`select * from decisions where id = ${id}::uuid`);
  return row!;
}

/** A ledger row as the triggers left it. actionsOf answers a decision's rows in the order its params list them: by kind as a word, then by image. */
export interface ActionRow {
  id: string;
  decision_id: string;
  kind: ActionKind;
  media_id: string | null;
  subject_account_id: string;
  post_id: string | null;
  reverses_action_id: string | null;
  no_effect: string | null;
}

export async function actionsOf(db: Runner, decisionId: string): Promise<ActionRow[]> {
  const rows = await db.execute<ActionRow & Record<string, unknown>>(sql`select * from decision_actions where decision_id = ${decisionId}::uuid order by kind::text, media_id`);
  return [...rows];
}

/** A post's state, its level and whether its content was erased. */
export async function postRow(db: Runner, id: string): Promise<{ state: string; level: string; erased: boolean }> {
  const [row] = await db.execute<{ state: string; level: string; erased: boolean }>(sql`select state, moderation_level as level, erased_at is not null as erased from posts where id = ${id}::uuid`);
  return { ...row! };
}

/** Each image's moderation state, in the order asked. */
export async function imageStates(db: Runner, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string; state: string }>(sql`select id, moderation_state as state from post_media where id = any(${uuids(ids)})`);
  const byId = new Map([...rows].map((row) => [row.id, row.state]));
  return ids.map((id) => byId.get(id) ?? "missing");
}

/** The measures in force that the view names, as "kind" or "kind:image", sorted. */
export async function inForce(db: Runner, where: { caseId?: string; postId?: string }): Promise<string[]> {
  const rows = await db.execute<{ kind: string; media_id: string | null }>(
    sql`select kind, media_id from measures_in_force where ${where.caseId ? sql`case_id = ${where.caseId}::uuid` : sql`post_id = ${where.postId!}::uuid`} order by kind::text, media_id`,
  );
  return [...rows].map((row) => (row.media_id ? `${row.kind}:${row.media_id}` : row.kind));
}

/**
 * Deletes these cases with everything that hangs on them, and these intakes with their items, in the order the keep
 * trigger and the foreign keys ask for (removeFixtures says why). Both ids are uuid[] parameters.
 */
async function removeCasesIn(tx: DbTx, caseIds: SQL, intakeIds: SQL): Promise<void> {
  await tx.execute(sql`delete from intake_items where case_id = any(${caseIds}) or intake_id = any(${intakeIds})`);
  await tx.execute(sql`update media_holds set released_at = now() where case_id = any(${caseIds}) and released_at is null`);
  await tx.execute(sql`delete from media_holds where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from seal_posts where action_id in (select a.id from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decision_actions where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from staff_texts where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from appeals where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decisions where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from evidence_snapshots where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from case_access_log where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from cases where id = any(${caseIds})`);
  await tx.execute(sql`delete from intakes where id = any(${intakeIds})`);
}

/**
 * Removes, as the migrator, what decisions about these posts left: the posts' cases with everything that hangs on them,
 * the findings of these staff accounts, and those accounts' profiles. The posts themselves stay, as their suites leave
 * them, and their levels are derived again, so none keeps a level that no decision gives it any more.
 */
export async function removeDecided(migrateDb: Db, postIds: readonly string[], staffIds: readonly string[]): Promise<void> {
  if (postIds.length === 0 && staffIds.length === 0) return;
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`select id from cases where target_type = 'post' and target_id = any(${uuids(postIds)})`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.finding_by = any(${uuids(staffIds)})`);
    await removeCasesIn(tx, caseIds, uuids(intakes.map((row) => row.id)));
    await tx.execute(sql`select public.moderation_apply(${uuids(postIds)}, true)`);
    await tx.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
  });
}

/**
 * Removes, as the migrator, everything a test committed about these profiles. Only a test whose second session must see
 * its rows commits them, and it calls this in a `finally`. The order is the one the keep trigger and the foreign keys
 * ask for: the items first (an unanswered suspect item freezes every image its case reaches, and the database then keeps
 * those rows against every delete); the holds released and then deleted (a release takes the image's hold_until back; a
 * delete of the hold's row would not); the seals' lists, the ledger and the texts before the decisions that own them, and
 * the decisions before the snapshots they name; access rows; the cases; the intakes of the items and of these reporters
 * and finders; then the image rows, the posts and the profiles. The audit rows of committed decisions stay: they are the
 * record, and audit-verify still accepts them.
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
    await removeCasesIn(tx, caseIds, intakeIds);
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

/** The same for the moderation tables alone: what a suite that keeps its own posts and profiles is held to. */
export async function moderationCounts(db: Runner): Promise<Record<string, number>> {
  const kept = new Set(["post_media", "posts", "profiles"]);
  return Object.fromEntries(Object.entries(await rowCounts(db)).filter(([table]) => !kept.has(table)));
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

### Replace `apps/api/test/integration/moderation-seal.test.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  MINORS,
  aPost,
  act,
  actionsOf,
  anAccount,
  decideIn,
  decisionRow,
  imagePost,
  imageStates,
  inForce,
  insertItem,
  itemsOf,
  newImageRow,
  newTestStaff,
  openCase,
  postFrozen,
  postRow,
  readCase,
  refusal,
  report,
  rowCounts,
  staffProfile,
  type DecisionInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/** A seal taken while deciding, a seal for good, and an admin's answer without a seal. */
const SEAL_WHILE_DECIDING: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
const SEAL_FOR_GOOD: DecisionInput = { kind: "final", ruleId: "R2", actions: [act("seal_media")] };
const NO_SEAL: DecisionInput = { kind: "final", outcome: "no_violation" };

/**
 * The seal and the freeze with decisions (3c design, sections 6.1 and 6.2), against the real database: what a report
 * of child sexual abuse material freezes, what a seal covers and who takes, ends and lifts it, the range of an admin's
 * answer, and the stored fact that a decision was taken while nobody could open a post's images. Each test runs inside one
 * transaction that is rolled back, as korbat_api unless it needs a step only the migrator can take (moving a stored time,
 * a cascade); the decisions go through the moderation module's own decide. The file's last test holds it to leaving no
 * row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the seal, the freeze and the admin's answer", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The list a decision's seal wrote: one row for each post, with the number of its images. */
  const sealList = async (tx: DbTx, decisionId: string) =>
    (
      await tx.execute<{ post_id: string; images: number }>(
        sql`select s.post_id, s.images from seal_posts s join decision_actions a on a.id = s.action_id where a.decision_id = ${decisionId}::uuid and a.kind = 'seal_media' order by s.post_id`,
      )
    ).map((row) => ({ ...row }));
  const listOf = (...posts: [string, number][]) => posts.map(([post_id, images]) => ({ post_id, images })).sort((a, b) => (a.post_id < b.post_id ? -1 : 1));
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);

  describe("a seal is a person's act", () => {
    test("a report hides nothing by itself; whoever is on duty seals every image the case reaches, for everyone; an admin's answer without a seal ends it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);

        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await decisionRow(tx, seal)).toMatchObject({ kind: "interim", suspect: true, needs_admin: false, unseen: false, author_mail: "pending" });
        // A seal names no post and no image: its posts are listed by the database, from the image rows it locked.
        expect(await actionsOf(tx, seal)).toEqual([expect.objectContaining({ kind: "seal_media", media_id: null, post_id: null, subject_account_id: p.authorId, no_effect: null })]);
        expect(await sealList(tx, seal)).toEqual(listOf([p.postId, 2]));
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed", "sealed"]);
        // Text is never sealed: the post keeps its level and its state.
        expect(await postRow(tx, p.postId)).toEqual({ state: "visible", level: "visible", erased: false });
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);

        // The admin answers without a seal: the seal taken while deciding ends by itself, and its author is told.
        const answer = await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await decisionRow(tx, answer)).toMatchObject({ outcome: "no_violation", suspect: true, needs_admin: true, unseen: true, ended_interim: true, author_mail: "pending" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
      });
    });

    test("only an admin seals for good; the seal for good has a list of its own, and is not told as changing nothing", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const interim = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await refusal(decideIn(tx, mod, caseId, SEAL_FOR_GOOD))).toBe("admin_required");
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);

        const [first] = await actionsOf(tx, interim);
        const [second] = await actionsOf(tx, final);
        expect([first!.no_effect, second!.no_effect]).toEqual([null, null]);
        expect(await sealList(tx, final)).toEqual(listOf([p.postId, 2]));
        // The answer ended the seal taken while deciding; the seal for good is the one in force.
        const standing = await tx.execute<{ id: string }>(sql`select id from measures_in_force where case_id = ${caseId}::uuid`);
        expect(standing.map((row) => row.id)).toEqual([second!.id]);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed", "sealed"]);
        expect(await decisionRow(tx, final)).toMatchObject({ suspect: true, needs_admin: true, unseen: true, ended_interim: true, author_mail: "pending" });
        // The case is closed, and the post stays frozen: a seal in force lists it.
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
        expect((await itemsOf(tx, caseId))[0]).toMatchObject({ outcome: "restricted_rule", answered_by: final });
        expect(await postFrozen(tx, p.postId)).toBe(true);

        // Only an admin lifts it, in a correction; then nothing freezes the post any more.
        const lift: DecisionInput = { kind: "correction", reviewsDecisionId: final, actions: [act("unseal_media")] };
        expect(await refusal(decideIn(tx, mod, caseId, lift))).toBe("admin_required");
        const lifted = await decideIn(tx, admin, caseId, lift);
        expect(await decisionRow(tx, lifted)).toMatchObject({ kind: "correction", outcome: "reversed", needs_admin: true, suspect: true, author_mail: "pending" });
        expect((await actionsOf(tx, lifted))[0]).toMatchObject({ kind: "unseal_media", reverses_action_id: second!.id, media_id: null, post_id: null });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        const [item] = await tx.execute<{ pending: boolean }>(sql`select revision_pending_at is not null as pending from intake_items where case_id = ${caseId}::uuid`);
        expect(item!.pending).toBe(true);
      });
    });

    test("a seal taken while deciding is lifted only by an admin, also the moderator's own; lifting marks the decision as an admin's", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        // Not in a decision taken while deciding, nor in one that decides the case, for an admin either.
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "interim", ruleId: "R2", actions: [act("unseal_media")] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, admin, caseId, { kind: "final", outcome: "no_violation", actions: [act("unseal_media")] }))).toBe("invalid_decision");
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);

        const lift: DecisionInput = { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] };
        expect(await refusal(decideIn(tx, mod, caseId, lift))).toBe("admin_required");
        const lifted = await decideIn(tx, admin, caseId, lift);
        // The corrected decision needed no admin; the lifting of a seal does, whatever the decision's kind, and stores it.
        expect(await decisionRow(tx, lifted)).toMatchObject({ needs_admin: true, ended_interim: true, author_mail: "pending" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        // The report is still unanswered: the post stays frozen, and a person may seal again.
        expect(await postFrozen(tx, p.postId)).toBe(true);
        const again = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, again))[0]!.no_effect).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("a seal needs a decision that rests on a suspect item, under R2 or in the category Protection of minors, and a case that reaches an image", async () => {
      await inWorld(async (tx) => {
        // No suspect item: a rule report, whatever the decision says of itself.
        const plain = await imagePost(tx, 1);
        const reported = await report(tx, aPost(plain.postId), "illegal");
        expect(await refusal(decideIn(tx, admin, reported.caseId, { kind: "interim", ground: "illegal", category: MINORS, actions: [act("seal_media")] }))).toBe("invalid_decision");

        // A suspect item, but another rule and another category.
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R1", actions: [act("seal_media")] }))).toBe("invalid_decision");
        expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R5", actions: [act("seal_media")] }))).toBe("invalid_decision");
        // On the law, in the category Protection of minors, it stands.
        expect(await refusal(decideIn(tx, mod, caseId, { kind: "interim", ground: "illegal", category: MINORS, actions: [act("seal_media")] }))).toBeNull();

        // A post without an image, and an account whose only image is an upload on no post: there is nothing to seal.
        const textOnly = await imagePost(tx, 0);
        expect(await refusal(decideIn(tx, mod, (await report(tx, aPost(textOnly.postId), "csam")).caseId, SEAL_WHILE_DECIDING))).toBe("invalid_decision");
        const owner = await profile(tx);
        await newImageRow(tx, owner.id, null);
        await imagePost(tx, 0, owner.id);
        expect(await refusal(decideIn(tx, mod, (await report(tx, anAccount(owner.id, owner.handle), "csam")).caseId, SEAL_WHILE_DECIDING))).toBe("invalid_decision");
      });
    });

    test("a seal on an account's case lists every post of the account with an image row, a deleted post's kept images included; a later seal covers what was posted since", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const p1 = await imagePost(tx, 2, owner.id);
        const p2 = await imagePost(tx, 1, owner.id);
        await imagePost(tx, 0, owner.id);
        const upload = await newImageRow(tx, owner.id, null);
        const stranger = await imagePost(tx, 1);
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        // The author deletes one of the posts: the freeze keeps its image row against the delete.
        await authorDeletes(tx, p2.postId);
        expect(await tx.execute(sql`delete from post_media where post_id = ${p2.postId}::uuid returning id`)).toHaveLength(0);

        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await sealList(tx, seal)).toEqual(listOf([p1.postId, 2], [p2.postId, 1]));
        expect((await actionsOf(tx, seal))[0]).toMatchObject({ subject_account_id: owner.id, post_id: null, media_id: null, no_effect: null });
        expect(await imageStates(tx, [...p1.mediaIds, ...p2.mediaIds, upload, ...stranger.mediaIds])).toEqual(["sealed", "sealed", "sealed", "visible", "visible"]);
        // No post is touched: a seal changes no level.
        expect(await postRow(tx, p1.postId)).toMatchObject({ state: "visible", level: "visible" });
        expect(await postRow(tx, p2.postId)).toMatchObject({ state: "deleted_by_author", level: "visible" });

        // An image posted since is frozen and not sealed, until a person seals again: that seal has a list of its own.
        const p4 = await imagePost(tx, 1, owner.id);
        expect(await postFrozen(tx, p4.postId)).toBe(true);
        expect(await imageStates(tx, p4.mediaIds)).toEqual(["visible"]);
        const second = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await sealList(tx, second)).toEqual(listOf([p1.postId, 2], [p2.postId, 1], [p4.postId, 1]));
        expect((await actionsOf(tx, second))[0]!.no_effect).toBeNull();
        expect(await imageStates(tx, p4.mediaIds)).toEqual(["sealed"]);
        // A third over the same posts is recorded, in force, and changes nothing now.
        const third = await decideIn(tx, admin, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, third))[0]!.no_effect).toBe("already");
        expect(await inForce(tx, { caseId })).toEqual(["seal_media", "seal_media", "seal_media"]);

        // The admin seals for good: the answer ends all three, and the seal for good keeps every image sealed.
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        expect(await sealList(tx, final)).toEqual(listOf([p1.postId, 2], [p2.postId, 1], [p4.postId, 1]));
        expect((await actionsOf(tx, final))[0]!.no_effect).toBeNull();
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
        expect(await imageStates(tx, [...p1.mediaIds, ...p2.mediaIds, ...p4.mediaIds, upload])).toEqual(["sealed", "sealed", "sealed", "sealed", "visible"]);
      });
    });

    test("a seal on a deleted target is recorded as changing nothing anyone sees, without a mail while deciding", async () => {
      await inWorld(async (tx) => {
        const gone = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(gone.postId), "csam");
        await authorDeletes(tx, gone.postId);
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, seal))[0]!.no_effect).toBe("deleted");
        expect(await decisionRow(tx, seal)).toMatchObject({ author_mail: "none" });
        expect(await imageStates(tx, gone.mediaIds)).toEqual(["sealed"]);
        // The answer ends a seal its author was never told of: nothing is told now either.
        expect(await decisionRow(tx, await decideIn(tx, admin, caseId, NO_SEAL))).toMatchObject({ ended_interim: false, author_mail: "none" });

        // A purged account: its handle stays on the row, and its posts' kept images are reached like any.
        const owner = await profile(tx);
        const post = await imagePost(tx, 1, owner.id);
        const account = await report(tx, anAccount(owner.id, owner.handle), "csam");
        await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() where id = ${owner.id}::uuid`);
        const onPurged = await decideIn(tx, admin, account.caseId, SEAL_FOR_GOOD);
        expect((await actionsOf(tx, onPurged))[0]!.no_effect).toBe("deleted");
        expect(await decisionRow(tx, onPurged)).toMatchObject({ author_mail: "pending" });
        expect(await imageStates(tx, post.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("the post's text is removed by an ordinary measure beside the seal; lifting the seal leaves the removal, and the images not sealed", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const final = await decideIn(tx, admin, caseId, { kind: "final", ruleId: "R2", actions: [act("remove"), act("seal_media")] });
        expect((await actionsOf(tx, final)).map((a) => [a.kind, a.post_id, a.no_effect])).toEqual([
          ["remove", p.postId, null],
          ["seal_media", null, null],
        ]);
        // Sealed whatever the post's level.
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
        const lifted = await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: final, outcome: "partly_reversed", actions: [act("unseal_media")] });
        expect(await decisionRow(tx, lifted)).toMatchObject({ outcome: "partly_reversed" });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
      });
    });

    test("a report of this kind merged into an R5 case about a post without images: the admin removes under R5, and a seal is refused there", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const { caseId } = await report(tx, aPost(p.postId), "rule", "R5");
        await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, admin, caseId, SEAL_FOR_GOOD))).toBe("invalid_decision");
        const removal: DecisionInput = { kind: "final", ruleId: "R5", actions: [act("remove")] };
        expect(await refusal(decideIn(tx, mod, caseId, removal))).toBe("admin_required");
        const id = await decideIn(tx, admin, caseId, removal);
        expect(await decisionRow(tx, id)).toMatchObject({ suspect: true, needs_admin: true, rule_id: "R5" });
        expect((await itemsOf(tx, caseId)).map((item) => [item.suspect, item.outcome])).toEqual([
          [false, "restricted_rule"],
          [true, "restricted_rule"],
        ]);
      });
    });

    test("on a staff account's posts whoever is on duty seals while deciding; a seal for good is refused", async () => {
      const staffAuthor = await newTestStaff(authDb, migrateDb, repo, "moderator");
      await inWorld(async (tx) => {
        await staffProfile(tx, staffAuthor);
        const p = await imagePost(tx, 1, staffAuthor.id);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING))).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
        expect(await refusal(decideIn(tx, admin, caseId, SEAL_FOR_GOOD))).toBe("staff_target");
        // The admin can still answer: without a measure nothing restricts the staff account.
        expect(await refusal(decideIn(tx, admin, caseId, NO_SEAL))).toBeNull();
      });
    });
  });

  describe("the range of an admin's answer", () => {
    test("the answer ends a seal taken while deciding also while an item of another kind keeps the case open, and tells its author", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        await report(tx, aPost(p.postId), "rule");
        const answer = await decideIn(tx, admin, caseId, { ...NO_SEAL, throughSeq: 1 });
        expect(await decisionRow(tx, answer)).toMatchObject({ through_seq: 1, ended_interim: true, author_mail: "pending", unseen: true });
        expect(await readCase(tx, caseId)).toMatchObject({ answered_seq: 1, intake_seq: 2, closed_at: null });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        // The later report is the moderator's, with the images open again: not unseen.
        const later = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, later)).toMatchObject({ unseen: false, suspect: false, needs_admin: false, ended_interim: false, author_mail: "none" });
      });
    });

    test("an answer through an earlier suspect item while a later one waits is refused, for an admin too; through both it ends the seal", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        await report(tx, aPost(p.postId), "csam");
        expect(await refusal(decideIn(tx, admin, caseId, { ...NO_SEAL, throughSeq: 1 }))).toBe("case_changed");
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
        expect(await refusal(decideIn(tx, admin, caseId, NO_SEAL))).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        expect(await postFrozen(tx, p.postId)).toBe(false);
      });
    });
  });

  describe("unseen: the stored fact that a decision was taken while nobody could open the post's images", () => {
    test("true for a final decision on a post frozen through its author's account's case, which a moderator takes without an admin", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const p = await imagePost(tx, 1, owner.id);
        const account = await report(tx, anAccount(owner.id, owner.handle), "csam");
        const { caseId } = await report(tx, aPost(p.postId), "rule");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        // While deciding, and on the account's own case, nothing is marked.
        const interim = await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await decisionRow(tx, interim)).toMatchObject({ unseen: false, suspect: false });
        const answer = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove")] });
        expect(await decisionRow(tx, answer)).toMatchObject({ unseen: true, suspect: false, needs_admin: false });
        // A correction is never unseen.
        const correction = await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: answer, actions: [act("restore")] });
        expect(await decisionRow(tx, correction)).toMatchObject({ unseen: false });
        // The admin's answer on the account's case concerns its fields, which staff read: not unseen.
        const onAccount = await decideIn(tx, admin, account.caseId, NO_SEAL);
        expect(await decisionRow(tx, onAccount)).toMatchObject({ unseen: false, suspect: true, needs_admin: true });
        // The freeze has ended: the next report about the post is answered with the images open.
        const again = await report(tx, aPost(p.postId), "rule");
        expect(await decisionRow(tx, await decideIn(tx, mod, again.caseId, { kind: "final", outcome: "no_violation" }))).toMatchObject({ unseen: false });
      });
    });

    test("true while a seal for good lists the post, on a later case about it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const sealed = await report(tx, aPost(p.postId), "csam");
        await decideIn(tx, admin, sealed.caseId, SEAL_FOR_GOOD);
        const later = await report(tx, aPost(p.postId), "rule");
        expect(later.caseId).not.toBe(sealed.caseId);
        const answer = await decideIn(tx, mod, later.caseId, { kind: "final", outcome: "no_violation" });
        expect(await decisionRow(tx, answer)).toMatchObject({ unseen: true, suspect: false, needs_admin: false });
      });
    });
  });

  describe("the freeze's predicate, with decisions", () => {
    test("a post is frozen while a suspect item about it is unanswered, and no longer once an admin answered without a seal", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        // A moderator's withhold of the text does not answer the report.
        await decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R2", actions: [act("withhold")] });
        expect(await postFrozen(tx, p.postId)).toBe(true);
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await postFrozen(tx, p.postId)).toBe(false);
      });
    });

    test("a suspect item that arrives after a seal taken while deciding ended freezes the post again and never brings that seal back", async () => {
      // As the migrator: the seal's decision is dated a minute back, as one made in an earlier transaction is. Inside one
      // transaction every time is its start, and the seal would count the later item as its own.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        await report(tx, aPost(p.postId), "rule");
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        await tx.execute(sql`update decisions set decided_at = decided_at - interval '1 minute' where id = ${seal}::uuid`);
        await tx.execute(sql`update intake_items set created_at = created_at - interval '2 minutes' where case_id = ${caseId}::uuid`);
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
        // The admin answers the suspect item; the rule report keeps the case open.
        await decideIn(tx, admin, caseId, { ...NO_SEAL, throughSeq: 1 });
        expect(await postFrozen(tx, p.postId)).toBe(false);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);

        // A new report of this kind joins the open case: frozen again through the new item, the old seal stays ended, and
        // the images stay as they are until a person seals again.
        await report(tx, aPost(p.postId), "csam");
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
        const again = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect((await actionsOf(tx, again))[0]!.no_effect).toBeNull();
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed"]);
      }, migrateDb);
    });

    test("an item that arrived after the seal's decision began does not put that seal in force, and freezes all the same", async () => {
      // As the migrator, which moves the item's time: the item committed while the seal's decision waited for its locks.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const seal = await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        expect(await inForce(tx, { caseId })).toEqual(["seal_media"]);
        await tx.execute(sql`update intake_items set created_at = created_at + interval '1 second' where case_id = ${caseId}::uuid`);
        expect(await inForce(tx, { caseId })).toEqual([]);
        expect(await postFrozen(tx, p.postId)).toBe(true);
        expect((await decisionRow(tx, seal)).suspect).toBe(true);
      }, migrateDb);
    });

    test("a post frozen through the item korbat added for it stays frozen after the quoting post's item is answered", async () => {
      await inWorld(async (tx) => {
        const quoted = await imagePost(tx, 1);
        const quoting = await imagePost(tx, 0, undefined, { quoteOfId: quoted.postId });
        const { caseId, recorded } = await report(tx, aPost(quoting.postId), "csam");
        expect(recorded.items.map((item) => [item.position, item.targetId])).toEqual([
          [1, quoting.postId],
          [11, quoted.postId],
        ]);
        expect([await postFrozen(tx, quoting.postId), await postFrozen(tx, quoted.postId)]).toEqual([true, true]);
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect([await postFrozen(tx, quoting.postId), await postFrozen(tx, quoted.postId)]).toEqual([false, true]);
        // The quoting post's case reached no image; the quoted post's case is sealed on its own.
        const quotedCase = recorded.items[1]!.caseId!;
        await decideIn(tx, admin, quotedCase, SEAL_FOR_GOOD);
        expect(await postFrozen(tx, quoted.postId)).toBe(true);
        expect(await imageStates(tx, quoted.mediaIds)).toEqual(["sealed"]);
      });
    });

    test("a post made after an account's seal is frozen while the item waits; one made once the item is answered is not, though the seal stands", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const earlier = await imagePost(tx, 1, owner.id);
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        const after = await imagePost(tx, 1, owner.id);
        expect([await postFrozen(tx, earlier.postId), await postFrozen(tx, after.postId)]).toEqual([true, true]);
        expect(await imageStates(tx, [...earlier.mediaIds, ...after.mediaIds])).toEqual(["sealed", "visible"]);
        await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        // The seal for good lists what existed when it was taken, the post made meanwhile included; a post made after it
        // is on no seal's list, and no item waits any more.
        const later = await imagePost(tx, 1, owner.id);
        expect([await postFrozen(tx, earlier.postId), await postFrozen(tx, after.postId), await postFrozen(tx, later.postId)]).toEqual([true, true, false]);
        expect(await imageStates(tx, [...earlier.mediaIds, ...after.mediaIds, ...later.mediaIds])).toEqual(["sealed", "sealed", "visible"]);
      });
    });

    test("once an admin answered an account's report without a seal, none of the account's posts is frozen", async () => {
      await inWorld(async (tx) => {
        const owner = await profile(tx);
        const earlier = await imagePost(tx, 1, owner.id);
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        await decideIn(tx, mod, caseId, SEAL_WHILE_DECIDING);
        const after = await imagePost(tx, 1, owner.id);
        await decideIn(tx, admin, caseId, NO_SEAL);
        expect([await postFrozen(tx, earlier.postId), await postFrozen(tx, after.postId)]).toEqual([false, false]);
        expect(await imageStates(tx, [...earlier.mediaIds, ...after.mediaIds])).toEqual(["visible", "visible"]);
      });
    });

    test("after a re-examination of the answered report the post is frozen again", async () => {
      // As the migrator: the answer is dated an hour back, so the release, whose cut-off is not in the future, takes it.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId, recorded } = await report(tx, aPost(p.postId), "csam");
        const answer = await decideIn(tx, admin, caseId, NO_SEAL);
        expect(await postFrozen(tx, p.postId)).toBe(false);
        await tx.execute(sql`update decisions set decided_at = decided_at - interval '1 hour' where id = ${answer}::uuid`);
        await tx.execute(sql`select public.release_outcomes(now())`);
        const reopened = await openCase(tx, "post", p.postId);
        const again = await insertItem(tx, { intakeId: recorded.intakeId, caseId: reopened, targetId: p.postId, lane: 0, reexaminesItemId: recorded.items[0]!.id });
        expect(again).toMatchObject({ suspect: true, lane: 0, case_id: reopened });
        expect(await postFrozen(tx, p.postId)).toBe(true);
      }, migrateDb);
    });

    test("a cascade from a deleted post, and from its author's deleted profile, is refused while a seal in force lists the post; a direct delete skips the kept row, and takes it once the seal is lifted", async () => {
      // As the migrator: the API role deletes no post and no profile.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        // The report names the author's account: a case about the post itself would also hold the image as its evidence,
        // and that hold would keep the row whatever became of the seal.
        const { caseId } = await report(tx, anAccount(p.authorId), "csam");
        const final = await decideIn(tx, admin, caseId, SEAL_FOR_GOOD);
        // The case is closed, no item waits and no hold stands: the seal alone keeps the row.
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
        expect(await tx.execute(sql`select 1 from media_holds where media_id = ${p.mediaIds[0]!}::uuid`)).toHaveLength(0);
        const retained = { code: "23001", message: expect.stringMatching(/^post_media row [0-9a-f-]{36} is retained$/) };
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`delete from posts where id = ${p.postId}::uuid`)))).toEqual(retained);
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`delete from profiles where id = ${p.authorId}::uuid`)))).toEqual(retained);
        // A direct delete skips the kept row.
        expect(await tx.execute(sql`delete from post_media where post_id = ${p.postId}::uuid returning id`)).toHaveLength(0);
        // Once the seal is lifted nothing keeps the row, and the direct delete takes it.
        await decideIn(tx, admin, caseId, { kind: "correction", reviewsDecisionId: final, actions: [act("unseal_media")] });
        expect(await tx.execute(sql`delete from post_media where post_id = ${p.postId}::uuid returning id`)).toHaveLength(1);
      }, migrateDb);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Replace `apps/api/test/lab/README.md` (whole file)

```markdown
# The contention lab of moderation decisions

`contention.lab.ts` measures what a decision's transaction costs and what it meets (3c design, sections 2 and 12),
against the test database with migration 0016. The design names no place for it; it lives here.

It is a database lab. It issues its statements itself, as SQL: a decision is the lock on its subject's profile row, its
row in `decisions` and its rows in `decision_actions`, whose triggers do the rest; a like, a follow, the author's
deletion and the purge are the statements the social and media repositories issue; the purge's delete is the ordered
delete by owner (`delete from post_media where id in (select id from post_media where owner_id = $1 order by id for
update) returning id`). An intake is the moderation module's `recordIntake`. It uses no code of a later task.

Every measured transaction is rolled back, so the lab leaves no decision and writes no audit row. The accounts it commits
(the large ones, written in bulk by the migrator, and the pair for the two-session rounds) are removed when it ends.

## Running it

From `apps/api`, with the scratch stack's data services up and the test database migrated:

    node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts

No suite includes it (its file ends in `.lab.ts`). It takes three to four minutes. Each measurement is one line of JSON
in `.data/lab-contention.jsonl` at the repository's root (or the file `LAB_OUT` names), with `busyPercent`: the share of
processor time, over all cores, that was not idle in the second and a half before the measurement.

## The numbers of 2026-10-04, first run: a saturated machine

PostgreSQL 18 in the scratch stack's container on a Windows machine shared with other work. The machine was saturated
throughout: `busyPercent` read 94 to 99 before every measurement, most of it other projects' containers. These numbers
are upper bounds for this hardware; the second run below, on a quieter machine, is the one the design asks for.

### An account's seal (one session; one image on each post)

| image posts | busy | decision row | seal taken while deciding | answer that ends it | seal for good | lifting it |
|---|---|---|---|---|---|---|
| 1,000 | 97% | 104 ms | 180 ms | 254 ms | 282 ms | 232 ms |
| 5,000 | 99% | 18 ms | 1,123 ms | 1,057 ms | 1,131 ms | 995 ms |

- The seal taken while deciding locks the account's image rows in id order, writes one row of `seal_posts` for each post
  and writes every image row once. At 5,000 image posts the decision and its seal take 1.1 s, 0.19% of the ten minutes a
  step-up challenge lives.
- The seal for good that follows writes every image row twice in one transaction: the answer ends the first seal (each
  row back to visible, 1.06 s at 5,000), and the new seal seals each again (1.13 s). Lifting it is a fourth write (1.0 s).
- No post row is locked by any of them.

### The purge of an account (one session)

| image rows | frozen | busy | tombstones | ordered delete | rows deleted | whole purge |
|---|---|---|---|---|---|---|
| 5,000 | no | 99% | 436 ms | 2,228 ms | 5,000 | 2.7 s |
| 5,000 | yes | 98% | 390 ms | 1,862 ms | 0 | 2.3 s |
| 20,000 | no | 94% | 1,471 ms | 6,090 ms | 20,000 | 7.6 s |
| 20,000 | yes | 97% | 1,724 ms | 5,821 ms | 0 | 7.6 s |

- The keep trigger reads the freeze once for each row: about 0.3 to 0.45 ms a row under this load, whether the row is
  then kept or deleted. The research lab's figures under load were 2 to 4 s at 5,000 rows and 7 to 16 s at 20,000; these
  lie at their lower end.
- "Frozen" is an unanswered report of child sexual abuse material about the account: every row is kept, and the delete
  answers none.

### A decision against everything else (two sessions, 40 rounds a pair, each side first in half of them)

Three decisions (an interim withhold of a post; a final removal that closes the post's case; a seal on the author's
account's case followed in the same transaction by the answer that ends it) against six other transactions (a like of
the post; a follow of the author; the author's deletion of the post; the author's purge; a notice of child sexual abuse
material that names the post and its author's account; a report of the post under a rule). Each side holds its locks for
15 ms before it rolls back. `busyPercent` was 96.

| decision | against | both completed | deadlocks | lock timeouts | longest transaction |
|---|---|---|---|---|---|
| interim withhold | like | 40 of 40 | 0 | 0 | 236 ms |
| interim withhold | follow | 40 of 40 | 0 | 0 | 116 ms |
| interim withhold | author's deletion | 40 of 40 | 0 | 0 | 158 ms |
| interim withhold | purge | 40 of 40 | 0 | 0 | 232 ms |
| interim withhold | notice naming post and account | 40 of 40 | 0 | 0 | 409 ms |
| interim withhold | report under a rule | 40 of 40 | 0 | 0 | 318 ms |
| closing removal | like | 40 of 40 | 0 | 0 | 183 ms |
| closing removal | follow | 40 of 40 | 0 | 0 | 145 ms |
| closing removal | author's deletion | 40 of 40 | 0 | 0 | 194 ms |
| closing removal | purge | 40 of 40 | 0 | 0 | 171 ms |
| closing removal | notice naming post and account | 40 of 40 | 0 | 0 | 207 ms |
| closing removal | report under a rule | 40 of 40 | 0 | 0 | 231 ms |
| account's seal and its answer | like | 40 of 40 | 0 | 0 | 254 ms |
| account's seal and its answer | follow | 40 of 40 | 0 | 0 | 210 ms |
| account's seal and its answer | author's deletion | 40 of 40 | 0 | 0 | 233 ms |
| account's seal and its answer | purge | 40 of 40 | 0 | 0 | 419 ms |
| account's seal and its answer | notice naming post and account | 40 of 40 | 0 | 0 | 264 ms |
| account's seal and its answer | report under a rule | 40 of 40 | 0 | 0 | 206 ms |

- 720 rounds, no deadlock and no lock timeout. The purge met none here either: the deadlock the design expects of it is
  with an intake that locks the account's image rows, which the intake does not do before Task 3.
- What makes this hold: a decision takes its subject's profile row first, as the author's deletion and the purge do; a
  like and a follow take that row in a mode a decision's does not conflict with; a seal locks image rows only; and an
  intake takes its cases in one order and each post's row only to read it.
- A finding the lab led to, now a test (`moderation-races.test.ts`): a report that arrives while a decision is closing
  its target's case waits where it opens a case (`insert into cases ... on conflict do nothing` waits for the transaction
  that is changing the conflicting row), and then opens a new case without a retry. The retry on `case_closed` is needed
  only when the decision has locked the case and not yet closed it when the report reads it.

## The numbers of 2026-10-04, second run: the final migration, a quieter machine

Run again after the review added a second deferred check to 0016 (queued by every row of the ledger, it runs at COMMIT,
which the lab's rolled-back transactions never reach). `busyPercent` read 17 to 28.

| image posts | busy | decision row | seal taken while deciding | answer that ends it | seal for good | lifting it |
|---|---|---|---|---|---|---|
| 1,000 | 19% | 35 ms | 70 ms | 115 ms | 110 ms | 107 ms |
| 5,000 | 17% | 7 ms | 420 ms | 463 ms | 503 ms | 465 ms |

At 5,000 image posts the seal taken while deciding takes 0.43 s with its decision, 0.07% of the challenge's ten minutes;
the seal for good that follows it writes every image row twice in under a second.

| image rows | frozen | busy | tombstones | ordered delete | rows deleted | whole purge |
|---|---|---|---|---|---|---|
| 5,000 | no | 28% | 182 ms | 888 ms | 5,000 | 1.1 s |
| 5,000 | yes | 24% | 108 ms | 791 ms | 0 | 0.9 s |
| 20,000 | no | 22% | 680 ms | 2,488 ms | 20,000 | 3.2 s |
| 20,000 | yes | 27% | 576 ms | 2,366 ms | 0 | 2.9 s |

The keep trigger costs about 0.12 to 0.18 ms a row here.

The two-session rounds at 24% busy: the same 18 pairs of 40 rounds each, every transaction completed, no deadlock and no
lock timeout, the longest transaction 124 ms.

# The lab of the intake's lock statement

`hold.lab.ts` measures what an intake's hold costs and what it meets (3c design, sections 5 and 12, Task 3), at the
repository: `MediaForCases.hold` with an owner pair, which is the statement that locks every image row on an account's
posts when a report of child sexual abuse material names the account
(`select ... from post_media m join posts p on p.id = m.post_id where m.post_id = any($1) or m.owner_id = any($2) order
by m.id for key share of m`). It also times the disposal's two statements over the same accounts, and runs the purge
against a notice about a post that quotes its author's own post. It runs against the test database with migration 0016,
through the media repository and the moderation module's own `recordIntake`; the purge is the social repository's
`purgeProfile` with the media repository's `purgeOwner` as its last act. Every measured transaction is rolled back; the
accounts it commits are removed when it ends.

    node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/hold.lab.ts

It takes about a minute and a quarter. Each measurement is one line of JSON in `.data/lab-hold.jsonl` (or the file
`LAB_OUT` names), with `busyPercent` as above. `LAB_ROUNDS` sets how many rounds the two sessions meet by chance (40
unless said).

## The numbers of 2026-10-04

Three runs on the shared Windows machine, PostgreSQL 18 in the scratch stack's container: two before the review of
Task 3 and one after its fixes. The machine was never quiet, most of the load other projects' containers:
`busyPercent` read 14 to 40 before the lock statement's runs of the first run (up to 100 before its last measurements),
14 to 83 before those of the second and 15 to 40 throughout the third. The times are upper bounds.

### The lock statement (`hold` with one owner pair; one image on each post; three runs each, a transaction of its own each)

| attached rows | run | busy | lock statement | WAL written |
|---|---|---|---|---|
| 5,000 | first | 29 to 40% | 36, 25 and 21 ms | 288, 274 and 274 kB |
| 5,000 | second | 64 to 83% | 90, 65 and 26 ms | 288, 274 and 274 kB |
| 5,000 | third | 23 to 31% | 46, 31 and 28 ms | 288, 274 and 274 kB |
| 20,000 | first | 14 to 19% | 114, 80 and 69 ms | 1,153, 1,097 and 1,097 kB |
| 20,000 | second | 14 to 76% | 102, 180 and 198 ms | 1,408, 1,097 and 1,097 kB |
| 20,000 | third | 23 to 31% | 151, 123 and 102 ms | 1,153, 1,097 and 1,097 kB |

- The research lab's figures (`lab-gate-k`, H) were 77 ms and 287 kB at 5,000 rows and 102 ms and 1.1 MB at 20,000:
  these agree. The lock writes its mark to each row it takes, though no column changes: about 55 bytes of WAL a row.
- The plan is LockRows over a Sort on `m.id` over a hash join of `post_media` and `posts`, as the design says of the
  owner form. In the test database the lab's account owns most image rows, so `post_media` is scanned whole; the sort
  took 0.6 MB of memory at 5,000 rows and 2.5 MB at 20,000.
- A whole notice on the path for child sexual abuse material that names the account (its rows, the copy of the profile,
  the hold and the snapshot) took 72, 95 and 77 ms at 5,000 rows and 104, 238 and 147 ms at 20,000; one that names a
  post of the account as well took 85, 91 and 80 ms at 5,000 and 743 (at 90% busy), 299 and 147 ms at 20,000.
- The purge's ordered delete (`purgeOwner`) right after such a notice, in the same transaction, deleted no row: 1.4,
  1.6 and 1.3 s at 5,000 rows, 5.6 and 5.5 s (73 to 100% busy) and 3.2 s (31% busy) at 20,000, the keep trigger reading
  the freeze once for each row.

### The disposal's two statements (one batch of `dropDisposable`, and `overdueDeletions`)

The account's rows are all attached. In the first two lines nothing of the account is disposable: its posts are
visible. In the last, the account is reported on the path for child sexual abuse material and every post of it is
deleted, so every row carries a mark of disposal and none may go.

| what | attached rows | busy | `dropDisposable` | `overdueDeletions` |
|---|---|---|---|---|
| nothing disposable, the freeze a condition of its own (as first built) | 5,000 | 100% | 3,332 ms | 3,332 ms |
| | 20,000 | 97% | 14,226 ms | 13,863 ms |
| nothing disposable, the marks tested first (as built now) | 5,000 | 24% | 18 ms | 8 ms |
| | 20,000 | 40% | 62 ms | 19 ms |
| every row marked and frozen (as built now) | 5,000 | 18% | 1,285 ms | 1,174 ms |
| | 20,000 | 26% | 4,148 ms | 3,666 ms |

- As first built, the predicate was `... and (marks) and (m.post_id is null or not public.post_frozen(m.post_id))`.
  The second condition names `post_media` alone, so the planner made it the filter of that table's scan and called the
  freeze for every attached image row in the table before a mark was tested. The review measured 0.9 s at 5,000 rows
  and 3.4 s at 20,000 on a quieter machine; the first two lines are the same statement on a saturated one.
- Now the marks and the freeze are one condition, `case when (marks) then (m.post_id is null or not
  public.post_frozen(m.post_id)) else false end`: it names all three tables, so it runs where they are joined, and the
  freeze is read only for a row that carries a mark. `media-cases.test.ts` pins that no scan's filter names the
  predicate, under the planner's own plan and under each join method alone.
- What remains is the last pair of lines: a frozen account whose posts are all deleted (a purged account under an
  unanswered report, or under a seal for good) costs one read of the freeze for each kept row, about 0.2 ms, at every
  round of the disposal and at every count of overdue rows, for as long as the freeze lasts.

### The purge against a notice about a post that quotes its author's own post

A report of child sexual abuse material about a post that quotes another is taken in as two items, so a notice about a
post that quotes its author's own post holds two posts of one account for share, in id order, while the purge writes
both. The lab's account has such a pair, four images on each post; the notice names the quoting post and the account.
The notice's side counts the runs the moderation module made, so a deadlock it absorbed by running again shows; nothing
runs a purge again, so a deadlock that picks the purge shows as its error.

By chance (two sessions, each side first in half the rounds, a few milliseconds ahead, each holding its locks for
15 ms before it rolls back):

| purge | rounds | busy | purge | notice | deadlocks | longest transaction |
|---|---|---|---|---|---|---|
| as first built (counters, then the posts in id order) | 200 | 95% | 200 of 200 | 200 of 200, each in one run | 0 | 528 ms |
| as built now (every post locked first, in id order) | 40 | 25% | 40 of 40 | 40 of 40, each in one run | 0 | 139 ms |

Staged (ten rounds a shape: the notice has copied the first of the two posts and is held there, the purge comes to
wait, the notice goes on to the second post):

| purge | the quoting post has the lower id | the quoted post has the lower id and was deleted by its author |
|---|---|---|
| as first built: the counters of what its posts quote, then the posts in id order | 10 of 10: the purge ends with 40P01 | not run |
| the account's posts that are not deleted locked first, in id order | 10 of 10: both complete | 10 of 10: the purge ends with 40P01 |
| every post of the account locked first, in id order (as built now) | 10 of 10: both complete | 10 of 10: both complete |

- As first built, the purge's quote counter wrote the quoted post before the ordered statement asked for the quoting
  one, which the notice held: each waited for the other. The window is one statement of the notice wide, so 200 rounds
  by chance never met it, and every staged round did. PostgreSQL ended the purge each time: a session looks for a
  deadlock once it has waited a second, and the purge was the first to wait. The notice went through in one run. A purge
  that ends this way is finished by the purge job within five minutes.
- Locking only the posts that are not deleted leaves the same wait in the second shape: a live post that quotes (or
  replies to) its author's own deleted post has that post's counter written by the purge, and a report of child sexual
  abuse material holds a deleted post like any other. So the purge locks every post of the account first.
- What stays unordered: the counters of other accounts' posts that the purged account replied to, quoted, liked or
  reposted, which the purge writes after its own posts; and the author's deletion of one post, which writes the post
  and then the post it replied to or quoted.
- Before the review this pair ran with two plain posts (and with the purge as first built): 40 of 40 on both sides in
  both runs, no deadlock, the longest transaction 307 ms at 64% busy and 200 ms at 23%.
- What the two-session tests add (`media-cases.test.ts`): when the notice locks first, the purge waits and then keeps
  every attached row; when the purge deletes first, the notice waits, locks nothing and is stored without an error.

### The contention lab again

`contention.lab.ts` issues the purge's statements as the repositories issue them since Task 3: every post of the
account locked in id order (`select id from posts where author_id = $1 order by id for update`), then the tombstones,
and the ordered delete of the image rows last. Three runs on 2026-10-04 with the intake locking image rows and placing
its holds. The first, before the review, still tombstoned by one ordered statement and met a machine at 9 to 14% busy
(53 and 93 before the two purges of 20,000 rows). The second and the third issue the statements above: the second met
a saturated machine (93 to 100% throughout), so its times say more about the machine than about the change; the third
a quiet one (6 to 16%). "Tombstones" is the lock statement and the update together.

| image rows | frozen | run | busy | tombstones | ordered delete | rows deleted | whole purge |
|---|---|---|---|---|---|---|---|
| 5,000 | no | first | 9% | 170 ms | 891 ms | 5,000 | 1.1 s |
| 5,000 | yes | first | 14% | 120 ms | 827 ms | 0 | 1.0 s |
| 20,000 | no | first | 53% | 603 ms | 4,019 ms | 20,000 | 4.6 s |
| 20,000 | yes | first | 93% | 1,440 ms | 4,249 ms | 0 | 5.7 s |
| 5,000 | no | second | 100% | 481 ms | 3,136 ms | 5,000 | 3.6 s |
| 5,000 | yes | second | 100% | 309 ms | 3,423 ms | 0 | 3.8 s |
| 20,000 | no | second | 100% | 1,934 ms | 8,112 ms | 20,000 | 10.1 s |
| 20,000 | yes | second | 100% | 2,249 ms | 8,467 ms | 0 | 10.7 s |
| 5,000 | no | third | 16% | 91 ms | 827 ms | 5,000 | 0.9 s |
| 5,000 | yes | third | 6% | 103 ms | 730 ms | 0 | 0.8 s |
| 20,000 | no | third | 13% | 442 ms | 2,207 ms | 20,000 | 2.7 s |
| 20,000 | yes | third | 13% | 481 ms | 1,977 ms | 0 | 2.5 s |

Locking the posts first costs nothing that shows: at 5,000 posts the lock statement and the update together took 91
and 103 ms, where the one ordered statement took 170 and 120 ms.

The 18 pairs of 40 rounds: in every run each transaction completed, with no deadlock and no lock timeout; the longest
transaction was 137 ms in the first (12% busy), 562 ms in the second (100% busy) and 116 ms in the third (13% busy).
The account's seal taken while deciding: 84 ms at 1,000 image posts and 2.2 s at 5,000 in the first run (13% busy; 0.4
and 1.1 s in Task 2's runs), 361 ms and 3.3 s in the second, 58 and 156 ms in the third.

### What the lab's tests found

- **A batch that was not one.** `dropDisposable` as the design writes it (`delete from post_media where id in (select
  ... order by id limit $1 for update)`) can delete more than its limit. When the planner joins the delete's rows to
  the sub-select by a nested loop, the sub-select runs again for every row; each run skips the rows this statement has
  deleted already and lets the next ones in. On a fresh test database one call deleted all 60 disposable rows under a
  limit of 25, and with hash joins, merge joins, materialising, hashed aggregation and sorting switched off it deleted
  33 of 36. The repository therefore chooses the batch in a materialized common table expression, which runs once
  whatever the plan (`with batch as materialized (select ... order by m.id limit $1 for update of m) delete from
  post_media where id in (select id from batch) returning id`); `media-cases.test.ts` holds the bound under those
  planner settings. The ordered deletes of the author's deletion and the purge have no limit, so the same re-run changes
  nothing they delete.
- **The freeze read for every row.** The disposal's two statements, above.
- **The purge and its own posts.** The staged rounds, above.
```

### Replace `apps/api/test/lab/contention.lab.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, test } from "vitest";
import type { CaseDecidedParams } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { insertAction, insertDecision } from "../../src/moderation/repo";
import {
  aPost,
  act,
  anAccount,
  decisionParams,
  ground,
  intake,
  newImageRow,
  newPostRow,
  newTestStaff,
  raised,
  removeFixtures,
  report,
  staffProfile,
  type DecisionInput,
  type TestStaff,
} from "../integration/moderation-fixtures";
import { newProfile } from "../integration/social-fixtures";
import { rolledBack } from "../integration/staff-fixtures";

/**
 * The contention lab of moderation decisions (3c design, sections 2 and 12): what a decision's transaction costs and what
 * it meets, measured against the real database with migration 0016. The lab issues the statements itself, as SQL: a
 * decision is its profile lock, its row and its ledger rows, whose triggers do the rest; a like, a follow, a deletion and
 * a purge are the statements the social and media repositories issue. Every measured transaction is rolled back, so the
 * lab writes no audit row and no decision that stays; the accounts and posts it commits for the two-session rounds and the
 * large accounts are removed at the end. It writes one line of JSON for each measurement, with how busy the machine's
 * processors were just before it. Run it by hand (see README.md); no suite includes it.
 */

/** Where the measurements go, one line of JSON each: the file LAB_OUT names, or lab-contention.jsonl in the repository's .data folder (the lab runs from apps/api). */
const OUT = process.env.LAB_OUT ?? path.resolve(process.cwd(), "../../.data/lab-contention.jsonl");
function line(name: string, result: Record<string, unknown>): void {
  const text = JSON.stringify({ name, at: new Date().toISOString(), ...result });
  mkdirSync(path.dirname(OUT), { recursive: true });
  appendFileSync(OUT, text + String.fromCharCode(10));
  console.log(`LAB ${text}`);
}

/** The share of processor time that was not idle over this many milliseconds, across all cores: how loaded the machine is. */
async function busy(ms = 1500): Promise<number> {
  const read = () => os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, all: sum.all + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle }), { idle: 0, all: 0 });
  const before = read();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = read();
  return Math.round((1 - (after.idle - before.idle) / Math.max(1, after.all - before.all)) * 100);
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

describe.skipIf(!process.env.INTEGRATION)("lab: the contention of moderation decisions", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let mod: TestStaff;
  let admin: TestStaff;
  const committed: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 8 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
  });
  afterAll(async () => {
    await removeFixtures(migrateDb, committed);
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** A committed account with this many posts of one image each, written in bulk by the migrator. */
  async function largeAccount(posts: number): Promise<{ id: string; handle: string }> {
    const [id, handle] = [randomUUID(), `lab_${randomBytes(5).toString("hex")}`];
    committed.push(id);
    await migrateDb.execute(sql`insert into profiles (id, handle, display_name) values (${id}::uuid, ${handle}, 'Lab account')`);
    await migrateDb.execute(sql`insert into posts (author_id, body, created_at) select ${id}::uuid, 'a lab post', now() - interval '40 days' from generate_series(1, ${posts}::int)`);
    await migrateDb.execute(sql`insert into post_media (owner_id, status, width, height, blurhash) select ${id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL' from generate_series(1, ${posts}::int)`);
    await migrateDb.execute(sql`analyze posts`);
    await migrateDb.execute(sql`analyze post_media`);
    // Each image goes onto the post of the same rank. The two numbered sets are joined by a hash: on fresh rows the planner
    // otherwise pairs them in a nested loop, which at 20,000 rows is 400 million comparisons.
    await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local enable_nestloop = off`);
      await tx.execute(sql`
        with p as materialized (select id, row_number() over (order by id) as n from posts where author_id = ${id}::uuid),
             i as materialized (select id, row_number() over (order by id) as n from post_media where owner_id = ${id}::uuid)
        update post_media m set post_id = p.id, position = 0, alt_text = 'a lab image' from p join i on i.n = p.n where m.id = i.id`);
    });
    await migrateDb.execute(sql`analyze post_media`);
    return { id, handle };
  }
  /**
   * One decision's statements inside `tx`, each timed: the subject's profile lock, the decision's row, each ledger row.
   * The params are built before, as the console builds them before it asks for the key: their texts are saved rows.
   */
  async function decisionWith(tx: DbTx, staff: TestStaff, subject: string, caseId: string, params: CaseDecidedParams) {
    const id = randomUUID();
    const lock = await timed(() => tx.execute(sql`select id from profiles where id = ${subject}::uuid for no key update`));
    const decision = await timed(() => insertDecision(tx, { id, caseId, decidedBy: staff.id, params }));
    const actions: number[] = [];
    for (const action of params.actions) actions.push(await timed(() => insertAction(tx, id, action)));
    return { id, lock, decision, actions };
  }
  /** The same, with the params built inside `tx`: for a single session, where nothing waits for what building them touches. */
  const decisionIn = async (tx: DbTx, staff: TestStaff, subject: string, caseId: string, input: DecisionInput) =>
    decisionWith(tx, staff, subject, caseId, await decisionParams(tx, staff, caseId, input));
  const withStaff = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(apiDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });

  test("an account's seal at 1,000 and at 5,000 image posts, and the seal for good that follows it", async () => {
    for (const posts of [1000, 5000]) {
      const owner = await largeAccount(posts);
      const load = await busy();
      await withStaff(async (tx) => {
        const { caseId } = await report(tx, anAccount(owner.id, owner.handle), "csam");
        // A seal taken while deciding: one statement locks the account's image rows in id order, one row of seal_posts for
        // each post, and every image row is written once.
        const interim = await decisionIn(tx, mod, owner.id, caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
        // The seal for good that answers the report: the answer ends the first seal (every image row written back), and
        // the second seal writes every row again.
        const final = await decisionIn(tx, admin, owner.id, caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        // And its lifting, a correction: every row written a fourth time.
        const lift = await decisionIn(tx, admin, owner.id, caseId, { kind: "correction", reviewsDecisionId: final.id, actions: [act("unseal_media")] });
        line("account seal", {
          posts,
          busyPercent: load,
          interimDecisionMs: interim.decision,
          interimSealMs: interim.actions[0],
          finalDecisionEndsInterimMs: final.decision,
          finalSealMs: final.actions[0],
          liftMs: lift.actions[0],
          challengeShare: `${(((interim.decision + interim.actions[0]!) / 600_000) * 100).toFixed(2)}% of ten minutes for the seal taken while deciding`,
        });
      });
    }
  });

  test("the purge of an account with 5,000 and with 20,000 image rows, free and frozen", async () => {
    for (const rows of [5000, 20000]) {
      const owner = await largeAccount(rows);
      for (const frozen of [false, true]) {
        const load = await busy();
        await withStaff(async (tx) => {
          if (frozen) await report(tx, anAccount(owner.id, owner.handle), "csam");
          const lock = await timed(() => tx.execute(sql`select handle from profiles where id = ${owner.id}::uuid for update`));
          // Every post of the account under a row lock, in id order, before any is written; then the tombstones. Both are
          // counted as "tombstones", as the one statement was that did both before.
          const tombstones = await timed(async () => {
            await tx.execute(sql`select id from posts where author_id = ${owner.id}::uuid order by id for update`);
            await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now(), body = '' where author_id = ${owner.id}::uuid and state <> 'deleted_by_author'`);
          });
          const profile = await timed(() => tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() where id = ${owner.id}::uuid and deleted_at is null`));
          let deleted = 0;
          // The ordered delete by owner, as the media repository issues it, last: the keep trigger reads the freeze once for each row.
          const images = await timed(async () => {
            deleted = (await tx.execute(sql`delete from post_media where id in (select id from post_media where owner_id = ${owner.id}::uuid order by id for update) returning id`)).length;
          });
          line("account purge", { imageRows: rows, frozen, busyPercent: load, profileLockMs: lock, tombstonesMs: tombstones, orderedDeleteMs: images, rowsDeleted: deleted, profileMs: profile, totalMs: lock + tombstones + images + profile });
        });
      }
    }
  });

  test("a decision against likes, follows, the author's deletion, the purge, an intake, an account's seal and a closing decision: forty rounds each, both orders", async () => {
    const [author, liker] = [await newProfile(apiDb), await newProfile(apiDb)];
    committed.push(author.id, liker.id);
    const postId = await newPostRow(apiDb, author.id);
    for (const position of [0, 1]) await newImageRow(apiDb, author.id, postId, position);
    // Committed once: the post's case under a rule, and its author's account's case on the path for child sexual abuse
    // material, with the staff profiles the decisions name. Every round's transactions roll back, so the cases never move.
    await staffProfile(apiDb, mod);
    await staffProfile(apiDb, admin);
    committed.push(mod.id, admin.id);
    const postCase = (await intake(apiDb, ground.rule(liker.id), aPost(postId))).items[0]!.caseId!;
    const accountCase = (await report(apiDb, anAccount(author.id, author.handle), "csam")).caseId;
    const pause = (tx: DbTx) => tx.execute(sql`select pg_sleep(0.015)`);
    // The params of each decision, built and their texts saved once: every decision here rolls back, so its case keeps its
    // version and its texts stay unconfirmed, and the same params decide again in the next round.
    const withhold = await decisionParams(apiDb, mod, postCase, { kind: "interim", actions: [act("withhold")] });
    const removal = await decisionParams(apiDb, mod, postCase, { kind: "final", actions: [act("remove")] });
    const seal = await decisionParams(apiDb, mod, accountCase, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    const answer = await decisionParams(apiDb, admin, accountCase, { kind: "final", outcome: "no_violation" });

    /** The decisions, each holding its locks for a moment before it rolls back. */
    const decisions: Record<string, (tx: DbTx) => Promise<unknown>> = {
      "interim withhold of the post": (tx) => decisionWith(tx, mod, author.id, postCase, withhold),
      "final removal that closes the post's case": (tx) => decisionWith(tx, mod, author.id, postCase, removal),
      "account's seal, then the answer that ends it": async (tx) => {
        await decisionWith(tx, mod, author.id, accountCase, seal);
        // The answer follows the seal in the same transaction, so it names the case's next version.
        await decisionWith(tx, admin, author.id, accountCase, { ...answer, stateVersion: answer.stateVersion + 1 });
      },
    };
    /** What runs against them, as the statements the repositories issue. */
    const others: Record<string, (tx: DbTx) => Promise<unknown>> = {
      like: async (tx) => {
        await tx.execute(sql`select deleted_at from profiles where id in (${liker.id}::uuid, ${author.id}::uuid) for key share`);
        await tx.execute(sql`update posts set like_count = like_count + 1 where id = ${postId}::uuid`);
      },
      follow: async (tx) => {
        await tx.execute(sql`select deleted_at from profiles where id in (${liker.id}::uuid, ${author.id}::uuid) for key share`);
        await tx.execute(sql`update profiles set following_count = following_count + 1 where id = ${liker.id}::uuid`);
        await tx.execute(sql`update profiles set follower_count = follower_count + 1 where id = ${author.id}::uuid`);
      },
      "author's deletion": async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${author.id}::uuid for no key update`);
        await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now(), body = '' where id = ${postId}::uuid and author_id = ${author.id}::uuid`);
        await tx.execute(sql`update profiles set post_count = greatest(0, post_count - 1) where id = ${author.id}::uuid`);
      },
      // As the repositories issue it since the deleters take their rows in id order: every post of the account locked in id
      // order before any is written, then the tombstones, and the image rows last.
      purge: async (tx) => {
        await tx.execute(sql`select handle from profiles where id = ${author.id}::uuid for update`);
        await tx.execute(sql`select id from posts where author_id = ${author.id}::uuid order by id for update`);
        await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now(), body = '' where author_id = ${author.id}::uuid and state <> 'deleted_by_author'`);
        await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() where id = ${author.id}::uuid and deleted_at is null`);
        await tx.execute(sql`delete from post_media where id in (select id from post_media where owner_id = ${author.id}::uuid order by id for update) returning id`);
      },
      "notice naming the post and its author's account": async (tx) => {
        await intake(tx, ground.csam(), [aPost(postId, 1), anAccount(author.id, author.handle, 2)]);
      },
      "report under a rule": async (tx) => {
        await intake(tx, ground.rule((await newProfile(tx as unknown as Db)).id), aPost(postId));
      },
    };

    const ROUNDS = 40;
    const load = await busy();
    for (const [decisionName, decision] of Object.entries(decisions)) {
      for (const [otherName, other] of Object.entries(others)) {
        const counts: Record<string, number> = {};
        let longest = 0;
        for (let round = 0; round < ROUNDS; round++) {
          const side = (fn: (tx: DbTx) => Promise<unknown>, delay: number) => async () => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            const start = performance.now();
            const outcome = await rolledBack(apiDb, async (tx) => {
              await fn(tx);
              await pause(tx);
            }).then(
              () => "ok",
              (err: unknown) => {
                const fromDatabase = raised(err);
                return fromDatabase ? `${fromDatabase.code} ${fromDatabase.message}` : (err as { code?: string }).code ?? String(err);
              },
            );
            longest = Math.max(longest, performance.now() - start);
            return outcome;
          };
          // Each side starts first in half the rounds, a few milliseconds ahead.
          const ahead = Math.floor(Math.random() * 8);
          const [a, b] = await Promise.all(round % 2 === 0 ? [side(decision, 0)(), side(other, ahead)()] : [side(decision, ahead)(), side(other, 0)()]);
          for (const [who, outcome] of [["decision", a], ["other", b]] as const) counts[`${who}: ${outcome}`] = (counts[`${who}: ${outcome}`] ?? 0) + 1;
        }
        line("contention", { decision: decisionName, against: otherName, rounds: ROUNDS, busyPercent: load, outcomes: counts, longestMs: Math.round(longest) });
      }
    }
  });
});
```

### Replace `apps/api/test/moderation-intake-order.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ModerationError, type ModerationDeps } from "../src/moderation/context";
import { recordIntake, type IntakeGround, type LiveTarget } from "../src/moderation/intake";

/**
 * The order of the intake's transaction (3c design, section 7.1, step 4), without a database: the transaction is a
 * stand-in that records every statement in the order it is issued and answers each as the test scripts it, the social
 * module is one that records what it is asked to lock and to copy, and the media module one that records the pairs it is
 * asked to hold and answers each post with one image. What the statements do to real rows is in the integration tests;
 * this holds only their order and how often a target's open case is read.
 */

const POST_ONE = "00000000-0000-4000-8000-000000000001";
const POST_TWO = "00000000-0000-4000-8000-000000000002";
/** An account whose id sorts before both posts': a case's kind comes before its id in the one order. */
const ACCOUNT = "00000000-0000-4000-8000-000000000000";
const TAKEN = "2026-10-04T10:00:00.000Z";

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

/**
 * The module's dependencies over a recording transaction. `openCases` says what each read of a target's open case
 * answers, in order: a case's id, or null for none; when a target's answers run out, its last one is repeated.
 */
function recording(openCases: Record<string, (string | null)[]>) {
  const dialect = new PgDialect();
  const events: string[] = [];
  const reads: Record<string, number> = {};
  /** What each stored snapshot lists as the target's images. */
  const snapshots: { target: string; media: unknown }[] = [];
  let runs = 0;
  const tx = {
    execute: async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      const statement = text.trim();
      if (statement.startsWith("select set_config('lock_timeout'")) return [];
      if (statement.startsWith("insert into intakes")) return events.push("intake"), [{ id: randomUUID() }];
      if (statement.startsWith("insert into cases")) return events.push(`open ${String(params[0])} ${String(params[1])}`), [];
      if (statement.startsWith("select id from cases")) {
        const target = String(params[1]);
        const answers = openCases[target] ?? [`case-of-${target}`];
        const answer = answers[Math.min(reads[target] ?? 0, answers.length - 1)];
        reads[target] = (reads[target] ?? 0) + 1;
        events.push(`read ${String(params[0])} ${target}`);
        return answer === null || answer === undefined ? [] : [{ id: answer }];
      }
      if (statement.startsWith("insert into intake_items")) return events.push(`item ${String(params[2])} ${String(params[3])} in ${String(params[1])}`), [{ id: randomUUID(), seq: 1 }];
      if (statement.startsWith("select to_char(")) return events.push("time"), [{ at: TAKEN }];
      if (statement.startsWith("select display_name, bio, handle from evidence_snapshots")) return [];
      if (statement.startsWith("insert into evidence_snapshots")) {
        snapshots.push({ target: String(params[2]), media: params[9] === null ? null : JSON.parse(String(params[9])) });
        return events.push(`snapshot ${String(params[1])} ${String(params[2])}`), [{ id: randomUUID(), taken_at: TAKEN }];
      }
      throw new Error(`the intake issued a statement this test does not know: ${statement}`);
    },
  };
  /** The media module's hold: every pair it was given, in order, and one image for each post it was asked to hold. */
  const media = {
    hold: async (within: unknown, pairs: readonly ({ caseId: string; postId: string } | { ownerId: string })[]) => {
      if (within !== tx) throw new Error("the hold ran outside the intake's transaction");
      events.push(`hold ${pairs.map((pair) => ("postId" in pair ? `post ${pair.postId} for ${pair.caseId}` : `owner ${pair.ownerId}`)).join(", ") || "nothing"}`);
      return new Map(pairs.flatMap((pair) => ("postId" in pair ? [[pair.postId, [{ id: `image-of-${pair.postId}`, alt: "an image", width: 1200, height: 800 }]] as const] : [])));
    },
  };
  const social = {
    lockAccounts: async () => (events.push("lock sender"), []),
    capturePost: async (_tx: unknown, id: string) => (
      events.push(`copy post ${id}`),
      { id, authorId: randomUUID(), authorHandle: "author", body: "a post", state: "visible", createdAt: new Date(TAKEN), replyToId: null, quoteOfId: null, erased: false }
    ),
    captureProfile: async (_tx: unknown, id: string) => (events.push(`copy account ${id}`), { id, handle: "named", displayName: "Named", bio: "", deleted: false }),
  };
  const apiDb = {
    transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => {
      runs++;
      events.push(`run ${runs}`);
      return fn(tx);
    },
  };
  const deps = { apiDb, social, media, config: {}, log: pino({ level: "silent" }), now: () => new Date() } as unknown as ModerationDeps;
  return { deps, events, snapshots, runs: () => runs };
}

/** The targets in an order that is not the cases' own: the account first, then the later post, then the earlier one. */
const live: LiveTarget[] = [
  { type: "account", id: ACCOUNT, position: 1, namedHandle: "Named" },
  { type: "post", id: POST_TWO, position: 2 },
  { type: "post", id: POST_ONE, position: 3 },
];

describe("the intake's transaction keeps one order", () => {
  test("every case with its item first, posts before accounts and each kind by id, whatever order the request names them in; then the copies, in that same order; then one hold for the whole intake; only then the snapshots", async () => {
    const world = recording({});
    const recorded = await recordIntake(world.deps, { ground, live });
    expect(world.events).toEqual([
      "run 1",
      "lock sender",
      "intake",
      `open post ${POST_ONE}`,
      `read post ${POST_ONE}`,
      `item post ${POST_ONE} in case-of-${POST_ONE}`,
      `open post ${POST_TWO}`,
      `read post ${POST_TWO}`,
      `item post ${POST_TWO} in case-of-${POST_TWO}`,
      `open account ${ACCOUNT}`,
      `read account ${ACCOUNT}`,
      `item account ${ACCOUNT} in case-of-${ACCOUNT}`,
      // No post is copied, and so none is locked, before the last case is taken.
      "time",
      `copy post ${POST_ONE}`,
      `copy post ${POST_TWO}`,
      `copy account ${ACCOUNT}`,
      // No image row is locked before the last post is: one hold, a pair for each post with its case, in the cases' order.
      // An account that is reported under a rule reaches no image, so it brings no pair.
      `hold post ${POST_ONE} for case-of-${POST_ONE}, post ${POST_TWO} for case-of-${POST_TWO}`,
      `snapshot post ${POST_ONE}`,
      `snapshot post ${POST_TWO}`,
      `snapshot account ${ACCOUNT}`,
    ]);
    // A post's snapshot lists the images the hold answered for it; an account's lists none.
    expect(world.snapshots).toEqual([
      { target: POST_ONE, media: [{ id: `image-of-${POST_ONE}`, alt: "an image", width: 1200, height: 800 }] },
      { target: POST_TWO, media: [{ id: `image-of-${POST_TWO}`, alt: "an image", width: 1200, height: 800 }] },
      { target: ACCOUNT, media: null },
    ]);
    // The answer lists the items as the request named them.
    expect(recorded.items.map((item) => [item.position, item.targetId])).toEqual([[1, ACCOUNT], [2, POST_TWO], [3, POST_ONE]]);
    // The same request in another order issues the same statements.
    const reversed = recording({});
    await recordIntake(reversed.deps, { ground, live: [...live].reverse() });
    expect(reversed.events).toEqual(world.events);
  });

  test("a report of child sexual abuse material that names an account brings the pair that only locks the account's images, after the posts' pairs; no other report of an account does", async () => {
    const csam: IntakeGround = { ...ground, channel: "signed_out", reporterId: null, ruleId: null, allegesIllegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" };
    const world = recording({});
    await recordIntake({ ...world.deps, social: { ...world.deps.social, postRef: async () => ({ authorId: ACCOUNT, state: "visible", quoteOfId: null }) } } as ModerationDeps, { ground: csam, live });
    expect(world.events.filter((event) => event.startsWith("hold"))).toEqual([`hold post ${POST_ONE} for case-of-${POST_ONE}, post ${POST_TWO} for case-of-${POST_TWO}, owner ${ACCOUNT}`]);
    // An account alone, reported under a rule: the hold is still asked once, for nothing.
    const plain = recording({});
    await recordIntake(plain.deps, { ground, live: [{ type: "account", id: ACCOUNT, position: 1, namedHandle: "Named" }] });
    expect(plain.events.filter((event) => event.startsWith("hold"))).toEqual(["hold nothing"]);
  });

  test("a target whose open case is read as none twice and found the third time stays in one run: the insert and the read are repeated in the same transaction", async () => {
    const world = recording({ [POST_ONE]: [null, null, "the-new-case"] });
    await recordIntake(world.deps, { ground, live: [{ type: "post", id: POST_ONE, position: 1 }] });
    expect(world.runs()).toBe(1);
    const pair = [`open post ${POST_ONE}`, `read post ${POST_ONE}`];
    expect(world.events).toEqual(["run 1", "lock sender", "intake", ...pair, ...pair, ...pair, `item post ${POST_ONE} in the-new-case`, "time", `copy post ${POST_ONE}`, `hold post ${POST_ONE} for the-new-case`, `snapshot post ${POST_ONE}`]);
  });

  test("three reads that find none start the transaction over, with no item stored without a case; after the fourth run the answer is case_closed", async () => {
    const world = recording({ [POST_TWO]: [null] });
    const err = await recordIntake(world.deps, { ground, live: [{ type: "post", id: POST_ONE, position: 1 }, { type: "post", id: POST_TWO, position: 2 }] }).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ModerationError);
    expect(err).toMatchObject({ code: "case_closed", status: 409 });
    expect(world.runs()).toBe(4);
    const pair = [`open post ${POST_TWO}`, `read post ${POST_TWO}`];
    const oneRun = (run: number) => [`run ${run}`, "lock sender", "intake", `open post ${POST_ONE}`, `read post ${POST_ONE}`, `item post ${POST_ONE} in case-of-${POST_ONE}`, ...pair, ...pair, ...pair];
    expect(world.events).toEqual([...oneRun(1), ...oneRun(2), ...oneRun(3), ...oneRun(4)]);
    // A target found on a later run is stored then: the third run's reads answer a case.
    const later = recording({ [POST_TWO]: [null, null, null, null, null, null, "a-case-at-last"] });
    const recorded = await recordIntake(later.deps, { ground, live: [{ type: "post", id: POST_TWO, position: 1 }] });
    expect(later.runs()).toBe(3);
    expect(recorded.items.map((item) => item.caseId)).toEqual(["a-case-at-last"]);
  });
});
```

### Replace `apps/api/test/staff/app-mount.test.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { createDb } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { mediaForCases } from "../../src/media";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const APP_ORIGIN = "http://localhost:8081";
const TRUSTED = "http://localhost:8080";
const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";
/** The staff prefix itself, with and without its final slash (distinct paths to Hono's router), and a path under it. */
const PROBE_PATHS = ["/api/staff", "/api/staff/", "/api/staff/probe"];

/**
 * createApp with the staff module (3a design, section 5), the console on or off. The pools are created but never connect:
 * nothing here reaches a flow. `probe` adds a stub route at each of PROBE_PATHS before the first request builds the router,
 * standing in for a route that needs no session, so a request that passes the gate can be told from one that does not: without a route
 * there, a wrong Host and a missing route both end in the same unknown-route 404, gate or no gate.
 */
function build(consoleOrigin: string | undefined, probe = false) {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN,
    TRUSTED_ORIGINS: TRUSTED,
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    ...(consoleOrigin === undefined ? {} : { CONSOLE_ORIGIN: consoleOrigin }),
  });
  const logger = pino({ level: "silent" });
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  // The media module's interface for cases, over volumes nothing here creates: no route of this test reads an image.
  const media = mediaForCases({ repo: createMediaRepo(apiDb), files: createMediaFiles({ uploadsDir: "no-uploads", storeDir: "no-store", log: logger }), log: logger });
  const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media, config, logger });
  const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  const seen: { session: unknown; method: string; path: string }[] = [];
  if (probe) {
    app.on(["GET", "POST"], PROBE_PATHS, (c) => {
      seen.push({ session: c.get("session"), method: c.req.method, path: c.req.path });
      return c.json({ ok: true });
    });
  }
  return { app, seen, auth };
}

type ErrorBody = { error: { code: string; message: string; requestId?: string } };

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

describe("the staff module in createApp", () => {
  test("with CONSOLE_ORIGIN unset, every path under /api/staff is the unknown route, whatever the request carries", async () => {
    const { app } = build(undefined);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    for (const [method, path, headers] of [
      ["GET", "/api/staff", { host: CONSOLE_HOST }],
      ["GET", "/api/staff/me", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
      // A write from a foreign origin would meet resolveSession's csrf_failed on any other path.
      ["POST", "/api/staff/signout", { host: CONSOLE_HOST, origin: "https://evil.example" }],
      // A preflight from an origin the app trusts would meet the app's CORS on any other path.
      ["OPTIONS", "/api/staff/me", { origin: TRUSTED, "access-control-request-method": "POST" }],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(accessControlHeaders(res), `${method} ${path}`).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
    }
  });

  test("with CONSOLE_ORIGIN set, the staff gate stands before every staff path, the prefix itself included", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    // Another Host: the same 404 as an unknown route, so the console cannot tell a wrong address from a console that is off.
    // Each of these paths has a route, so the 404 is the gate's: for another host, the console's host without its port, and
    // no Host at all.
    for (const path of PROBE_PATHS) {
      for (const headers of [{ host: "localhost:8080" }, { host: "console.localhost" }, {}]) {
        const res = await app.request(path, { headers });
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(404);
        expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
      }
    }
    // The console's Host with another Origin: refused by the gate before any route runs.
    const foreign = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST, origin: APP_ORIGIN } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "csrf_failed" } });
    expect(seen).toEqual([]);
    // Through the gate, a path no route answers is still the unknown route.
    expect((await app.request("/api/staff/nothing-here", { headers: { host: CONSOLE_HOST } })).status).toBe(404);
    // The console's Host reaches the route at every one of them, the prefix itself included.
    for (const path of PROBE_PATHS) expect((await app.request(path, { headers: { host: CONSOLE_HOST } })).status, path).toBe(200);
    expect(seen.map((request) => request.path)).toEqual(PROBE_PATHS);
  });

  test("a console write carrying the app's session and CSRF cookies reaches the staff route: the app's session is never resolved there", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: {
        host: CONSOLE_HOST,
        origin: CONSOLE_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: "__Host-korbat_session=not-a-session; __Host-korbat_csrf=abc",
        authorization: "Bearer not-a-token",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ session: undefined, method: "POST", path: "/api/staff/probe" }]);
  });

  test("no staff answer carries CORS headers, even to an origin the app trusts; the app's other paths keep them", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    for (const [method, headers] of [
      ["GET", { host: CONSOLE_HOST, origin: TRUSTED }],
      ["OPTIONS", { host: CONSOLE_HOST, origin: TRUSTED, "access-control-request-method": "POST" }],
      ["GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
    ] as const) {
      const res = await app.request("/api/staff/probe", { method, headers });
      expect(accessControlHeaders(res), `${method} ${headers.origin}`).toEqual([]);
    }
    // The one path test: /api/staff and what begins with /api/staff/, never a path that merely starts with the letters.
    const neighbour = await app.request("/api/staffing", { headers: { origin: TRUSTED } });
    expect(neighbour.status).toBe(404);
    expect(neighbour.headers.get("access-control-allow-origin")).toBe(TRUSTED);
    const health = await app.request("/api/health", { headers: { origin: TRUSTED } });
    expect(health.headers.get("access-control-allow-origin")).toBe(TRUSTED);
  });

  test("the enrolment routes stand behind the gate and validate their bodies before any flow runs", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const path of ["/api/staff/enroll/options", "/api/staff/enroll/verify"]) {
      const post = (headers: Record<string, string>, body: unknown) =>
        app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      // Another Host is the unknown route, another Origin the gate's refusal, a write without an Origin too.
      expect((await post({ host: "localhost:8080", origin: CONSOLE_ORIGIN }, {})).status, path).toBe(404);
      const foreign = await post({ host: CONSOLE_HOST, origin: APP_ORIGIN }, {});
      expect([path, foreign.status, ((await foreign.json()) as ErrorBody).error.code]).toEqual([path, 403, "csrf_failed"]);
      expect((await post({ host: CONSOLE_HOST }, {})).status, path).toBe(403);
      // Through the gate, a body the contracts refuse is invalid_request; the pools behind the flows are never reached.
      const invalid = await post({ host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }, { token: "short", name: "", kind: "phone" });
      expect([path, invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([path, 400, "invalid_request"]);
    }
  });

  test("the session routes stand behind the gate and requireStaff: without a staff cookie each is staff_session_required with both staff cookies cleared, before any database read", async () => {
    // The pools point at a port nothing listens on: a route that read the database would fail with another answer.
    const { app } = build(CONSOLE_ORIGIN);
    const routes = [
      ["GET", "/api/staff/me"],
      ["GET", "/api/staff/sessions"],
      ["GET", "/api/staff/keys"],
      ["GET", "/api/staff/audit"],
      ["POST", "/api/staff/signout"],
      // Step-up and the revocation it confirms: no session, no confirmation is even read.
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const;
    for (const [method, path] of routes) {
      // Another Host is still the unknown route, before any session is looked for.
      expect((await app.request(path, { method, headers: { host: "localhost:8080", origin: CONSOLE_ORIGIN } })).status, path).toBe(404);
      // The app's session cookie and a bearer token are not staff sessions.
      const res = await app.request(path, {
        method,
        headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_session=kb1_x; __Host-korbat_csrf=c", "x-csrf-token": "c", authorization: `Bearer kb1_${"A".repeat(43)}` },
      });
      expect([path, res.status, ((await res.json()) as ErrorBody).error.code]).toEqual([path, 401, "staff_session_required"]);
      const cleared = res.headers.getSetCookie();
      expect(cleared.map((line) => line.slice(0, line.indexOf("="))).sort(), path).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
      for (const line of cleared) expect(line, path).toContain("Max-Age=0");
      expect(accessControlHeaders(res), path).toEqual([]);
    }
  });

  test("a staff write with the staff cookie but without the staff CSRF header is csrf_failed, before any database read", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const [method, path] of [
      ["POST", "/api/staff/signout"],
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const) {
      const res = await app.request(path, { method, headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_staff=x; __Host-korbat_staff_csrf=y" } });
      expect([path, res.status]).toEqual([path, 403]);
      expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_failed");
      // A refused write ends nothing: the cookies stay.
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  test("the sign-in options need no session and read no database: a staff sign-in challenge for discoverable, user-verified credentials of the console", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    const res = await app.request("/api/staff/signin/options", { method: "POST", headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN } });
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: { rpId: string; challenge: string; allowCredentials?: unknown[]; userVerification: string } };
    expect(options.rpId).toBe("console.localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(Buffer.from(options.challenge, "base64url")).toHaveLength(58);
    expect(res.headers.getSetCookie()).toEqual([]);
    // The verification validates its body before any flow runs.
    const invalid = await app.request("/api/staff/signin/verify", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ response: { id: "x" } }),
    });
    expect([invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([400, "invalid_request"]);
  });

  test("no staff power remains in the app: the auth module offers no requireStaffMfa, and no source names it", () => {
    const { auth } = build(CONSOLE_ORIGIN);
    expect(Object.keys(auth)).not.toContain("requireStaffMfa");
    expect(Object.keys(auth)).toContain("requireStaff");
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const mentions = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && readFileSync(join(src, file), "utf8").includes("requireStaffMfa"));
    expect(mentions).toEqual([]);
  });

  test("staff paths keep the JSON body limit and the API's headers", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ x: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const ok = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

### Replace `apps/api/test/staff/route-table.test.ts` (whole file)

```ts
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { AuditEntry, AuditPage, CaseDecisionResponse, StaffEnrollVerifyResponse, StaffKey, StaffKeysResponse, StaffMe, StaffSession, StaffSessionsResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createSocial, socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const CONSOLE_ORIGIN = "http://console.localhost:8090";

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * The real app with every module and the console on (3a design, section 11). The database pools are created but never
 * connect: only the route table is read. Returns the app and the staff module's own routes, as it would mount them.
 */
function build() {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN: "http://localhost:8081",
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    CONSOLE_ORIGIN,
  });
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-route-table-"));
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: media.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: media.forCases, config, logger });
  const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, staff });
  // What the staff module mounts at /api/staff, as createApp mounts it.
  const staffOwn = staff.routes(CONSOLE_ORIGIN).routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
  return { app, staffOwn };
}

const isStaffPath = (p: string) => p === "/api/staff" || p.startsWith("/api/staff/");
const keyOf = (r: RouteEntry) => `${r.method} ${r.path}`;

/** Each method and path once, sorted: Hono lists a route once for every handler it chains. */
const distinct = (routes: RouteEntry[]) => [...new Set(routes.map(keyOf))].sort();

/**
 * A Hono path as a pattern: a parameter matches one segment, and a final wildcard the path itself and anything below it.
 * The app's paths hold only letters, digits, dashes, underscores and dots, so nothing else needs escaping.
 */
function patternOf(routePath: string): RegExp {
  const segments = routePath.split("/").map((segment) => {
    if (segment === "*") return ".*";
    if (segment.startsWith(":")) return "[^/]+";
    if (!/^[A-Za-z0-9_.-]*$/.test(segment)) throw new Error(`a path segment this check cannot read: ${segment}`);
    return segment.replaceAll(".", "[.]");
  });
  const last = segments.length - 1;
  // "/x/*" matches /x itself too, as Hono routes it.
  const body = segments[last] === ".*" ? `${segments.slice(0, last).join("/")}(/.*)?` : segments.join("/");
  return new RegExp(`^${body}$`);
}

/** A lower-case uuid, as a staff path's parameter (a session's handle, a case's id) takes one. */
const SAMPLE_PARAMETER = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/**
 * Paths under /api/staff a route of another module could answer, built from the staff module's own route table: each of
 * its paths with every parameter filled in, and each path that leads to one (/api/staff/signin for /signin/verify), so a
 * staff route added later is probed too; then the prefix itself, with a final slash, and a path the module does not have.
 * A foreign route that reaches one of them answers there for any method the staff module does not define, behind the gate
 * but with no app session, since createApp skips resolveSession on staff paths.
 */
function staffProbes(staffOwn: RouteEntry[]): string[] {
  const probes = new Set(["/api/staff", "/api/staff/", "/api/staff/x/y"]);
  for (const route of staffOwn) {
    if (!isStaffPath(route.path) || route.path.includes("*")) continue;
    const segments = route.path.split("/").map((segment) => (segment.startsWith(":") ? SAMPLE_PARAMETER : segment));
    for (let end = 3; end <= segments.length; end++) probes.add(segments.slice(0, end).join("/"));
  }
  return [...probes];
}

/**
 * The routes of the app that answer under /api/staff without being the staff module's own: every route not among those
 * the staff module mounts there (as many times as it mounts each) whose path lies under /api/staff or whose pattern
 * reaches a path there (staffProbes). The app's own chain,
 * registered on every path ("ALL /*"), is the one exception: request id, access log, client identity, headers and limits
 * apply to staff paths too (3a design, section 5).
 */
function foreignStaffRoutes(appRoutes: RouteEntry[], staffOwn: RouteEntry[]): string[] {
  const own = new Map<string, number>();
  for (const route of staffOwn) own.set(keyOf(route), (own.get(keyOf(route)) ?? 0) + 1);
  const probes = staffProbes(staffOwn);
  const foreign: string[] = [];
  for (const route of appRoutes) {
    const k = keyOf(route);
    if (k === "ALL /*") continue;
    const left = own.get(k) ?? 0;
    if (left > 0) {
      own.set(k, left - 1);
      continue;
    }
    const pattern = patternOf(route.path);
    if (isStaffPath(route.path) || probes.some((probe) => pattern.test(probe))) foreign.push(k);
  }
  return foreign;
}

/** A route path naming a role, a grant or a promotion: what a route that changes a role would be called. */
const ROLE_PATH = new RegExp("(^|/)(roles?|grants?|grant-role|promote|demote|make-staff|staff-role)(/|$)", "i");

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
function sources(): { path: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(SRC_ROOT).map((full) => ({ path: path.relative(SRC_ROOT, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") }));
}

/**
 * Where an account's role may be changed: the repository's statements (changeRole for grant-role, setRole for the tests)
 * are reached only through grant-role's grantRole, which only the auth index (for the command line) and grant-role's own
 * command name. A route that changed a role would have to name one of them.
 */
const ROLE_WRITERS = /\b(changeRole|setRole|grantRole)\b/;
const ROLE_WRITER_FILES = new Set(["auth/repo.ts", "auth/admin.ts", "auth/index.ts", "cli/grant-role.ts"]);
const roleWriterViolations = (files: { path: string; source: string }[]) => files.filter((f) => !ROLE_WRITER_FILES.has(f.path) && ROLE_WRITERS.test(f.source)).map((f) => f.path);

/** A member of a staff answer that would name a person beyond their public handle: an address, a device, a phone or an account. */
const PERSONAL = /email|^ip|ipHash|address|device|phone|userId|accountId|actorId|userAgent|webauthn/i;

describe("the staff routes in the route table (3a design, section 11)", () => {
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up, the confirmed revocation and the confirmed decision", () => {
    const { app } = build();
    expect(distinct(app.routes.filter((r) => isStaffPath(r.path)))).toEqual(
      [
        "ALL /api/staff/*",
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "GET /api/staff/me",
        "GET /api/staff/sessions",
        "GET /api/staff/keys",
        "GET /api/staff/audit",
        "POST /api/staff/signout",
        "POST /api/staff/step-up/options",
        "DELETE /api/staff/sessions/:handle",
        "POST /api/staff/cases/:case/decisions",
      ].sort(),
    );
  });

  test("hold no route of another module under /api/staff", () => {
    const { app, staffOwn } = build();
    expect(staffOwn.length).toBeGreaterThan(0);
    // Every staff path is probed, the ones the old fixed list left out among them.
    const probes = staffProbes(staffOwn);
    for (const p of [
      "/api/staff/audit",
      "/api/staff/keys",
      "/api/staff/signout",
      "/api/staff/signin/options",
      "/api/staff/signin/verify",
      "/api/staff/enroll/options",
      "/api/staff/enroll/verify",
      `/api/staff/sessions/${SAMPLE_PARAMETER}`,
      "/api/staff/cases",
      `/api/staff/cases/${SAMPLE_PARAMETER}`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/decisions`,
    ]) {
      expect(probes, p).toContain(p);
    }
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([]);
  });

  test("the check catches another module's route under /api/staff, a pattern that reaches it, and a second copy of a staff route", () => {
    const staffSub = new Hono();
    staffSub.use("*", async (_c, next) => next());
    staffSub.get("/me", (c) => c.text("staff"));
    staffSub.get("/audit", (c) => c.text("staff"));
    staffSub.get("/keys", (c) => c.text("staff"));
    staffSub.post("/signout", (c) => c.text("staff"));
    staffSub.post("/signin/verify", (c) => c.text("staff"));
    staffSub.post("/enroll/options", (c) => c.text("staff"));
    staffSub.delete("/sessions/:handle", (c) => c.text("staff"));
    const app = new Hono();
    app.use(async (_c, next) => next());
    app.route("/api/staff", staffSub);
    // As the social module is mounted at /api: a route of its own under /api/staff, ones whose parameter reaches a staff
    // path (with a method the staff module does not answer there, which would fall through to it), and a copy of a staff
    // route.
    const other = new Hono();
    other.get("/staff/extra", (c) => c.text("other"));
    other.get("/:section/me", (c) => c.text("other"));
    other.post("/:section/audit", (c) => c.text("other"));
    other.put("/:section/keys", (c) => c.text("other"));
    other.get("/:section/signout", (c) => c.text("other"));
    other.get("/:section/signin/verify", (c) => c.text("other"));
    other.get("/:section/enroll/:step", (c) => c.text("other"));
    other.get("/:section/sessions/:id", (c) => c.text("other"));
    other.get("/staff/me", (c) => c.text("other"));
    other.get("/profiles/:handle", (c) => c.text("other"));
    other.get("/:section/feed", (c) => c.text("other"));
    app.route("/api", other);
    const staffOwn = staffSub.routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([
      "GET /api/staff/extra",
      "GET /api/:section/me",
      "POST /api/:section/audit",
      "PUT /api/:section/keys",
      "GET /api/:section/signout",
      "GET /api/:section/signin/verify",
      "GET /api/:section/enroll/:step",
      "GET /api/:section/sessions/:id",
      "GET /api/staff/me",
    ]);
  });

  test("no route changes a role: no path names one, and only grant-role's command line reaches the statements that do", () => {
    const { app } = build();
    expect(app.routes.filter((r) => ROLE_PATH.test(r.path)).map(keyOf)).toEqual([]);
    expect(roleWriterViolations(sources())).toEqual([]);
    // The rules catch a deliberate violation.
    expect(ROLE_PATH.test("/api/staff/users/:id/role")).toBe(true);
    expect(ROLE_PATH.test("/api/admin/grant")).toBe(true);
    expect(ROLE_PATH.test("/api/profiles/:handle")).toBe(false);
    expect(
      roleWriterViolations([
        { path: "staff/routes.ts", source: "routes.post('/x', (c) => auth.grantRole(email, 'admin'))" },
        { path: "auth/flows/x.ts", source: "await deps.repo.setRole(userId, 'admin');" },
        { path: "cli/grant-role.ts", source: "await grantRole(deps, email, role);" },
      ]),
    ).toEqual(["staff/routes.ts", "auth/flows/x.ts"]);
  });

  test("no route acts as another user or reads another user's sessions, email, IP, device or phone: no staff path names an account, and no staff answer has a member that would", () => {
    const { app } = build();
    // The path parameters under /api/staff are a staff session's handle, which the revocation takes only from the
    // person's own sessions (the step-up suites show another account's is not found), and a case's id: a case, never an
    // account.
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual(["DELETE /api/staff/sessions/:handle", "POST /api/staff/cases/:case/decisions"]);
    const answers = { StaffMe, StaffSession, StaffKey, AuditEntry, StaffSessionsResponse, StaffKeysResponse, AuditPage, StaffEnrollVerifyResponse, CaseDecisionResponse };
    const members = Object.entries(answers).flatMap(([name, schema]) => Object.keys(schema.shape).map((member) => `${name}.${member}`));
    expect(members.filter((member) => PERSONAL.test(member.split(".")[1]!))).toEqual([]);
    // The browser's coarse label and the actor's public handle are what the console shows of a session and a row.
    expect(members).toContain("StaffSession.browser");
    expect(members).toContain("AuditEntry.actorHandle");
    expect(PERSONAL.test("email")).toBe(true);
    expect(PERSONAL.test("ipHash")).toBe(true);
    expect(PERSONAL.test("deviceId")).toBe(true);
  });
});
```

### Replace `packages/contracts/test/media.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  ALT_MAX_LENGTH,
  AltText,
  HiddenMedia,
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
  isHiddenMedia,
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

  test("the author's own image that moderation withheld or removed carries that state, and no other", () => {
    expect(MediaView.parse({ ...image, moderation: "withheld" })).toEqual({ ...image, moderation: "withheld" });
    expect(MediaView.parse({ ...image, moderation: "removed" })).toEqual({ ...image, moderation: "removed" });
    // A sealed image is never a media view: nobody is given its size, its blurhash, its description or its paths.
    for (const state of ["sealed", "visible", "hidden"]) expect(MediaView.safeParse({ ...image, moderation: state }).success, state).toBe(false);
    expect("moderation" in MediaView.parse(image)).toBe(false);
  });

  test("a hidden image is its id and the mark, with `sealed` only as true, and carries nothing of the image", () => {
    expect(HiddenMedia.parse({ id: id(9), hidden: true })).toEqual({ id: id(9), hidden: true });
    expect(HiddenMedia.parse({ id: id(9), hidden: true, sealed: true })).toEqual({ id: id(9), hidden: true, sealed: true });
    expect(HiddenMedia.safeParse({ id: id(9) }).success).toBe(false);
    expect(HiddenMedia.safeParse({ id: id(9), hidden: false }).success).toBe(false);
    expect(HiddenMedia.safeParse({ id: id(9), hidden: true, sealed: false }).success).toBe(false);
    // No size, no blurhash, no description and no path: a placeholder that carries one is not one.
    for (const member of ["width", "height", "blurhash", "alt", "small", "large"] as const) {
      expect(HiddenMedia.safeParse({ id: id(9), hidden: true, [member]: image[member] }).success, member).toBe(false);
    }
    expect(Object.keys(HiddenMedia.shape).sort()).toEqual(["hidden", "id", "sealed"]);
  });

  test("a post's media list holds images and hidden images side by side, in their order, on the post and on a quoted post", () => {
    const hidden = { id: id(10), hidden: true as const };
    const sealed = { id: id(11), hidden: true as const, sealed: true as const };
    const own = { ...image, id: id(12), moderation: "removed" as const };
    const media = [image, hidden, own, sealed];
    const parsed = PostView.parse({ ...post, media, quoteOf: { ...post, id: id(3), media: [hidden, image] } });
    expect(parsed.media).toEqual(media);
    expect(parsed.quoteOf).toMatchObject({ media: [hidden, image] });
    expect(parsed.media.map(isHiddenMedia)).toEqual([false, true, false, true]);
    // Something that is neither is refused.
    expect(PostView.safeParse({ ...post, media: [{ id: id(10) }] }).success).toBe(false);
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
packages/rules test:       Tests  18 passed (18)
packages/db test:       Tests  60 passed (60)
packages/contracts test:  ❯ test/media.test.ts (17 tests | 3 failed) 50ms
packages/contracts test:  Test Files  1 failed | 9 passed (10)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/moderation-cases-3c/write_blocks.py docs/superpowers/prompts/moderation-cases-3c/03-holds-images.md 3
```

Expected: 22 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/media/cases.ts`

```ts
import type { MediaSize } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { VARIANTS } from "@korbat/media-protocol";
import type { MediaDeps } from "./context";
import type { StoredFile } from "./files";
import type { CaseReach, HeldImage, HoldPair } from "./repo";
import { RECONCILE_MAX_ORPHANS } from "./sweeper";
import { WEBP_HEADER_BYTES, webpSize } from "./webp";

/**
 * How many image rows one call of dropDisposable deletes at most: half of what the reconcile pass deletes without
 * MEDIA_RECONCILE=force. The files of a batch are requested after its commit, so a crash in between loses one batch's
 * requests; with other deletions' requests lost in the same crash, those files still stay within what one reconcile
 * pass removes by itself (3c design, section 5).
 */
export const DISPOSAL_BATCH = RECONCILE_MAX_ORPHANS / 2;

/** An image file opened for staff, with the post it is on. The caller reads the handle from its start and closes it. */
export interface StaffImage {
  postId: string;
  file: StoredFile;
}

/**
 * What the moderation module needs from this one (3c design, section 5). The moderation module never names an image
 * row: it hands over its transaction, its cases and its targets, and gets back what its evidence lists and what its
 * screens count.
 */
export interface MediaForCases {
  /**
   * An intake's holds, inside its transaction: each pair `{ caseId, postId }` locks the post's image rows and places
   * the case's evidence hold on them; a pair `{ ownerId }` only locks every image row on that account's posts, for a
   * report of child sexual abuse material about the account. All rows are locked by one statement, in one id order.
   * It answers each post pair's images in position order, for the post's snapshot; an empty list means they are gone.
   */
  hold(tx: DbTx, pairs: readonly HoldPair[]): Promise<Map<string, HeldImage[]>>;
  /**
   * Opens an image file for staff, or answers null: the only function that does (gate V; 3c design, sections 6.1 and
   * 7.3). Never an image of a frozen post, a sealed image or an erased one, on whatever case the request came; and only a
   * file whose header says that it is a WebP of the size its variant and its row allow.
   */
  staffImage(mediaId: string, size: MediaSize): Promise<StaffImage | null>;
  /** What a case about this post or account reaches: counts, a day and a time, never an id, an alt text or a file. */
  reach(target: { type: "post" | "account"; id: string }): Promise<CaseReach>;
  /**
   * Deletes, in the caller's transaction, at most DISPOSAL_BATCH image rows that nothing retains and that their post's
   * deletion, their owner's purge or an erasure left behind, the lowest ids first, and answers their ids. The caller
   * asks for their files with requestDeletion after its commit, and calls again until fewer than a batch came back.
   */
  dropDisposable(tx: DbTx): Promise<string[]>;
  /** How many rows the disposal should have taken more than a day ago. */
  overdueDeletions(): Promise<number>;
  /** Asks the worker to delete the files of these images. Called after the commit of the transaction that deleted their rows. */
  requestDeletion(ids: readonly string[]): Promise<void>;
}

/** The moderation module's interface over this module's dependencies, as createMedia hands it out; the tests build it the same way. */
export function mediaForCases(deps: Pick<MediaDeps, "repo" | "files" | "log">): MediaForCases {
  /**
   * Why a file of the store is not the image its row describes, or null when it is. The store is written by the worker,
   * which runs the decoder, so the bytes are not trusted: the console is given a file only when its first bytes are those
   * of a WebP whose longer side fits the variant, and whose large variant is exactly as large as the row says.
   */
  async function fault(file: StoredFile, size: MediaSize, row: { width: number | null; height: number | null }): Promise<string | null> {
    const head = Buffer.alloc(WEBP_HEADER_BYTES);
    // Read at an explicit position, which leaves the handle's own position at the start for whoever streams the file.
    const { bytesRead } = await file.handle.read(head, 0, WEBP_HEADER_BYTES, 0);
    const stated = webpSize(head.subarray(0, bytesRead));
    if (!stated) return "not a WebP file";
    if (Math.max(stated.width, stated.height) > VARIANTS[size].edge) return "larger than its variant may be";
    if (size === "large" && (stated.width !== row.width || stated.height !== row.height)) return "not the size its row states";
    return null;
  }

  return {
    hold: (tx, pairs) => deps.repo.hold(tx, pairs),

    async staffImage(mediaId, size) {
      const access = await deps.repo.staffAccess(mediaId);
      if (!access || access.status !== "ready") return null;
      // Gate V. The image's state is asked for by name: a state this reader has not been taught opens nothing.
      const shown = access.mediaState === "visible" || access.mediaState === "withheld" || access.mediaState === "removed";
      if (!shown || access.frozen || access.erased) return null;
      const file = await deps.files.openImage(mediaId, size);
      if (!file) return null;
      let reason: string | null;
      try {
        reason = await fault(file, size, access);
      } catch (err) {
        await file.handle.close();
        throw err;
      }
      if (reason !== null) {
        await file.handle.close();
        deps.log.error({ id: mediaId, size, reason }, "media store: refused to open for staff a file that is not the image its row describes");
        return null;
      }
      return { postId: access.postId, file };
    },

    reach: (target) => deps.repo.reach(target),
    dropDisposable: (tx) => deps.repo.dropDisposable(tx, DISPOSAL_BATCH),
    overdueDeletions: () => deps.repo.overdueDeletions(),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
  };
}
```

### Create `apps/api/src/media/webp.ts`

```ts
/**
 * What a WebP file's first bytes say about it. The store is written by the worker, which runs the image decoder, so the
 * API treats every file in it as written by an attacker; before an image is handed to the staff console, its header is
 * read here (3c design, section 7.3). Nothing is decoded: the three forms of the format each state the picture's size in
 * fixed places within the first 30 bytes.
 */

/** As many bytes as the longest of the three headers needs: 12 of the container, 8 of the first chunk's name and length, 10 of its fields. */
export const WEBP_HEADER_BYTES = 30;

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));
const u16 = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
const u24 = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);

/**
 * The width and height a file states, or null when its first 30 bytes are not those of a RIFF container named WEBP whose
 * first chunk is one of the three that carry a size:
 *   - `VP8 `, lossy: a key frame (the lowest bit of its tag is clear) with the start code 9d 01 2a, then the width and
 *     the height in 14 bits each; the two bits above each are a scaling hint for the decoder, not part of the size;
 *   - `VP8L`, lossless: the signature byte 2f, then 14 bits of width less one, 14 of height less one, the alpha bit and
 *     three bits of version, which is 0;
 *   - `VP8X`, extended: after its flags and three reserved bytes, the canvas' width and height, each less one, in 24 bits.
 */
export function webpSize(head: Uint8Array): { width: number; height: number } | null {
  if (head.length < WEBP_HEADER_BYTES) return null;
  if (ascii(head, 0, 4) !== "RIFF" || ascii(head, 8, 4) !== "WEBP") return null;
  const chunk = ascii(head, 12, 4);
  if (chunk === "VP8 ") {
    if ((head[20]! & 1) !== 0 || head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return { width: u16(head, 26) & 0x3fff, height: u16(head, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (head[20] !== 0x2f || head[24]! >> 5 !== 0) return null;
    // 28 bits across four bytes; the top byte is taken apart by hand, since a shift by 24 would make the number signed.
    const low = u24(head, 21);
    const high = head[24]!;
    return { width: (low & 0x3fff) + 1, height: ((low >> 14) | ((high & 0x0f) << 10)) + 1 };
  }
  if (chunk === "VP8X") return { width: u24(head, 24) + 1, height: u24(head, 27) + 1 };
  return null;
}
```

### Create `apps/app/src/components/social/HiddenImage.tsx`

```tsx
import { Text, View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";

/** What stands in the place of an image korbat's moderation hid from this reader; it does not say why. */
export const HIDDEN_IMAGE = "Image hidden by korbat moderation";
/** What stands in the place of the reader's own image once it is sealed: nobody is shown it, its author included. */
export const SEALED_IMAGE = "Sealed: not shown to anyone, you included";

/** The API marks a hidden image as sealed only for its author; for everyone else a sealed image reads like any hidden one. */
export function hiddenImageWords(item: HiddenMedia): string {
  return item.sealed ? SEALED_IMAGE : HIDDEN_IMAGE;
}

/**
 * The placeholder of a hidden image, filling the cell or the frame it is put in. A hidden image has no file to load, no
 * description and nothing to open, so this is words in a box: no picture, and no control.
 */
export function HiddenImage({ item }: { item: HiddenMedia }) {
  return (
    <View style={{ flex: 1 }} className="items-center justify-center bg-zinc-900 px-3 py-4">
      <Text className="text-center text-sm leading-5 text-zinc-400">{hiddenImageWords(item)}</Text>
    </View>
  );
}

/**
 * The same as a small square, for the row of a quoted post's images. It is too small for the sentence and shows one
 * short word; the row says the sentence once, as text, under its squares (HiddenRowWords), so the square itself is
 * left out of what assistive technology reads, which would otherwise hear the row's sentence after a word of each square.
 */
export function HiddenThumbnail({ size }: { size: number }) {
  return (
    <View aria-hidden className="items-center justify-center border border-zinc-800 bg-zinc-900" style={{ width: size, height: size, borderRadius: 6 }}>
      <Text className="text-xs text-zinc-500">Hidden</Text>
    </View>
  );
}

/**
 * The sentence a row of small squares says under itself when it holds a hidden image: once, however many it holds. The
 * API marks a hidden image as sealed only for its author, so the sealed sentence is read only by the author of a sealed
 * image in the row; anyone else reads the sentence of a hidden image. Nothing when the row holds no hidden image.
 */
export function HiddenRowWords({ media }: { media: readonly (MediaView | HiddenMedia)[] }) {
  const hidden = media.filter(isHiddenMedia);
  if (hidden.length === 0) return null;
  return <Text className="mt-1 text-xs leading-4 text-zinc-400">{hiddenImageWords(hidden.find((item) => item.sealed) ?? hidden[0]!)}</Text>;
}
```

### Replace `apps/api/src/account/flows/export.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts and the profile are read before the first
 * byte; the profile's lists are read page by page while export.json is written, and the images, each
 * behind the media module's checked open, go first, so `missingMedia` is complete by the time the JSON
 * that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  /** The handle of the session that asked for the export: the id the auth module lists each session under. */
  currentSession: string;
  account: AccountExport;
  profile: ProfileExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, and the list of images. The three
 * modules are asked at once. `currentSession` is the handle of the session asking, which marks its
 * entry among the sessions. `pageSize` is how many rows of each profile list are read at a time; tests
 * lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSession: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images] = await Promise.all([deps.auth.exportAccount(userId), deps.social.exportProfile(userId, pageSize), deps.media.exportImages(userId)]);
  return { exportedAt: now, currentSession, account, profile, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
        // Inside the account, where the format places them; at most the cap of ten, so they are written with the account's other facts rather than paged.
        passkeys: account.passkeys.map((passkey) => ({ name: passkey.name, createdAt: iso(passkey.createdAt), lastUsedAt: isoOrNull(passkey.lastUsedAt), synced: passkey.synced, createdOn: passkey.createdOn })),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
        // Last in the profile, where the format added it (2c); the member order is part of the bytes.
        showInExplore: profile.profile.showInExplore,
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSession })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file), or that was no
 * longer the owner's to export by then: the media module reads each image's row again as it opens the
 * file, and opens none for an image deleted with its post, erased or sealed since the list was read.
 * The order of entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createModeration } from "./moderation";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "./social";
import { createStaff } from "./staff";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

// Moderation cases: the module owns its tables on the API's role and reaches the social module through an interface of
// that module's own, built over the same pool, and the image rows through the media module's interface for cases.
const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), media: media.forCases, config, logger });

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});
// Explore's ranking: a round at once, so Explore is filled on a new database or after downtime, then one every five minutes.
const stopExplore = social.startExplore(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set. Its credential work is the auth module's,
// its case work the moderation module's.
const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
  account,
  staff,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  stopExplore();
  stopPurge();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/media/context.ts` (whole file)

```ts
import type { MediaAttachment, MediaErrorCode, MediaView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { MediaFormat } from "@korbat/media-protocol";
import type { Logger } from "pino";
import type { MediaFiles } from "./files";
import type { MediaRepo } from "./repo";

/** The media codes plus the shared ones the module also raises. */
export type MediaErrorKind = MediaErrorCode | "not_found" | "invalid_request";
export type MediaErrorStatus = 400 | 404 | 409 | 413 | 415 | 503;

const MESSAGES: Record<MediaErrorKind, string> = {
  unsupported_media_type: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  file_too_large: "Images can be at most 20 MB.",
  too_many_pending_uploads: "You have too many images waiting to be posted. Post or remove some first.",
  uploads_unavailable: "Image uploads are temporarily unavailable. Try again later.",
  media_unavailable: "One of the images is not available. Remove it and add it again.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
};

/** What an iPhone calls a photo. The decoder cannot read it, so the message says what to do instead. */
export const HEIC_MESSAGE = "HEIC photos are not supported. Export the photo as JPEG and try again.";

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorKind,
    readonly status: MediaErrorStatus,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export function mediaErrorMessage(code: MediaErrorKind): string {
  return MESSAGES[code];
}

/**
 * An image of a post as this module hands it to the social module, with the image's own moderation state: the view
 * builder decides from the state and the viewer what a reader gets. A sealed image is its id and its state only (3c
 * design, section 7.10): nobody is given its size, its blurhash, its alt text or a path.
 */
export type PostImage = (Omit<MediaView, "moderation"> & { state: "visible" | "withheld" | "removed" }) | { id: string; state: "sealed" };

/**
 * What the social module needs from this one. `attach` and `detachAll` run inside the social
 * module's own transaction; `requestDeletion` runs after it committed, because files cannot be
 * rolled back. `detachAll` answers only the images that are really gone: a row a case holds, and every
 * row of a frozen post, stays, and no deletion may be requested for its files. `forPosts` never lists
 * an image of a deleted post or an erased image.
 */
export interface MediaForPosts {
  attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly MediaAttachment[] }): Promise<void>;
  detachAll(tx: DbTx, postId: string): Promise<string[]>;
  requestDeletion(ids: readonly string[]): Promise<void>;
  forPosts(postIds: readonly string[]): Promise<Map<string, PostImage[]>>;
}

/** How many uploads one account may hold that are not on a post yet. */
export const MAX_PENDING_UPLOADS = 20;

export interface MediaDeps {
  repo: MediaRepo;
  files: MediaFiles;
  /** The formats MEDIA_FORMATS enables. The worker reads the same setting. */
  formats: readonly MediaFormat[];
  /** Uploads are refused while either volume has less free space than this. */
  minFreeBytes: number;
  /** See MEDIA_RECONCILE. `on` refuses to delete many orphans at once; `force` does not; `off` skips the pass. */
  reconcileMode: "on" | "off" | "force";
  /** Counts one upload against the account's hourly limit and throws when it is used up. */
  enforceUploadLimit: (userId: string, accountCreatedAt: Date, now: Date) => Promise<void>;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/media/flows/serve.ts` (whole file)

```ts
import type { MediaSize } from "@korbat/contracts";
import type { MediaDeps } from "../context";
import type { StoredFile } from "../files";

/** Visible images of visible posts are cacheable by anyone for five minutes. Everything else depends on who asks and is never cached. */
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

/** The states in which a post or an image is still shown to someone: to everyone, or to its author alone. */
const isShown = (state: string): state is "visible" | "withheld" | "removed" => state === "visible" || state === "withheld" || state === "removed";

/**
 * Decides whether an image file may be sent. An image follows its post and its own moderation state
 * (3c design, section 7.10). When both are `visible` it is public, as 2a made it, so blocks are not
 * checked here. When either is `withheld` or `removed` it goes to its author only and is never cached.
 * Everything else is not found for everyone: an image without a post or not ready; a sealed image; an
 * image of a deleted post, whose row a case or a freeze may have kept; an image whose content, or whose
 * post's, was erased; and any state this reader has not been taught. Those are tested before the
 * author's branch, so a sealed image of a withheld or removed post is not found for its author too.
 */
export async function serve(deps: MediaDeps, request: ServeRequest): Promise<Served> {
  const access = await deps.repo.fileAccess(request.id);
  if (!access || access.status !== "ready" || !access.postState) return { kind: "not_found" };
  if (access.erased || !isShown(access.mediaState) || !isShown(access.postState)) return { kind: "not_found" };

  let cacheControl = PUBLIC_CACHE;
  if (access.postState !== "visible" || access.mediaState !== "visible") {
    if ((await request.viewer()) !== access.authorId) return { kind: "not_found" };
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

### Replace `apps/api/src/media/index.ts` (whole file)

```ts
/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import { mediaForCases } from "./cases";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles, type StoredFile } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { DISPOSAL_BATCH, mediaForCases } from "./cases";
export type { MediaForCases, StaffImage } from "./cases";
export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts, PostImage } from "./context";
export type { StoredFile } from "./files";
export type { CaseReach, HeldImage, HoldPair } from "./repo";
export type { SweepReport } from "./sweeper";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account's images, and the data export. */
export interface MediaForAccount {
  /**
   * Removes the owner's image rows, on a post or not, whatever their state, inside the account purge's transaction; the
   * ids name the files to delete. A row that a case holds, and every row of a frozen post, stays and is not answered
   * (3c design, section 7.10): the purge asks for the files of the rows it was answered, and of no other.
   */
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;
  /**
   * Asks the worker to delete the files of these images, whatever their state: an upload still waiting
   * in the uploads volume is removed first, as the sweeper removes one it gives up on, so no worker picks
   * it up after the account is gone (removing is idempotent, and costs nothing for an image whose upload
   * was taken already); then one empty request file per id, so asking twice is asking once. The account
   * purge asks inside its transaction, right after purgeOwner, so the requests are on disk before the rows
   * are gone for good.
   */
  requestDeletion(ids: readonly string[]): Promise<void>;
  /**
   * The account's ready images that it is still shown, on a post or not, each with the checked open of its large
   * variant: the store is written by the worker and not trusted, so a file is read only when it is a plain file of the
   * store's own device no larger than a variant may be, and only up to the size that check measured
   * (null, and the export lists the image as missing, otherwise). A sealed image, an image of a deleted post and an
   * erased one are not listed; `open` reads the row again and answers null for an image that has become one of those
   * since the list was read, so a seal that commits while an archive streams leaves no sealed file in it from then on.
   */
  exportImages(ownerId: string): Promise<{ id: string; open(): Promise<StoredFile | null> }[]>;
}

/** The account module's interface over this module's dependencies, as createMedia hands it out; the integration tests build it the same way. */
export function mediaForAccount(deps: MediaDeps): MediaForAccount {
  return {
    purgeOwner: (tx, ownerId) => deps.repo.purgeOwner(tx, ownerId),
    async requestDeletion(ids) {
      for (const id of ids) await deps.files.discardUpload(id);
      await deps.files.requestDeletion(ids);
    },
    exportImages: async (ownerId) =>
      (await deps.repo.readyImages(ownerId)).map((id) => ({
        id,
        // The row is read again, with the list's own condition, right before the file is opened.
        open: async () => ((await deps.repo.isExportable(ownerId, id)) ? deps.files.openImage(id, "large") : null),
      })),
  };
}

export interface CreateMediaOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The uploads volume, which the API writes, and the store volume, which it only reads. */
  uploadsDir: string;
  storeDir: string;
  formats: readonly MediaFormat[];
  minFreeBytes: number;
  /** See MEDIA_RECONCILE; defaults to `on`. */
  reconcile?: "on" | "off" | "force";
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's resolveSession. The file routes run it themselves, and only when they must. */
  resolveSession: MiddlewareHandler<AppEnv>;
  /** Image requests have their own per-IP bucket in the store the other limits use. */
  rateLimitStore: RateLimitStore;
  /** Built from the social module's write limits, so every per-account limit lives in one table. */
  enforceUploadLimit: MediaDeps["enforceUploadLimit"];
  now?: () => Date;
}

export function createMedia(options: CreateMediaOptions) {
  const deps: MediaDeps = {
    repo: createMediaRepo(options.apiDb),
    files: createMediaFiles({ uploadsDir: options.uploadsDir, storeDir: options.storeDir, log: options.logger }),
    formats: options.formats,
    minFreeBytes: options.minFreeBytes,
    reconcileMode: options.reconcile ?? "on",
    enforceUploadLimit: options.enforceUploadLimit,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forPosts: MediaForPosts = {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
  };
  const forAccount = mediaForAccount(deps);
  const forCases = mediaForCases(deps);
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the moderation module uses: an intake's holds, what a case reaches, the staff's image, the disposal. */
    forCases,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** One pass of housekeeping at the given time. The server runs it on a timer; tests call it directly. */
    sweep: (now: Date, options: { reconcile: boolean }) => sweep(deps, now, options),
    /** Starts sweeping every thirty seconds under the shared job lock, and returns the function that stops it. */
    startSweeper: (lock: JobLock) => createSweeper(deps, lock).start(),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
```

### Replace `apps/api/src/media/repo.ts` (whole file)

```ts
import { and, eq, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { mediaPath } from "@korbat/contracts";
import { postMedia, posts, profiles, type Db, type DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { MediaError, type PostImage } from "./context";

/**
 * Every SQL statement on post_media lives in this module's repository, on the korbat_api pool, and so does every
 * statement on media_holds, a case's evidence holds on image rows (3c design, section 5).
 *
 * Two rules of the database shape what is written here (3c design, section 6.1). The trigger post_media_keep decides for
 * every delete whether a row goes: it skips a row a hold retains and every row of a frozen post, so no delete below
 * filters for either, and each answers only the ids of the rows that are really gone, which are the only files a caller
 * may ask the worker to delete. And every statement that locks or deletes several image rows takes them in id order, so
 * that no two transactions ever lock one post's images in opposite orders.
 */

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

/** One hold request of an intake: a post whose images the case holds as evidence, or an account whose images are only locked. */
export type HoldPair = { caseId: string; postId: string } | { ownerId: string };

/** An image as a case's snapshot lists it. The alt text is null for an image whose content was erased. */
export interface HeldImage {
  id: string;
  alt: string | null;
  width: number;
  height: number;
}

/** What a case about a post or an account reaches: counts, a day and a time, never an id, an alt text or a file. */
export interface CaseReach {
  /** The posts the case reaches that have image rows. */
  posts: number;
  images: number;
  sealed: number;
  /** The images korbat's server would still give to some reader. */
  served: number;
  /** The creation day, in UTC, of the newest post with image rows. */
  newestPostOn: string | null;
  /** When the newest post with a served image was created. */
  newestServedAt: Date | null;
}

/** Ids as one uuid[] parameter. */
const uuidArray = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * An image the data export hands its owner: ready, in a state its author still sees (a sealed image is exported to
 * nobody, and a state this reader has not been taught is left out), not erased, and either on no post or on a post that
 * is neither deleted nor erased. A row that a case or a freeze kept after its post was deleted is in no export. The
 * query it is used in joins posts by the image's post.
 */
const EXPORTABLE = and(
  eq(postMedia.status, "ready"),
  inArray(postMedia.moderationState, ["visible", "withheld", "removed"]),
  isNull(postMedia.erasedAt),
  or(isNull(postMedia.postId), and(ne(posts.state, "deleted_by_author"), isNull(posts.erasedAt))),
);

/**
 * A row the disposal may take (3c design, section 7.9): nothing retains it (no hold stands, and its post is not frozen),
 * and its post is deleted, its owner is purged, or its post's content or its own was erased. `m` is the image row, `p`
 * its post when it has one, `o` its owner's profile. The freeze is read here only to keep kept rows out of a batch: for
 * each row that is deleted, post_media_keep decides.
 *
 * The marks and the freeze are one condition, a CASE that reads the freeze only for a row that carries a mark. As two
 * conditions the planner made the freeze the filter of the scan of post_media, since it names that table alone, and
 * called it for every attached image row in the table before any mark was tested: several index probes a row, seconds
 * for a table of thousands, however few rows were disposable. A CASE is evaluated in the order it is written, and this
 * one names all three tables, so it runs where they are joined.
 */
const DISPOSABLE = sql`(m.hold_until is null or m.hold_until <= now())
  and case when (p.state = 'deleted_by_author' or o.deleted_at is not null or p.erased_at is not null or m.erased_at is not null)
           then (m.post_id is null or not public.post_frozen(m.post_id))
           else false end`;

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

    /**
     * What serving an image file depends on: whether it is ready, its own moderation state, its post's state and author,
     * and whether its content or its post's was erased.
     */
    async fileAccess(id: string): Promise<{ status: MediaRow["status"]; mediaState: MediaRow["moderationState"]; postState: string | null; authorId: string | null; erased: boolean } | null> {
      const rows = await db
        .select({ status: postMedia.status, mediaState: postMedia.moderationState, postState: posts.state, authorId: posts.authorId, erasedAt: postMedia.erasedAt, postErasedAt: posts.erasedAt })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      const found = rows[0];
      if (!found) return null;
      return { status: found.status, mediaState: found.mediaState, postState: found.postState, authorId: found.authorId, erased: found.erasedAt !== null || found.postErasedAt !== null };
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

    /**
     * Removes a post's images, inside the transaction that deletes it, and says which files to delete afterwards. The
     * rows are taken in id order, under row locks, with no filter of its own: the keep trigger skips every row a case
     * holds and every row of a frozen post, and RETURNING omits them, so no file of a kept row is asked for. A plain
     * delete by post takes the rows in its scan's order, and deadlocked with an intake that locks the same rows by id.
     */
    async detachAll(tx: DbTx, postId: string): Promise<string[]> {
      const rows = (await tx.execute(
        sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`,
      )) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    /**
     * Removes every image row of the owner, on a post or not, whatever its state, inside the transaction
     * that purges the account, and says which files to delete afterwards (1b design, section 7.6). In id order under
     * row locks and with no filter, as detachAll: the keep trigger decides which rows stay.
     */
    async purgeOwner(tx: DbTx, ownerId: string): Promise<string[]> {
      const rows = (await tx.execute(
        sql`delete from post_media where id in (select id from post_media where owner_id = ${ownerId}::uuid order by id for update) returning id`,
      )) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    /**
     * The images of a page of posts, in one query, in their order on each post, each with its own moderation state:
     * what the state means for a reader is the view builder's to say. A sealed image is its id and its state only:
     * nobody is given its size, its blurhash, its alt text or a path. An image of a deleted post, and one whose content
     * or whose post's was erased, is given to nobody, its owner included, so no view and no export names a row that a
     * case or a freeze kept. A state this reader has not been taught is left out.
     */
    async forPosts(postIds: readonly string[]): Promise<Map<string, PostImage[]>> {
      const byPost = new Map<string, PostImage[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText, state: postMedia.moderationState })
        .from(postMedia)
        .innerJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready"), ne(posts.state, "deleted_by_author"), isNull(postMedia.erasedAt), isNull(posts.erasedAt)))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId) continue;
        let image: PostImage;
        if (row.state === "sealed") image = { id: row.id, state: "sealed" };
        else if (row.state === "visible" || row.state === "withheld" || row.state === "removed") {
          if (row.width === null || row.height === null || row.blurhash === null) continue;
          image = { id: row.id, state: row.state, width: row.width, height: row.height, blurhash: row.blurhash, alt: row.altText ?? "", small: mediaPath(row.id, "small"), large: mediaPath(row.id, "large") };
        } else {
          // A state added later does not compile until this reader says who is given it.
          const unknown: never = row.state;
          void unknown;
          continue;
        }
        byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), image]);
      }
      return byPost;
    },

    /**
     * Every image of the account that the data export takes a file for, on a post or not, oldest first: the ready ones
     * the account still sees (EXPORTABLE). A withheld or removed image stays with its author; a sealed image, an image
     * of a deleted post and an erased one are exported to nobody.
     */
    async readyImages(ownerId: string): Promise<string[]> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(eq(postMedia.ownerId, ownerId), EXPORTABLE))
        .orderBy(postMedia.createdAt, postMedia.id);
      return rows.map((row) => row.id);
    },

    /**
     * Whether readyImages would still list this image of the owner: the export reads the row again when it opens each
     * file, so an image that was sealed, erased or deleted with its post while the archive streams is left out of it.
     */
    async isExportable(ownerId: string, id: string): Promise<boolean> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), EXPORTABLE))
        .limit(1);
      return rows.length === 1;
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

    /**
     * Which of these ids have a row, whatever the row's state: the reconcile pass asks it which stored files belong to
     * no row, so a row that a hold or a freeze keeps must be seen here, or its files would be swept as orphans.
     */
    async existing(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(inArray(postMedia.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },

    // ------------------------------------------------------------ what moderation cases need

    /**
     * An intake's holds (3c design, sections 5 and 7.1, step 4), inside the intake's transaction. First one statement
     * locks, FOR KEY SHARE and in one id order, every image row the pairs name: the rows of each post and, for an owner
     * pair, every row of that owner that is on a post (an attached row's owner is its post's author, so those are the
     * images of the account's posts). The posts are read there, never locked. The lock is what makes a delete that races
     * the intake wait and then read the intake's committed item; a row whose delete committed first is not returned.
     * Then, for the post pairs only, the case's hold goes on each returned row that has no unreleased hold from that case
     * and is not erased, in id order, which is the order the holds are released in: an owner pair gets no hold, since the
     * images of a frozen post are kept whether a hold stands or not. It answers, for each post pair, the post's images
     * in position order, an erased one without its alt text; an empty list means the images are gone.
     */
    async hold(tx: DbTx, pairs: readonly HoldPair[]): Promise<Map<string, HeldImage[]>> {
      const caseOf = new Map<string, string>();
      const owners: string[] = [];
      for (const pair of pairs) {
        if ("postId" in pair) caseOf.set(pair.postId, pair.caseId);
        else owners.push(pair.ownerId);
      }
      const held = new Map<string, HeldImage[]>([...caseOf.keys()].map((postId) => [postId, []]));
      if (caseOf.size === 0 && owners.length === 0) return held;

      const locked = (await tx.execute(sql`
        select m.id, m.post_id, m.position, m.width, m.height, m.alt_text, (m.erased_at is not null or p.erased_at is not null) as erased
        from post_media m join posts p on p.id = m.post_id
        where m.post_id = any(${uuidArray([...caseOf.keys()])}) or m.owner_id = any(${uuidArray(owners)})
        order by m.id for key share of m`)) as unknown as { id: string; post_id: string; position: number; width: number; height: number; alt_text: string | null; erased: boolean }[];

      // The rows came back in id order; the holds are placed in that order too.
      const toHold = locked.filter((row) => caseOf.has(row.post_id) && !row.erased);
      if (toHold.length > 0) {
        await tx.execute(sql`
          insert into media_holds (media_id, case_id)
          select v.media_id, v.case_id
          from unnest(${uuidArray(toHold.map((row) => row.id))}, ${uuidArray(toHold.map((row) => caseOf.get(row.post_id)!))}) as v(media_id, case_id)
          where not exists (select 1 from media_holds h where h.media_id = v.media_id and h.case_id = v.case_id and h.released_at is null)
          order by v.media_id`);
      }

      for (const row of [...locked].sort((a, b) => a.position - b.position)) {
        held.get(row.post_id)?.push({ id: row.id, alt: row.erased ? null : (row.alt_text ?? ""), width: row.width, height: row.height });
      }
      return held;
    },

    /**
     * What a case about this post or this account reaches (3c design, section 6.1): the post itself, or every post
     * whose author is the account, whatever its state. One statement that locks nothing.
     */
    async reach(target: { type: "post" | "account"; id: string }): Promise<CaseReach> {
      const served = sql`m.moderation_state <> 'sealed' and p.state <> 'deleted_by_author' and m.erased_at is null and p.erased_at is null`;
      const reached = target.type === "post" ? sql`m.post_id = ${target.id}::uuid` : sql`p.author_id = ${target.id}::uuid`;
      const [row] = (await db.execute(sql`
        select count(distinct m.post_id)::int as posts,
               count(*)::int as images,
               (count(*) filter (where m.moderation_state = 'sealed'))::int as sealed,
               (count(*) filter (where ${served}))::int as served,
               to_char(max(p.created_at) at time zone 'UTC', 'YYYY-MM-DD') as newest_post_on,
               to_char(max(p.created_at) filter (where ${served}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as newest_served_at
        from post_media m join posts p on p.id = m.post_id
        where ${reached}`)) as unknown as { posts: number; images: number; sealed: number; served: number; newest_post_on: string | null; newest_served_at: string | null }[];
      return {
        posts: row!.posts,
        images: row!.images,
        sealed: row!.sealed,
        served: row!.served,
        newestPostOn: row!.newest_post_on,
        newestServedAt: row!.newest_served_at === null ? null : new Date(row!.newest_served_at),
      };
    },

    /**
     * What opening an image for staff depends on, in one query: the row with its post, its size and its own state,
     * whether its content or its post's was erased, and whether its post is frozen now. Null when no row has the id or
     * the image is on no post.
     */
    async staffAccess(id: string): Promise<{ postId: string; status: MediaRow["status"]; width: number | null; height: number | null; mediaState: MediaRow["moderationState"]; erased: boolean; frozen: boolean } | null> {
      const [row] = (await db.execute(sql`
        select m.post_id, m.status, m.width, m.height, m.moderation_state, (m.erased_at is not null or p.erased_at is not null) as erased, public.post_frozen(m.post_id) as frozen
        from post_media m join posts p on p.id = m.post_id
        where m.id = ${id}::uuid`)) as unknown as { post_id: string; status: MediaRow["status"]; width: number | null; height: number | null; moderation_state: MediaRow["moderationState"]; erased: boolean; frozen: boolean }[];
      if (!row) return null;
      return { postId: row.post_id, status: row.status, width: row.width, height: row.height, mediaState: row.moderation_state, erased: row.erased, frozen: row.frozen };
    },

    /**
     * Deletes at most `limit` disposable rows (DISPOSABLE), the lowest ids first, inside the caller's transaction, and
     * answers the ids of the rows that are gone, in id order. The candidates are locked in id order inside the delete,
     * so the disposal and an intake's hold never lock one post's images in opposite orders; a candidate that another
     * transaction is making retained is waited for, checked again and skipped, and the batch is filled from the next ids.
     * The keep trigger decides for each row: a report that froze a candidate's post after this statement began is not
     * seen by its filter, and is seen by the trigger.
     *
     * The candidates are a materialized common table expression, which runs once. As a plain sub-select of the delete
     * they could run again for every row the delete looks at, when the planner joins the two by a nested loop: each run
     * skips the rows this statement has deleted already and lets the next ones in, so one call deleted more than its
     * limit (measured: 33 rows under a limit of 25).
     */
    async dropDisposable(tx: DbTx, limit: number): Promise<string[]> {
      const rows = (await tx.execute(sql`
        with batch as materialized (
          select m.id
          from post_media m
          join profiles o on o.id = m.owner_id
          left join posts p on p.id = m.post_id
          where ${DISPOSABLE}
          order by m.id
          limit ${limit}
          for update of m)
        delete from post_media where id in (select id from batch)
        returning id`)) as unknown as { id: string }[];
      return rows.map((row) => row.id).sort();
    },

    /**
     * How many rows the disposal should have taken by now: every disposable row none of whose holds ended, and none of
     * whose marks (its own erasure, its post's deletion or erasure) was set, within the last day. A hold ends when it is
     * released or when its time passes, whichever comes first. A row whose freeze ended within the last day may be
     * counted until the next round takes it: nothing records when a freeze ends.
     */
    async overdueDeletions(): Promise<number> {
      const [row] = (await db.execute(sql`
        select count(*)::int as n
        from post_media m
        join profiles o on o.id = m.owner_id
        left join posts p on p.id = m.post_id
        where ${DISPOSABLE}
          and not exists (select 1 from media_holds h where h.media_id = m.id and least(h.released_at, h.until) > now() - interval '1 day')
          and (m.erased_at is null or m.erased_at <= now() - interval '1 day')
          and (p.deleted_at is null or p.deleted_at <= now() - interval '1 day')
          and (p.erased_at is null or p.erased_at <= now() - interval '1 day')`)) as unknown as { n: number }[];
      return row!.n;
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Replace `apps/api/src/moderation/context.ts` (whole file)

```ts
import { ModerationErrorCode } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { SocialForModeration } from "../social";

/** The moderation codes plus the shared ones the module also raises. */
export type ModerationErrorKind = ModerationErrorCode | "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type ModerationErrorStatus = 400 | 403 | 404 | 409 | 422 | 429 | 503;

/** What each code answers with over HTTP (3c design, section 10). */
const STATUS: Record<ModerationErrorKind, ModerationErrorStatus> = {
  already_reported: 409,
  case_changed: 409,
  case_closed: 409,
  staff_recused: 403,
  staff_target: 403,
  admin_required: 403,
  decision_cap: 429,
  profile_changed: 409,
  snapshot_mismatch: 409,
  snapshot_erased: 409,
  text_not_found: 409,
  invalid_decision: 422,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  service_unavailable: 503,
};

// The first three are written for the person reporting; the rest for staff, whose console words them again for the screen.
const MESSAGES: Record<ModerationErrorKind, string> = {
  already_reported: "You already reported this; it is being looked at.",
  case_changed: "The case changed since it was opened. Open it again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused: "You cannot act on this case: you, or an account close to you, are a party to it.",
  staff_target: "A final decision cannot restrict a staff account. Staff are disciplined by demotion.",
  admin_required: "Only an admin can take this decision.",
  decision_cap: "You have reached the limit on decisions for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds.",
  snapshot_erased: "The snapshot was erased. Take a fresh one and decide again.",
  text_not_found: "A text of this decision is not saved, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected failure of a moderation flow. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorKind,
    readonly status: ModerationErrorStatus = STATUS[code],
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

export function moderationErrorMessage(code: ModerationErrorKind): string {
  return MESSAGES[code];
}

/** Whether a message the database raised is one of the module's codes, which the triggers raise as their message. */
export function isModerationErrorCode(message: string): message is ModerationErrorCode {
  return ModerationErrorCode.safeParse(message).success;
}

export interface ModerationDeps {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The social module's interface: the locks on profile rows and the reads evidence is copied from. */
  social: SocialForModeration;
  /** The media module's interface: an intake's holds on image rows, which this module never names itself. */
  media: MediaForCases;
  config: Config;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/moderation/index.ts` (whole file)

```ts
/**
 * The only file outside `src/moderation/` may import. Everything else in the module is private and the architecture test
 * fails the build if another file reaches into it.
 *
 * The moderation module (3c design, section 5) runs on the API's role and owns the moderation tables: intakes and their
 * items, cases, decisions and their ledger of measures, evidence snapshots and staff texts. It inserts rows; the database
 * checks them, derives every restriction from them and refuses at commit what cannot stand. It reaches the other modules
 * only through the interfaces they export, never names an image row (the media module locks and holds a case's images for
 * it), and never sees the auth schema.
 */
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { SocialForModeration } from "../social";
import type { ModerationDeps } from "./context";
import { decide, type DecideOutcome } from "./decide";

export { ModerationError } from "./context";
export type { ModerationDeps, ModerationErrorKind } from "./context";
export type { DecideOutcome } from "./decide";

/** What the staff module needs from this one: the console's operations on cases, which its routes run behind the staff gate. */
export interface ModerationForStaff {
  /**
   * Records the decision a step-up confirmed, in one transaction with its audit row. "ended" when the confirming account
   * or key no longer opens anything, "late" when the challenge's time ran out; neither writes anything.
   */
  decide(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<DecideOutcome>;
}

export interface CreateModerationOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The social module's interface for cases: socialForModeration(apiDb). */
  social: SocialForModeration;
  /** The media module's interface for cases: media.forCases. */
  media: MediaForCases;
  config: Config;
  logger: Logger;
  now?: () => Date;
}

export function createModeration(options: CreateModerationOptions) {
  const deps: ModerationDeps = {
    apiDb: options.apiDb,
    social: options.social,
    media: options.media,
    config: options.config,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forStaff: ModerationForStaff = {
    decide: (session, confirmed, ctx) => decide(deps, session, confirmed, ctx),
  };
  return {
    deps,
    /** The interface the staff module uses. */
    forStaff,
  };
}

export type Moderation = ReturnType<typeof createModeration>;
```

### Replace `apps/api/src/moderation/intake.ts` (whole file)

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { laneFor, snapshotDigest, type Lane, type RuleId, type TdbCategory } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import type { HoldPair } from "../media";
import type { CapturedPost, CapturedProfile } from "../social";
import { ModerationError, type ModerationDeps } from "./context";
import { insertIntake, insertItem, insertSnapshot, isSerializationFailure, latestSnapshot, openCase, snapshotTime, violatedUniqueConstraint } from "./repo";

/**
 * Taking in a report, a notice or a moderator's own finding (3c design, section 7.1, step 4): one intake, one item for
 * each target it names, each item in exactly one open case, and the first copy of each target as evidence. The routes
 * that validate a request and resolve its targets come with the reports themselves; this is the transaction they run.
 */

/** What an intake alleges and who sent it: the ground's columns of the intake's row. */
export interface IntakeGround {
  kind: "user" | "finding";
  channel: "signed_in" | "signed_out" | "staff";
  /** The signed-in reporter; never set on the path for child sexual abuse material, which records no sender. */
  reporterId: string | null;
  /** The staff account behind a finding. */
  findingBy: string | null;
  /** The id under which the auth module keeps a signed-out notifier's name and address. */
  contactId: string | null;
  ruleId: RuleId | null;
  allegesIllegal: boolean;
  csam: boolean;
  category: TdbCategory;
  categoryKeyword: string | null;
  citedLaw: string | null;
  explanation: string | null;
  bonaFide: boolean;
}

/** A target that is live: a post by its id, or an account by its id with the handle it was named by. `position` is its place among the targets named, from 1. */
export type LiveTarget =
  | { type: "post"; id: string; position: number; mediaId?: string | null }
  | { type: "account"; id: string; position: number; namedHandle: string };

/** A target with nothing live: a link to a post that names no row or a deleted one, or a handle that names no account. It is stored as answered at once. */
export type DeadTarget = { type: "post"; id: string; position: number } | { type: "account"; position: number; namedHandle: string };

export interface IntakeRequest {
  ground: IntakeGround;
  live: readonly LiveTarget[];
  dead?: readonly DeadTarget[];
}

export interface RecordedItem {
  id: string;
  position: number;
  targetType: "post" | "account";
  targetId: string;
  /** Null for a target with nothing live. */
  caseId: string | null;
  seq: number | null;
  lane: Lane;
}

export interface IntakeRecorded {
  intakeId: string;
  /** The public reference: N- and ten base32 characters. */
  ref: string;
  /** The notice's token, for a signed-out notice and for every notice on the CSAM path: shown once, and stored only as its sha256. */
  token: string | null;
  /** Whether the intake's items are suspect: it is on the CSAM path, or a finding citing R2. */
  suspect: boolean;
  items: RecordedItem[];
}

/** How often the transaction is run again after a case closed under it, a deadlock or a lock timeout: in each nothing was written. */
const RETRIES = 3;
/** How often one transaction asks for a target's open case before it starts over. */
const CASE_READS = 3;
/**
 * The longest the intake waits for a lock. A case's row is held by a decision for as long as that decision's
 * transaction runs, which for a seal over thousands of images is seconds; an intake that waited longer starts over.
 */
const LOCK_TIMEOUT_MS = 10_000;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh public reference: N- and ten base32 characters from 50 random bits. */
function newRef(): string {
  const bytes = randomBytes(7);
  // 48 bits and two more: 50 in all, which a JavaScript number holds exactly.
  const bits = bytes.readUIntBE(0, 6) * 4 + (bytes[6]! & 3);
  let ref = "";
  // 50 bits, five at a time from the top.
  for (let shift = 45; shift >= 0; shift -= 5) ref += BASE32[Math.floor(bits / 2 ** shift) % 32];
  return `N-${ref}`;
}

/** Whether an intake's items are suspect, as the attach trigger forces it: the CSAM path, or a finding citing R2. */
export const isSuspect = (ground: IntakeGround) => ground.csam || ground.ruleId === "R2";

/**
 * The live targets of a suspect intake with the items korbat adds: a post's card shows the images of the post it
 * quotes, so a report of child sexual abuse material about a post that quotes another is a report about both. Each
 * quoted post that the request does not name itself becomes a target of its own, at the position of the item it was
 * added for plus 10 (the lowest such position when several named posts quote it). One level only, as a card draws one
 * quote deep: an added target brings none of its own. Read outside any transaction; a post's quote never changes.
 */
export async function withAddedTargets(deps: Pick<ModerationDeps, "social">, live: readonly LiveTarget[]): Promise<LiveTarget[]> {
  const named = new Set(live.filter((target) => target.type === "post").map((target) => target.id));
  const added = new Map<string, number>();
  for (const target of live) {
    if (target.type !== "post" || target.position > 10) continue;
    const quoted = (await deps.social.postRef(target.id))?.quoteOfId;
    if (!quoted || named.has(quoted)) continue;
    added.set(quoted, Math.min(added.get(quoted) ?? target.position, target.position));
  }
  return [...live, ...[...added].map(([id, position]): LiveTarget => ({ type: "post", id, position: position + 10 }))];
}

/** Thrown inside the transaction to roll it back and run it again: the case a target was read into closed before the read found one. */
class StartOver extends Error {}

/** A case's targets in one order for every intake: by kind (posts before accounts, as the database orders the two) and then by id. */
const byTarget = (a: LiveTarget, b: LiveTarget) => (a.type !== b.type ? (a.type === "post" ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stores one intake in one transaction, which changes nothing unless it commits. In this order:
 *   1. a signed-in reporter's profile row, FOR KEY SHARE, refusing a missing or deleted account;
 *   2. the intake's row, with a fresh reference and, for a signed-out or CSAM notice, the hash of a fresh token;
 *   3. for each live target, in the targets' order: its open case (opened when there is none) and then its item, which
 *      the attach trigger numbers into the case, so every intake takes its cases in one order and two notices that name
 *      the same targets never deadlock; only then the captures, posts in id order, each under a share lock on its post,
 *      so none holds a post while it waits for a case;
 *   4. one hold through the media module for the whole intake: the image rows of every post target, and for a suspect
 *      item about an account every image row on the account's posts, locked by one statement in one id order, with each
 *      post's case's evidence hold on its images; then a snapshot for each case that holds none yet, or, for an account,
 *      whose newest one differs from the account now, a post's listing the images the hold answered;
 *   5. for each target with nothing live, an item with no case, answered at once.
 * It is run again, up to three times, when an item's case closed in between (the attach trigger says so), on a deadlock
 * and on a lock timeout; when the last run fails the same way the answer is case_closed. A signed-in reporter who already
 * has an item on the same ground in a target's open case is answered already_reported.
 */
export async function recordIntake(deps: ModerationDeps, request: IntakeRequest): Promise<IntakeRecorded> {
  const suspect = isSuspect(request.ground);
  const live = suspect ? await withAddedTargets(deps, request.live) : [...request.live];
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => recordIn(deps, tx, { ...request, live }, suspect));
    } catch (err) {
      const constraint = violatedUniqueConstraint(err);
      if (constraint === "intake_items_reporter_once") throw new ModerationError("already_reported");
      // A reference another intake already has: one in 2^50 for each pair. The next run draws a new one.
      const startOver = err instanceof StartOver || isSerializationFailure(err) || isDeadlock(err) || isLockNotAvailable(err) || constraint === "intakes_ref_unique";
      if (!startOver) throw err;
      if (attempt >= RETRIES) throw new ModerationError("case_closed");
    }
  }
}

async function recordIn(deps: ModerationDeps, tx: DbTx, request: IntakeRequest, suspect: boolean): Promise<IntakeRecorded> {
  const { ground } = request;
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);

  // 1.
  if (ground.reporterId !== null) await deps.social.lockAccounts(tx, [ground.reporterId], "key share", true);

  // 2. The token is stored only as its hash; the answer carries it once.
  const ref = newRef();
  const token = ground.channel === "signed_out" || ground.csam ? randomBytes(32).toString("base64url") : null;
  const intakeId = await insertIntake(tx, { ...ground, ref, lookupHash: token === null ? null : createHash("sha256").update(token).digest("hex") });
  const lane = laneFor({ ruleId: ground.ruleId, allegesIllegal: ground.allegesIllegal, csam: ground.csam, category: ground.category });

  // 3. First every case with its item, in the targets' order.
  const items: RecordedItem[] = [];
  const cases = new Map<LiveTarget, string>();
  for (const target of [...request.live].sort(byTarget)) {
    let caseId: string | null = null;
    for (let read = 0; read < CASE_READS && caseId === null; read++) caseId = await openCase(tx, target.type, target.id);
    // A live target's item is never stored without a case.
    if (caseId === null) throw new StartOver();
    cases.set(target, caseId);
    const item = await insertItem(tx, {
      intakeId,
      caseId,
      targetType: target.type,
      targetId: target.id,
      position: target.position,
      lane,
      mediaId: target.type === "post" ? (target.mediaId ?? null) : null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId: target.id, caseId, seq: item.seq, lane });
  }

  // Then the captures: every post in id order under a share lock, and every account's fields. The time is the
  // transaction's start, which the snapshots' trigger stamps.
  const takenAt = await snapshotTime(tx);
  const posts = new Map<string, CapturedPost>();
  const profiles = new Map<string, CapturedProfile>();
  for (const target of cases.keys()) {
    if (target.type === "post") {
      const post = await deps.social.capturePost(tx, target.id);
      if (!post) throw new Error("a post that an intake names has no row");
      posts.set(target.id, post);
    } else {
      const profile = await deps.social.captureProfile(tx, target.id);
      if (!profile) throw new Error("an account that an intake names has no row");
      profiles.set(target.id, profile);
    }
  }

  // 4. One hold for the whole intake, after every capture, so that no image row is locked before the last post is. Each
  // post's case holds the post's images as evidence, on every ground alike. A suspect item about an account reaches every
  // image on the account's posts: the freeze keeps those from the item's commit on, without a hold, and the pair only locks
  // them, so that a delete racing this intake waits and then reads the committed item.
  const pairs: HoldPair[] = [];
  for (const [target, caseId] of cases) if (target.type === "post") pairs.push({ caseId, postId: target.id });
  for (const target of cases.keys()) if (target.type === "account" && suspect) pairs.push({ ownerId: target.id });
  const held = await deps.media.hold(tx, pairs);

  // Then the snapshots, each post's with the images the hold answered for it.
  for (const [target, caseId] of cases) {
    const before = await latestSnapshot(tx, caseId);
    if (target.type === "post") {
      const post = posts.get(target.id)!;
      if (before !== null) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "post",
        targetId: target.id,
        authorHandle: post.authorHandle,
        postState: post.state,
        postCreatedAt: post.createdAt.toISOString(),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        body: post.body,
        // The images as the media module read them under their row locks, in position order; an erased image's alt text
        // is not copied. An empty list means that the post had none, or that they were gone before this intake.
        media: held.get(target.id) ?? [],
        displayName: null,
        bio: null,
        handle: null,
      });
    } else {
      const profile = profiles.get(target.id)!;
      if (before !== null && before.displayName === profile.displayName && before.bio === profile.bio && before.handle === profile.handle) continue;
      await storeSnapshot(tx, takenAt, {
        caseId,
        targetType: "account",
        targetId: target.id,
        authorHandle: profile.handle,
        postState: null,
        postCreatedAt: null,
        replyToId: null,
        quoteOfId: null,
        body: null,
        media: null,
        displayName: profile.displayName,
        bio: profile.bio,
        handle: profile.handle,
      });
    }
  }

  // 5. An account's link that names nothing gets an id that names nothing either, whether or not a profile holds or once
  // held the handle: no stored id ties an old handle to its account.
  for (const target of request.dead ?? []) {
    const targetId = target.type === "post" ? target.id : randomUUID();
    const item = await insertItem(tx, {
      intakeId,
      caseId: null,
      targetType: target.type,
      targetId,
      position: target.position,
      lane,
      mediaId: null,
      namedHandle: target.type === "account" ? target.namedHandle.toLowerCase() : null,
    });
    items.push({ id: item.id, position: target.position, targetType: target.type, targetId, caseId: null, seq: null, lane });
  }
  items.sort((a, b) => a.position - b.position);
  return { intakeId, ref, token, suspect, items };
}

type SnapshotContent = Omit<Parameters<typeof insertSnapshot>[1], "salt" | "digest">;

/**
 * One snapshot: a salt of the server's own, and the digest over the salt, the time and everything copied. The time in
 * the digest is the one the database stamps the row with; when the two differ the transaction is rolled back, since the
 * stored row would not recompute to its digest.
 */
async function storeSnapshot(tx: DbTx, takenAt: string, content: SnapshotContent): Promise<void> {
  const salt = randomBytes(32).toString("hex");
  const digest = await snapshotDigest({
    salt,
    targetType: content.targetType,
    targetId: content.targetId,
    takenAt,
    authorHandle: content.authorHandle,
    postState: content.postState,
    postCreatedAt: content.postCreatedAt,
    replyToId: content.replyToId,
    quoteOfId: content.quoteOfId,
    body: content.body,
    media: content.media,
    displayName: content.displayName,
    bio: content.bio,
    handle: content.handle,
  });
  const stored = await insertSnapshot(tx, { ...content, salt, digest });
  if (stored.takenAt !== takenAt) throw new Error("a snapshot was stamped at another time than its digest covers");
}
```

### Replace `apps/api/src/social/flows/export.ts` (whole file)

```ts
import type { PostImage } from "../../media";
import { SocialError, type SocialDeps } from "../context";
import type { ExportKey, ExportPage, ExportedPostRow, HandleRefRow, PostRefRow } from "../repo";

/** An image on one of the exported posts, as the media module reports it; the account module names its file in the archive. */
export interface ExportedMedia {
  id: string;
  altText: string;
  width: number;
  height: number;
}

export type ExportedPost = ExportedPostRow & { media: ExportedMedia[] };

/**
 * The social module's part of the data export (1b design, section 7.5): the profile with every handle
 * it ever had and its Explore switch (2c design, section 8), every post it wrote whatever its state,
 * with its images, what it liked, reposted and bookmarked, and the accounts it follows, blocks and
 * mutes by the handle they have now. Times are Dates here; the account module writes them as ISO text.
 *
 * The profile is read at once; each list is read page by page while the account module writes it, so
 * an account with many rows never has them all in memory. A list can be iterated more than once; each
 * iteration reads it again from the start.
 */
export interface ProfileExport {
  profile: { handle: string; displayName: string; bio: string; createdAt: Date; handleHistory: string[]; showInExplore: boolean };
  posts: AsyncIterable<ExportedPost[]>;
  likes: AsyncIterable<PostRefRow[]>;
  reposts: AsyncIterable<PostRefRow[]>;
  bookmarks: AsyncIterable<PostRefRow[]>;
  following: AsyncIterable<HandleRefRow[]>;
  blocks: AsyncIterable<HandleRefRow[]>;
  mutes: AsyncIterable<HandleRefRow[]>;
}

/** Rows per page of an export list: one statement each, and at most this many rows of a list in memory at once. */
export const EXPORT_PAGE_SIZE = 1_000;

/**
 * A list read in keyset pages, in (created_at, id) order: each page starts after the key of the last row
 * of the page before, and is read only once that page has been used. The walk ends at a page that is not
 * full.
 */
function paged<T>(read: (after: ExportKey | null) => Promise<ExportPage<T>>): AsyncIterable<T[]> {
  return {
    async *[Symbol.asyncIterator]() {
      let after: ExportKey | null = null;
      do {
        const page: ExportPage<T> = await read(after);
        if (page.rows.length > 0) yield page.rows;
        after = page.next;
      } while (after !== null);
    },
  };
}

/**
 * Each page of posts with its images, fetched from the media module for that page's posts only. The author's own
 * withheld and removed images are listed like any other: they stay with their author. A sealed image is exported to
 * nobody, its author included, so the list does not name it (3c design, section 7.10), and the media module lists no
 * image of a deleted post and no erased image at all.
 */
function withMedia(deps: SocialDeps, pages: AsyncIterable<ExportedPostRow[]>): AsyncIterable<ExportedPost[]> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const rows of pages) {
        const media: Map<string, PostImage[]> = await deps.media.forPosts(rows.map((post) => post.id));
        yield rows.map((post) => ({
          ...post,
          media: (media.get(post.id) ?? []).flatMap((image) => (image.state === "sealed" ? [] : [{ id: image.id, altText: image.alt, width: image.width, height: image.height }])),
        }));
      }
    },
  };
}

export async function exportProfile(deps: SocialDeps, userId: string, pageSize: number = EXPORT_PAGE_SIZE): Promise<ProfileExport> {
  const head = await deps.repo.exportHead(userId);
  if (!head) throw new SocialError("not_found", 404);

  // handle_history holds the handle chosen at onboarding and every one later left behind, so the current handle
  // is there only when the account went back to one it had before; the list names every handle, the current one included.
  const handleHistory = [...head.handleHistory];
  const current = head.profile.handle.toLowerCase();
  if (!handleHistory.includes(current)) handleHistory.push(current);

  return {
    profile: {
      handle: head.profile.handle,
      displayName: head.profile.displayName,
      bio: head.profile.bio,
      createdAt: head.profile.createdAt,
      handleHistory,
      showInExplore: head.showInExplore,
    },
    posts: withMedia(
      deps,
      paged((after) => deps.repo.exportPosts(userId, after, pageSize)),
    ),
    likes: paged((after) => deps.repo.exportPostRefs(userId, "likes", after, pageSize)),
    reposts: paged((after) => deps.repo.exportPostRefs(userId, "reposts", after, pageSize)),
    bookmarks: paged((after) => deps.repo.exportPostRefs(userId, "bookmarks", after, pageSize)),
    following: paged((after) => deps.repo.exportHandleRefs(userId, "follows", after, pageSize)),
    blocks: paged((after) => deps.repo.exportHandleRefs(userId, "blocks", after, pageSize)),
    mutes: paged((after) => deps.repo.exportHandleRefs(userId, "mutes", after, pageSize)),
  };
}
```

### Replace `apps/api/src/social/flows/posts.ts` (whole file)

```ts
import type { CreatePostRequest, Pagination, PostView, ThreadResponse } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { PostRow, ProfileRow } from "../repo";
import { isTombstone, loadPostViews, pageCursor, postView, postViews } from "../views";
import { postAccess } from "../visibility";

/** The viewer's own profile row; the tiers need its creation time. */
export async function ownProfile(deps: SocialDeps, viewer: string): Promise<ProfileRow> {
  const profile = (await deps.repo.findProfiles([viewer])).get(viewer);
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/**
 * A post the viewer wants to act on. The post's own state is judged first, so someone probing ids
 * learns nothing about hidden or deleted posts from a block. Then the refusal is directional: when
 * the viewer blocked the author it is `blocked`; when the author blocked the viewer it is
 * `hiddenCode`, which reveals nothing.
 */
export async function targetPost(deps: SocialDeps, viewer: string, id: string, hiddenCode: "not_found" | "post_unavailable" = "not_found"): Promise<PostRow> {
  const hidden = () => new SocialError(hiddenCode, hiddenCode === "not_found" ? 404 : 400);
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw hidden();
  if (postAccess(viewer, row, false) !== "shown") throw hidden();
  if (row.authorId !== viewer) {
    const relation = await deps.repo.relation(viewer, row.authorId);
    if (relation.blocked) throw new SocialError("blocked", 403);
    if (relation.blockedBy) throw hidden();
  }
  return row;
}

export async function createPost(deps: SocialDeps, viewer: string, input: CreatePostRequest): Promise<PostView> {
  const me = await ownProfile(deps, viewer);
  const action = input.replyToId ? "reply" : input.quoteOfId ? "quote" : "post";
  const targetId = input.replyToId ?? input.quoteOfId;
  const target = targetId ? await targetPost(deps, viewer, targetId, "post_unavailable") : null;
  await enforceWriteLimit(deps.limits, viewer, action, me.createdAt, deps.now());
  const id = await deps.repo.createPost({
    authorId: viewer,
    body: input.body,
    replyToId: input.replyToId ?? null,
    quoteOfId: input.quoteOfId ?? null,
    now: deps.now(),
    lockWith: target && target.authorId !== viewer ? target.authorId : null,
    within: (tx, postId) => deps.media.attach(tx, { postId, ownerId: viewer, items: input.media }),
  });
  return (await postView(deps, viewer, id))!;
}

export async function getPost(deps: SocialDeps, viewer: ViewerId, id: string): Promise<PostView> {
  const view = await postView(deps, viewer, id);
  if (!view) throw new SocialError("not_found", 404);
  return view;
}

/** Author only. Deleting twice is a no-op. Someone who may not see the post learns nothing. */
export async function deletePost(deps: SocialDeps, viewer: string, id: string): Promise<void> {
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw new SocialError("not_found", 404);
  if (row.authorId === viewer) {
    // The image rows go with the post, in its transaction. Their files are deleted after the commit: files cannot be rolled back.
    // The media module answers only the rows that are gone: an image a case holds as evidence, and every image of a frozen
    // post, keeps its row, served to nobody, and no deletion is asked for its files.
    let images: string[] = [];
    await deps.repo.deletePost(id, viewer, deps.now(), async (tx) => {
      images = await deps.media.detachAll(tx, id);
    });
    await deps.media.requestDeletion(images);
    return;
  }
  const blocked = (await deps.repo.blockedEitherWay(viewer, [row.authorId])).has(row.authorId);
  if (postAccess(viewer, row, blocked) !== "shown") throw new SocialError("not_found", 404);
  throw new SocialError("not_author", 403);
}

/** The post, its ancestors root first (tombstones where needed), and a page of direct replies oldest first. */
export async function thread(deps: SocialDeps, viewer: ViewerId, id: string, query: Pagination): Promise<ThreadResponse> {
  const post = await getPost(deps, viewer, id);
  const ancestorIds = await deps.repo.ancestorIds(id);
  const loaded = await loadPostViews(deps, viewer, ancestorIds);
  const ancestors = ancestorIds.map((ancestorId) => loaded.get(ancestorId)!);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await deps.repo.replies(id, viewer, cursor, query.limit);
  const items = await postViews(deps, viewer, rows);
  return { ancestors: ancestors.map((a) => (isTombstone(a) ? a : a)), post, replies: { items, nextCursor: pageCursor(rows, query.limit) } };
}
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { startExplore } from "./explore";
import { exportProfile, type ProfileExport } from "./flows/export";
import { createSocialRepo, type AccountLockMode, type CapturedPost, type CapturedProfile } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { AccountLockMode, CapturedPost, CapturedProfile } from "./repo";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, as its last
   * act, for the media rows. Safe to repeat: a second run changes nothing.
   */
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  /**
   * The profile, read at once, and its posts with their images, its engagement and its side of the graph,
   * each read in keyset pages of `pageSize` rows (1,000 unless a test says otherwise) as it is iterated.
   */
  exportProfile(userId: string, pageSize?: number): Promise<ProfileExport>;
}

/**
 * What the moderation module needs from this one (3c design, section 5): the locks on profile rows that order a case's
 * transactions against everything else an account does, and the reads a case's evidence and its rules are built from.
 * The moderation module owns no table of this one and never writes to one.
 */
export interface SocialForModeration {
  /** Locks these profile rows in id order, in one statement; with `live`, a missing or deleted account is refused (not_found). */
  lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live?: boolean): Promise<{ id: string; deleted: boolean }[]>;
  /** The post, locked `for share`, as evidence copies it, or null; its body is empty when its content was erased. */
  capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null>;
  /** The account's handle, display name and bio as evidence copies them, or null. */
  captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null>;
  /**
   * The account a handle names. With `withDeleted`, for a report of child sexual abuse material, also a deleted profile
   * and the account of a handle it has left; without it, only a live profile that holds the handle now.
   */
  findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null>;
  /** Who wrote the post, or null when no row has the id. */
  postAuthor(postId: string): Promise<string | null>;
  /** The post's author, state and the post it quotes, or null when no row has the id; no lock. */
  postRef(postId: string): Promise<{ authorId: string; state: "visible" | "withheld" | "removed" | "deleted_by_author"; quoteOfId: string | null } | null>;
}

/**
 * The moderation module's interface over the social repository on the pool it is given. A factory of its own, not a
 * member of createSocial's result: the social module's views take facts from the moderation module, which is therefore
 * built between the two.
 */
export function socialForModeration(apiDb: Db): SocialForModeration {
  const repo = createSocialRepo(apiDb);
  return {
    lockAccounts: (tx, ids, mode, live) => repo.lockAccounts(tx, ids, mode, live),
    capturePost: (tx, postId) => repo.capturePost(tx, postId),
    captureProfile: (tx, accountId) => repo.captureProfile(tx, accountId),
    findAccountByHandle: (handle, withDeleted) => repo.findAccountByHandle(handle, withDeleted),
    postAuthor: (postId) => repo.postAuthor(postId),
    postRef: (postId) => repo.postRef(postId),
  };
}

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
    /**
     * Starts the Explore refresh under the shared job lock: a round at once, then one every five minutes. Returns the
     * function that stops the timer.
     */
    startExplore: (lock: JobLock) => startExplore(deps, lock),
  };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { EXPLORE_V1, type ExploreFormula } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { isUniqueViolation } from "../auth";
import { SocialError } from "./context";
import type { Cursor, ExploreCursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

/**
 * What a round of the Explore refresh did: nothing, because the newest ranking is younger than the formula's minimum
 * gap, or a new ranking under `generation` with the posts that passed the candidate predicate, the posts it holds and
 * the milliseconds it took.
 */
export type ExploreRefresh = { skipped: true } | { skipped: false; generation: number; candidates: number; items: number; tookMs: number };

/** One row of an Explore page: the post, and its place in the ranking, which orders the page and is never answered. */
export interface ExploreRow {
  postId: string;
  position: number;
}

/**
 * What one statement found for a page of Explore: the current generation (null before the first round); the ranking
 * read, the cursor's or else the current one, with its time, when it is kept (null otherwise); the position of the
 * cursor's post in that ranking (null when the ranking does not hold it; 0 without a cursor); and the rows after that
 * position that pass the page's filters, in order, at most the limit asked for.
 */
export interface ExplorePageRead {
  current: number | null;
  ranking: { generation: number; asOf: Date } | null;
  after: number | null;
  rows: ExploreRow[];
}

/**
 * What the author's status needs to know about one post before any judgement: who wrote it, whether it is a reply or a
 * quote, whether it is visible, whether its author shows in Explore, whether it is older than the window at the request
 * time, and the current ranking, if there is one, with its time, whether it holds the post and whether the post was
 * written after it.
 */
export interface ExploreFacts {
  authorId: string;
  reply: boolean;
  quote: boolean;
  visible: boolean;
  shown: boolean;
  outsideWindow: boolean;
  ranking: { generation: number; asOf: Date; holdsPost: boolean; postIsNewer: boolean } | null;
}

/**
 * The status's judgement of one post: whether it meets every rule of the formula as of the request time and as of the
 * ranking's time, and how many places the ranking gives the post's author and holds in all.
 */
export interface ExploreJudgement {
  metNow: boolean;
  metAtRanking: boolean;
  authorPlaces: number;
  places: number;
}

/** The two modes a profile row is locked in for a moderation case: a decision's on its subject, and a report's on its sender. */
export type AccountLockMode = "no key update" | "key share";

/** A post as a case's evidence copies it. `body` is empty when the post's content was erased (`erased`). */
export interface CapturedPost {
  id: string;
  authorId: string;
  authorHandle: string;
  body: string;
  state: StoredPostState;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  erased: boolean;
}

/** An account's profile fields as a case's evidence copies them. */
export interface CapturedProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  deleted: boolean;
}

interface RawCapturedPost {
  id: string;
  author_id: string;
  author_handle: string;
  body: string;
  state: StoredPostState;
  created_at: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  erased: boolean;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A row of the Explore page statement: the page's facts on every row, and a post on each row but a lone one for an empty page. */
interface RawExplorePage {
  current: number | null;
  generation: number | null;
  as_of: string | null;
  after: number | null;
  post_id: string | null;
  position: number | null;
}

interface RawExploreFacts {
  author_id: string;
  reply: boolean;
  quote: boolean;
  visible: boolean;
  shown: boolean;
  outside_window: boolean;
  generation: number | null;
  as_of: string | null;
  holds_post: boolean;
  newer: boolean | null;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_COLUMNS = sql`id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at`;
const PROFILE_SELECT = sql`select ${PROFILE_COLUMNS} from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

/** Durations built in SQL from the formula's numbers, so each number travels as a parameter. */
const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;

/**
 * The rules of one Explore formula as of one time (2c design, section 7), as SQL fragments. The refresh ranks with them
 * and the author's status judges one post with them, so the two cannot disagree; the time and every number of the formula
 * travel as parameters. `post` narrows the candidates and the engagement to one post, which the status reads through that
 * post's own indexes; the rules are the same either way.
 */
function exploreRules(asOf: Date, formula: ExploreFormula) {
  const at = sql`${asOf.toISOString()}::timestamptz`;
  // A candidate is younger than the window, and only engagement inside the window counts.
  const since = sql`${at} - ${hours(formula.windowHours)}`;
  // Engagement counts once it has stood this long, so a like made just before a round and undone after it never counts.
  const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
  const onePost = (column: SQL, post?: string): SQL => (post ? sql` and ${column} = ${post}::uuid` : sql.empty());
  /**
   * The one candidate predicate: visible top-level posts that are not quotes, by live authors who have not switched
   * Explore off, created in the window up to the time. Later rules about imports, suspension and restoration belong here.
   */
  const candidates = (post?: string): SQL => sql`
    select p.id, p.author_id, p.created_at from posts p join profiles a on a.id = p.author_id
    where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > ${since} and p.created_at <= ${at}
      and a.deleted_at is null and a.show_in_explore${onePost(sql`p.id`, post)}`;
  /**
   * The engagement that counts, read from the candidates `c`: likes and reposts in the window that have stood long enough,
   * by live accounts other than the author that were old enough when they engaged.
   */
  const engagement = (post?: string): SQL => sql`
    select x.post_id, x.user_id from (
      select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
      union all
      select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
    ) x
    join c on c.id = x.post_id
    join profiles u on u.id = x.user_id
    where x.user_id <> c.author_id and u.deleted_at is null and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}`;
  /** The approving accounts per post, read from the engagement `e`: each counted once however it engaged, for the posts that reach the threshold. */
  const approvers = sql`select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}`;
  return {
    at,
    since,
    candidates,
    engagement,
    approvers,
    /**
     * Whether `post` is a candidate that reaches the threshold: the three fragments as the CTEs c, e and ap of a subquery
     * of their own, so one statement can ask at two times.
     */
    met: (post: string): SQL => sql`exists (with c as (${candidates(post)}), e as (${engagement(post)}), ap as (${approvers}) select 1 from ap)`,
  };
}

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive).
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        await lockLive(tx, sql`id = ${input.authorId}::uuid`);
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /**
     * Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to
     * delete. `within` runs in the same transaction. The author's profile row is taken first, in the mode the counter
     * update below needs: a decision about the author holds that row before it takes the post, so a deletion that took
     * the post first and the profile second would deadlock with it, and one that takes the profile first waits its turn.
     */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${authorId}::uuid for no key update`);
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        return inserted.length > 0;
      });
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it (lockLive).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockLive(tx, sql`id in (${followerId}::uuid, ${followeeId}::uuid)`);
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => removeFollow(tx, followerId, followeeId));
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ explore

    /**
     * One round of the Explore refresh (2c design, section 7): a new ranking as of `asOf`, written by one statement that
     * takes every number of the formula as a parameter, in a transaction that gives up after 30 seconds of work or 5 of
     * waiting on a lock. The round writes nothing while the newest ranking is younger than the formula's minimum gap, so
     * at most one ranking lands per interval however many instances run the job or restart. The newest `kept` rankings
     * stay, so a reader paging through the one before the current one can finish; older ones go with their items.
     *
     * The statement's CTEs: `c` the candidates, `e` the engagement that counts and `ap` the approving accounts per post
     * reaching the threshold, all three the shared rules of `exploreRules`, which the author's status judges with too; `s`
     * the score, approvers over (hours since posted, never negative, + offset) ^ gravity; `r` each author's posts numbered
     * by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts within the
     * per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id; `ins` the
     * items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreRefresh> {
      const started = performance.now();
      const rules = exploreRules(asOf, formula);
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        const [recent] = (await tx.execute(sql`select exists (select 1 from explore_runs where as_of > ${rules.at} - ${minutes(formula.minGapMinutes)}) as fresh`)) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${rules.at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (${rules.candidates()}),
          e as (${rules.engagement()}),
          ap as (${rules.approvers}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${rules.at} - c.created_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
            from ap join c on c.id = ap.post_id
          ),
          r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
          k as (
            select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
            from r where r.author_rank <= ${formula.perAuthor} order by position limit ${formula.listLength}
          ),
          ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
          select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`)) as unknown as { candidates: number; items: number }[];
        // From the start of the round to the end of the ranking statement, the part that grows with the data.
        const tookMs = Math.round(performance.now() - started);
        await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items}, took_ms = ${tookMs} where generation = ${generation}`);
        // The newest `kept` rankings stay, this one among them; the cascade takes the items of the others.
        await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${formula.kept}) g)`);
        return { skipped: false, generation, candidates: counts!.candidates, items: counts!.items, tookMs };
      });
    },

    /**
     * A page of Explore (2c design, section 8), read by one statement, so a round that prunes a ranking between the checks
     * and the page cannot turn one answer into another: the current generation; the ranking read (the cursor's, or else
     * the current one) when it is kept, with its time; the position of the cursor's post in it; and after that position,
     * in order, the items whose post is visible (for every reader, its author too), whose author is live and shows in
     * Explore, and, for a signed-in reader, with no block either way between reader and author and no mute of the author.
     * The filters come before the limit, so a page is full whenever the ranking holds that many posts the reader may see.
     * The statement answers one row per post, or a lone row without one for an empty page; the flow decides what a missing
     * ranking or post means.
     */
    async explorePage(viewer: string | null, cursor: ExploreCursor | undefined, limit: number): Promise<ExplorePageRead> {
      const raw = await rows<RawExplorePage>(sql`
        with cur as (select max(generation) as generation from explore_runs),
        run as (select generation, as_of from explore_runs where generation = ${cursor ? sql`${cursor.g}::int` : sql`(select generation from cur)`}),
        pos as (${cursor ? sql`select position from explore_items where generation = ${cursor.g}::int and post_id = ${cursor.id}::uuid` : sql`select 0 as position`}),
        page as (
          select i.post_id, i.position from explore_items i join posts p on p.id = i.post_id join profiles a on a.id = p.author_id
          where i.generation = (select generation from run) and i.position > (select position from pos)
            and p.state = 'visible' and a.deleted_at is null and a.show_in_explore and ${viewer ? otherWelcome(viewer, sql`p.author_id`) : sql`true`}
          order by i.position limit ${limit}
        )
        select cur.generation as current, run.generation, ${iso("run.as_of")} as as_of, pos.position as after, page.post_id, page.position
        from cur left join run on true left join pos on true left join page on true
        order by page.position`);
      const head = raw[0]!;
      return {
        current: head.current,
        ranking: head.generation === null ? null : { generation: head.generation, asOf: new Date(head.as_of!) },
        after: head.after,
        rows: raw.filter((row) => row.post_id !== null).map((row) => ({ postId: row.post_id!, position: row.position! })),
      };
    },

    /**
     * What the author's status needs about one post before any judgement (2c design, section 8), as of `now`: the window is
     * the formula's, through the same rules the refresh ranks with. Null when there is no such post.
     */
    async exploreFacts(postId: string, now: Date, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreFacts | null> {
      const rules = exploreRules(now, formula);
      const [r] = await rows<RawExploreFacts>(sql`
        with run as (select generation, as_of from explore_runs order by generation desc limit 1)
        select p.author_id, p.reply_to_id is not null as reply, p.quote_of_id is not null as quote, p.state = 'visible' as visible,
          a.show_in_explore as shown, p.created_at <= ${rules.since} as outside_window,
          run.generation, ${iso("run.as_of")} as as_of, p.created_at > run.as_of as newer,
          exists (select 1 from explore_items i where i.generation = run.generation and i.post_id = p.id) as holds_post
        from posts p join profiles a on a.id = p.author_id left join run on true
        where p.id = ${postId}::uuid`);
      if (!r) return null;
      return {
        authorId: r.author_id,
        reply: r.reply,
        quote: r.quote,
        visible: r.visible,
        shown: r.shown,
        outsideWindow: r.outside_window,
        ranking: r.generation === null ? null : { generation: r.generation, asOf: new Date(r.as_of!), holdsPost: r.holds_post, postIsNewer: r.newer! },
      };
    },

    /**
     * The status's judgement of one post, from one statement about that post alone and never a ranking: whether it meets
     * every rule of the formula (the candidate predicate, the engagement that counts, the threshold) as of `now` and again
     * as of the ranking's time, through the very fragments the refresh ranks with, and how many places the ranking gives
     * the post's author and holds in all. Each count reads at most the ranking's items.
     */
    async exploreJudgement(
      post: { id: string; authorId: string },
      now: Date,
      ranking: { generation: number; asOf: Date },
      formula: ExploreFormula = EXPLORE_V1,
    ): Promise<ExploreJudgement> {
      const [r] = await rows<{ met_now: boolean; met_at_ranking: boolean; author_places: number; places: number }>(sql`
        select ${exploreRules(now, formula).met(post.id)} as met_now, ${exploreRules(ranking.asOf, formula).met(post.id)} as met_at_ranking,
          (select count(*) from explore_items where generation = ${ranking.generation}::int and author_id = ${post.authorId}::uuid)::int as author_places,
          (select count(*) from explore_items where generation = ${ranking.generation}::int)::int as places`);
      return { metNow: r!.met_now, metAtRanking: r!.met_at_ranking, authorPlaces: r!.author_places, places: r!.places };
    },

    /**
     * Of the viewer's own posts given, those the current Explore ranking holds while the viewer's switch is on: with the
     * visible posts only, which the caller passes, exactly those whose status would be listed, and so the posts that carry
     * the author's chip. One statement for any number of posts.
     */
    async listedInExplore(viewer: string, postIds: string[]): Promise<Set<string>> {
      if (postIds.length === 0) return new Set();
      const raw = await rows<{ post_id: string }>(sql`
        select i.post_id from explore_items i join profiles a on a.id = i.author_id
        where i.generation = (select max(generation) from explore_runs) and i.post_id = any(${uuidArray(postIds)})
          and i.author_id = ${viewer}::uuid and a.deleted_at is null and a.show_in_explore`);
      return new Set(raw.map((r) => r.post_id));
    },

    /** Turns "Show my posts in Explore" on or off. False when there is no such live profile. */
    async setShowInExplore(id: string, on: boolean): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ showInExplore: on })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * The data export's head: the live profile row, its Explore switch (the owner's, which the profile row the public
     * reads leaves out), and every handle in handle_history for it, in the order they were recorded. Null when there is
     * no live profile. The lists come page by page from the reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; showInExplore: boolean; handleHistory: string[] } | null> {
      const [r] = await rows<RawProfile & { show_in_explore: boolean }>(sql`select ${PROFILE_COLUMNS}, show_in_explore from profiles where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string }>(sql`select handle_lower from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`);
      return { profile: toProfile(r), showInExplore: r.show_in_explore, handleHistory: history.map((row) => row.handle_lower) };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null; key_at: string; key_id: string }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
    },

    /** Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile. */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid and deleted_at is null for update`)) as unknown as { handle: string }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
              or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { taken: boolean }[];
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ what moderation cases read

    /**
     * Locks these profile rows for the rest of the transaction, in one statement and in id order, so two transactions
     * that lock several accounts never take them in opposite orders. `no key update` is what a decision takes on its
     * subject: two decisions about one account then run one after the other, while the likes and follows of others,
     * which take `key share`, never wait for it. `key share` is what a report takes on its sender. It answers each row
     * found with whether its account is deleted; with `live`, a missing or deleted account is refused (not_found).
     */
    async lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live = false): Promise<{ id: string; deleted: boolean }[]> {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return [];
      // The mode is one of two literals of this file, never input.
      const found = (await tx.execute(
        sql`select id, deleted_at is not null as deleted from profiles where id = any(${uuidArray(wanted)}) order by id for ${sql.raw(mode)}`,
      )) as unknown as { id: string; deleted: boolean }[];
      if (live && (found.length !== wanted.length || found.some((row) => row.deleted))) throw new SocialError("not_found", 404);
      return found.map((row) => ({ id: row.id, deleted: row.deleted }));
    },

    /**
     * A post as a case's evidence copies it, or null when no row has the id: the row is locked `for share`, so the
     * author's deletion comes after the copy or has left its tombstone before it. A post whose content was erased is
     * answered with an empty body, so no copy holds erased text.
     */
    async capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null> {
      const [row] = (await tx.execute(sql`
        select p.id, p.author_id, a.handle as author_handle, p.body, p.state, ${iso("p.created_at")} as created_at, p.reply_to_id, p.quote_of_id,
               p.erased_at is not null as erased
        from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid for share of p`)) as unknown as RawCapturedPost[];
      if (!row) return null;
      return {
        id: row.id,
        authorId: row.author_id,
        authorHandle: row.author_handle,
        body: row.erased ? "" : row.body,
        state: row.state,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        erased: row.erased,
      };
    },

    /** An account's handle, display name and bio as a case's evidence copies them, with whether it is deleted; null when no row has the id. */
    async captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null> {
      const [row] = (await tx.execute(
        sql`select id, handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
      )) as unknown as { id: string; handle: string; display_name: string; bio: string; deleted: boolean }[];
      return row ? { id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
    },

    /**
     * The account a handle names, for a report. Without `withDeleted`, only a live profile that holds the handle now: an
     * old handle names nothing, as everywhere else. With it, for a report of child sexual abuse material, also a deleted
     * profile (the purge keeps the handle on the row) and, for a handle no profile holds now, the profile that
     * handle_history records for it: a handle an account has left stays reserved for that account, so it names that
     * account and nobody else.
     */
    async findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null> {
      const lower = handle.toLowerCase();
      const [holder] = await rows<{ id: string; deleted: boolean }>(
        sql`select id, deleted_at is not null as deleted from profiles where lower(handle) = ${lower} and (${withDeleted}::boolean or deleted_at is null)`,
      );
      if (holder || !withDeleted) return holder ? { id: holder.id, deleted: holder.deleted } : null;
      const [former] = await rows<{ id: string; deleted: boolean }>(
        sql`select p.id, p.deleted_at is not null as deleted from handle_history h join profiles p on p.id = h.profile_id where h.handle_lower = ${lower}`,
      );
      return former ? { id: former.id, deleted: former.deleted } : null;
    },

    /** Who wrote a post, or null when no row has the id. */
    async postAuthor(postId: string): Promise<string | null> {
      const [row] = await rows<{ author_id: string }>(sql`select author_id from posts where id = ${postId}::uuid`);
      return row?.author_id ?? null;
    },

    /** A post's author, its state and the post it quotes, or null when no row has the id. Nothing is locked. */
    async postRef(postId: string): Promise<{ authorId: string; state: StoredPostState; quoteOfId: string | null } | null> {
      const [row] = await rows<{ author_id: string; state: StoredPostState; quote_of_id: string | null }>(
        sql`select author_id, state, quote_of_id from posts where id = ${postId}::uuid`,
      );
      return row ? { authorId: row.author_id, state: row.state, quoteOfId: row.quote_of_id } : null;
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, as its last act, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would). After the profile row come the row locks of every post of the account, in id order,
     * before any post is written (3c design, section 7.10): a report that holds two of them holds them in that
     * order. What stays unordered are the counters of other accounts' posts that this account replied to, quoted,
     * liked or reposted, which are written after.
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        // Every post of the account is locked first, in id order, before any of them is written. A report holds the posts it
        // copies for share in that order, and one about a post that quotes or replies to its author's own post holds two
        // posts of this account. The counter statements below write such a quoted or replied-to post, in their scan's
        // order, and the tombstones write the rest: with the locks taken here, in the report's order, the purge either
        // waits at the first post the report holds, holding none itself, or holds them all before the report asks. The
        // deleted posts are locked too: a live post may quote or reply to one, and its counter is written all the same.
        await tx.execute(sql`select id from posts where author_id = ${id}::uuid order by id for update`);
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        // The tombstones. The rows are this transaction's already, and no post of the account can appear meanwhile: writing
        // one takes a shared lock on the profile row, which this transaction holds for update.
        await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.authorId, id), ne(posts.state, "deleted_by_author")));
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // The handle stays on the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the row; it may be there already, from an earlier stint.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        // The row stays with its handle; everything else about the person goes. Only a live row is written, so a repeat leaves the deletion time alone.
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
        // The media rows go last (3c design, section 7.10): they are the last rows this transaction locks, after every
        // post and profile row it takes, and the requests for their files, which cannot be rolled back, are written as
        // close to the commit as they can be.
        await within(tx);
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found"): Promise<void> {
  const found = (await tx.execute(sql`select deleted_at from profiles where ${accounts} for key share`)) as unknown as { deleted_at: string | null }[];
  if (found.some((row) => row.deleted_at !== null)) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `apps/api/src/social/views.ts` (whole file)

```ts
import type { Author, HiddenMedia, MediaView, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { PostImage } from "../media";
import type { SocialDeps, ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** Where views come from: the posts, and their images through the media module. */
export type ViewSource = Pick<SocialDeps, "repo" | "media">;

/** What a post id resolves to for a viewer: the view, or a tombstone when the viewer may not see it. */
export type LoadedPost = PostView | Tombstone;

export function isTombstone(loaded: LoadedPost): loaded is Tombstone {
  return !("author" in loaded);
}

export function authorOf(profile: ProfileRow): Author {
  return { id: profile.id, handle: profile.handle, displayName: profile.displayName, verified: profile.verified };
}

/**
 * One image of a post as this viewer gets it (3c design, section 7.10). A visible image is the image. A withheld or
 * removed one stays with its author, who gets it with that state; anyone else gets a placeholder in its place, the same
 * for both states, with nothing of the image in it. A sealed image is that placeholder for every viewer, its author
 * included, who alone is told that it is sealed.
 */
export function mediaFor(viewer: ViewerId, authorId: string, image: PostImage): MediaView | HiddenMedia {
  const own = viewer !== null && viewer === authorId;
  if (image.state === "sealed") return own ? { id: image.id, hidden: true, sealed: true } : { id: image.id, hidden: true };
  const { state, ...view } = image;
  if (state === "visible") return view;
  return own ? { ...view, moderation: state } : { id: image.id, hidden: true };
}

/**
 * Turns post ids into views for one viewer: loads the rows and, one level deep, the posts they
 * quote; decides access for every row with the visibility rule and the viewer's blocks; attaches
 * the viewer's like, repost and bookmark state, and every post's images, each as this viewer gets it
 * (mediaFor). Ids that resolve to nothing become tombstones, and tombstones carry no images. The
 * viewer's own visible posts that the current Explore ranking holds, while their switch is on, carry
 * the author's chip (2c design, section 8):
 * asked in one query, and only when the viewer wrote some of the posts; a quoted embed never carries it.
 */
export async function loadPostViews({ repo, media }: ViewSource, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].flatMap((row) => (row.replyToAuthorId ? [row.authorId, row.replyToAuthorId] : [row.authorId])))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;
  const images = await media.forPosts([...all.keys()]);
  // A withheld or removed post is never in Explore for anyone, its author included, so only visible ones are asked about.
  const own = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && row.state === "visible").map((row) => row.id) : [];
  const inExplore = viewer && own.length > 0 ? await repo.listedInExplore(viewer, own) : new Set<string>();

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  /** The parent's handle only when the viewer could open the parent; a block either way, or a hidden or deleted parent, gives null. */
  const parentHandle = (row: PostRow): string | null =>
    row.replyToAuthorId && row.replyToState && postAccess(viewer, { authorId: row.replyToAuthorId, state: row.replyToState }, blocked.has(row.replyToAuthorId)) === "shown"
      ? row.replyToHandle
      : null;
  const base = (row: PostRow) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: parentHandle(row) } : null,
    counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount },
    media: (images.get(row.id) ?? []).map((image) => mediaFor(viewer, row.authorId, image)),
    ...(states ? { viewer: states.get(row.id)! } : {}),
  });
  const quoteOf = (id: string | null): PostView["quoteOf"] => {
    if (id === null) return null;
    const row = all.get(id);
    if (!row) return tombstone(id, "hidden");
    const a = access(row);
    return a === "shown" ? { ...base(row), quoteOf: null } : tombstone(id, a);
  };

  const out = new Map<string, LoadedPost>();
  for (const id of unique) {
    const row = primary.get(id);
    if (!row) {
      out.set(id, tombstone(id, "hidden"));
      continue;
    }
    const a = access(row);
    out.set(id, a === "shown" ? { ...base(row), ...(inExplore.has(id) ? { inExplore: true as const } : {}), quoteOf: quoteOf(row.quoteOfId) } : tombstone(id, a));
  }
  return out;
}

/** One post as the viewer sees it, or null when they may not. */
export async function postView(source: ViewSource, viewer: ViewerId, id: string): Promise<PostView | null> {
  const loaded = (await loadPostViews(source, viewer, [id])).get(id)!;
  return isTombstone(loaded) ? null : loaded;
}

/** Views for list rows, in list order, dropping anything the viewer may not see. */
export async function postViews(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<PostView[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  return rows.map((row) => loaded.get(row.postId)!).filter((view): view is PostView => !isTombstone(view));
}

/** Timeline items for list rows, with the reposter attached to repost rows. */
export async function timelineItems(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<TimelineItem[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  const reposters = await source.repo.findProfiles([...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))]);
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const view = loaded.get(row.postId)!;
    if (isTombstone(view)) continue;
    const reposter = row.reposterId ? reposters.get(row.reposterId) : undefined;
    if (row.reposterId && !reposter) continue;
    items.push(reposter ? { kind: "repost", post: view, repostedBy: authorOf(reposter), repostedAt: row.sortAt.toISOString() } : { kind: "post", post: view });
  }
  return items;
}

/** The cursor for the page after these rows, or null when the page was not full. */
export function pageCursor(rows: { sortAt: Date; postId?: string; profileId?: string; reposterId?: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ t: last.sortAt.getTime(), id: (last.postId ?? last.profileId)!, ...(last.reposterId ? { r: last.reposterId } : {}) });
}
```

### Replace `apps/app/src/components/PopularNow.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { isHiddenMedia, type MediaView, type PostView } from "@korbat/contracts";
import { social } from "@/lib/social";

/**
 * What a link says for a post: its text up to 100 characters, or, for a post of images only, the description of the
 * first image this reader is shown. An image moderation hid has no description and is skipped; a post of hidden images
 * alone is listed by its author's name only.
 */
function snippet(post: PostView): string {
  const text = post.body.replace(/\s+/g, " ").trim();
  if (!text) {
    const shown = post.media.find((item): item is MediaView => !isHiddenMedia(item));
    return shown ? `Image: ${shown.alt}` : "";
  }
  const characters = Array.from(text);
  return characters.length > 100 ? `${characters.slice(0, 100).join("")}...` : text;
}

/** Popular now's posts, each a link to its thread, then a link to the rest of Explore. */
export function PopularPosts({ posts }: { posts: PostView[] }) {
  return (
    <View className="mb-8">
      <Text accessibilityRole="header" aria-level={2} className="text-sm font-medium text-zinc-300">
        Popular now
      </Text>
      {posts.map((post) => (
        <Link key={post.id} href={`/post/${post.id}`} asChild>
          <Pressable className="mt-3">
            <Text className="text-sm font-semibold text-zinc-50" numberOfLines={1}>
              {post.author.displayName}
            </Text>
            <Text className="mt-0.5 text-sm leading-5 text-zinc-300" numberOfLines={2}>
              {snippet(post)}
            </Text>
          </Pressable>
        </Link>
      ))}
      <Link href="/?tab=explore" asChild>
        <Pressable className="mt-3">
          <Text className="text-sm text-zinc-400 underline">More in Explore</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * The context column's Popular now (2c design, section 11): the first three posts of Explore, above the handle box. It
 * asks on every mount and keeps the answer in its own state only, and shows nothing while Explore is empty or cannot be
 * reached: the column is extra, and the Explore tab says why a list is empty.
 */
export function PopularNow() {
  const [posts, setPosts] = useState<PostView[]>([]);
  useEffect(() => {
    let cancelled = false;
    social
      .popular()
      .then((page) => {
        if (!cancelled) setPosts(page.items.slice(0, 3).map((item) => item.post));
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return posts.length > 0 ? <PopularPosts posts={posts} /> : null;
}
```

### Replace `apps/app/src/components/social/MediaGrid.tsx` (whole file)

```tsx
import { useState } from "react";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { HiddenImage, HiddenRowWords, HiddenThumbnail, hiddenImageWords } from "./HiddenImage";
import { MediaViewer } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * The small size of an image with its blurhash; expo-image loads it lazily on the web. The blurhash
 * fades into the image unless the system asks for reduced motion, which swaps it at once.
 */
function Picture({ item, style }: { item: MediaView; style: { width: number | "100%"; height: number | "100%"; borderRadius?: number } }) {
  const still = useReducedMotion();
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} contentFit="cover" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={style} />
  );
}

function Cell({ item, onPress }: { item: MediaView; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open image: ${item.alt}`} onPress={onPress} style={{ flex: 1 }}>
      <Picture item={item} style={{ width: "100%", height: "100%" }} />
    </Pressable>
  );
}

/**
 * The images of a post. One image is shown in its own ratio; two to four share a 16:9 frame and are
 * cropped to their cell. Pressing one opens the viewer; ALT shows the descriptions in place. An image
 * moderation hid from this reader keeps its place as a placeholder: it has no size of its own, so alone
 * it takes the frame's ratio, it is no control, and it has no description to show.
 */
function Grid({ media }: { media: (MediaView | HiddenMedia)[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  const cell = (index: number) => {
    const item = media[index]!;
    return isHiddenMedia(item) ? <HiddenImage key={item.id} item={item} /> : <Cell key={item.id} item={item} onPress={() => setOpen(index)} />;
  };
  const first = media[0]!;
  // Descriptions exist only for the images this reader is shown.
  const anyShown = media.some((item) => !isHiddenMedia(item));

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: isHiddenMedia(first) ? FRAME_RATIO : clampRatio(first.width, first.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-xl border border-zinc-800">{frame}</View>
      {anyShown ? (
        <Pressable accessibilityRole="button" aria-expanded={described} accessibilityLabel={described ? "Hide image descriptions" : "Show image descriptions"} onPress={() => setDescribed(!described)} className="mt-1 self-start rounded border border-zinc-700 px-1.5 py-0.5">
          <Text className="text-xs font-semibold text-zinc-300">ALT</Text>
        </Pressable>
      ) : null}
      {described
        ? media.map((item, index) => (
            <Text key={item.id} className="mt-1 text-sm leading-5 text-zinc-300">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {/* A hidden image keeps its number, so the others' numbers match their places in the frame. */}
              {isHiddenMedia(item) ? hiddenImageWords(item) : item.alt}
            </Text>
          ))
        : null}
      {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 * A hidden image keeps its square in the row, and the row says the placeholder's sentence once, as
 * text, under the squares.
 */
export function MediaGrid({ media, compact = false }: { media: (MediaView | HiddenMedia)[]; compact?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} />;
  return (
    <View className="mt-2">
      <View className="flex-row" style={{ gap: GAP }}>
        {media.map((item) => (isHiddenMedia(item) ? <HiddenThumbnail key={item.id} size={THUMBNAIL} /> : <Picture key={item.id} item={item} style={{ width: THUMBNAIL, height: THUMBNAIL, borderRadius: 6 }} />))}
      </View>
      <HiddenRowWords media={media} />
    </View>
  );
}
```

### Replace `apps/app/src/components/social/MediaViewer.tsx` (whole file)

```tsx
import { useEffect } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { HiddenImage } from "./HiddenImage";

interface MediaViewerProps {
  media: (MediaView | HiddenMedia)[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/**
 * What the viewer shows: one image in its large size, fitted inside the screen, with its description
 * underneath, its place among the post's images and the controls. The viewer is opened from an image's
 * own cell only; stepping through the post's images can still come to one moderation hid from this
 * reader, which is never loaded: its placeholder stands in the image's place.
 */
export function MediaViewerContent({ media, index, onIndex, onClose }: MediaViewerProps) {
  const still = useReducedMotion();
  const item = media[index]!;
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  return (
    <View className="flex-1 bg-black/95">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-sm text-zinc-300">{many ? `${index + 1} of ${media.length}` : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close the image viewer" onPress={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5">
          <Text className="text-sm text-zinc-200">Close</Text>
        </Pressable>
      </View>
      <View className="flex-1 px-2">
        {isHiddenMedia(item) ? (
          <HiddenImage item={item} />
        ) : (
          <Image source={{ uri: `${API_BASE}${item.large}` }} placeholder={{ blurhash: item.blurhash }} contentFit="contain" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={{ flex: 1 }} />
        )}
      </View>
      {isHiddenMedia(item) ? null : <Text className="px-4 py-3 text-center text-sm leading-5 text-zinc-200">{item.alt}</Text>}
      {many ? (
        <View className="flex-row justify-center gap-3 pb-4">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => step(-1)} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Previous</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => step(1)} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Next</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One image on the whole screen. Arrow keys move between the images of the post; react-native-web's
 * Modal closes it on Escape and returns focus to the image that opened it. It appears at once: nothing
 * about it needs motion, and the image fades in from its blurhash only when reduced motion is not asked for.
 */
export function MediaViewer({ media, index, onIndex, onClose }: MediaViewerProps) {
  const many = media.length > 1;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <MediaViewerContent media={media} index={index} onIndex={onIndex} onClose={onClose} />
    </Modal>
  );
}
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

/**
 * An image on a post, as a reader who is shown it gets it. `moderation` is set only on the author's own image that
 * moderation withheld or removed, with that state: the author keeps seeing such an image, and nobody else is shown it.
 */
export const MediaView = z.object({
  id: MediaId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().min(6),
  alt: z.string(),
  small: z.string(),
  large: z.string(),
  moderation: z.enum(["withheld", "removed"]).optional(),
});
export type MediaView = z.infer<typeof MediaView>;

/**
 * What a reader gets in place of an image they are not shown: its id and the mark, never its size, its blurhash, its
 * description or a path. It is what anyone but the author gets for a withheld or removed image, the same for both states,
 * and what everyone gets for a sealed image, its author included: `sealed` is set only then, and only for the author.
 */
export const HiddenMedia = z.strictObject({ id: MediaId, hidden: z.literal(true), sealed: z.literal(true).optional() });
export type HiddenMedia = z.infer<typeof HiddenMedia>;

/** Whether an entry of a post's media list is a hidden image, which has nothing to draw or to open. */
export function isHiddenMedia(item: MediaView | HiddenMedia): item is HiddenMedia {
  return "hidden" in item;
}
```

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, HandleInput } from "./auth";
import { HiddenMedia, MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";
import { FORBIDDEN_FORMAT, visibleLength } from "./text";

/**
 * Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited).
 * explore_refreshed (409) refuses a page of an Explore ranking that is no longer kept.
 */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

/** Postgres returns lowercase ids; the canonical form, so a lookup by any spelling finds the row. */
export const PostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. */
const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;

/** A post body as stored: normalized, 1 to 1000 code points, some of them visible, no control or disguising characters. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => visibleLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => visibleLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

export const PostCounts = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
});
export type PostCounts = z.infer<typeof PostCounts>;

export const ViewerPostState = z.object({ liked: z.boolean(), reposted: z.boolean(), bookmarked: z.boolean() });
export type ViewerPostState = z.infer<typeof ViewerPostState>;

const postFields = {
  id: z.uuid(),
  author: Author,
  body: z.string(),
  createdAt: z.iso.datetime(),
  state: PostState,
  /** The handle is null when the viewer could not open the parent: its author is blocked either way, or it is hidden or deleted. */
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string().nullable() }).nullable(),
  counts: PostCounts,
  /** The post's images in order, each as the image or, where the reader is not shown it, as a hidden image in its place. Always present, often empty. */
  media: z.array(z.union([MediaView, HiddenMedia])),
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/** A quoted post as embedded: one level deep, so its own quote is not expanded. */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null() });
export type QuotedPost = z.infer<typeof QuotedPost>;

export const PostView = z.object({
  ...postFields,
  /**
   * The author's "In Explore" chip (2c design, section 8): present, and true, only on the viewer's own post while it is in
   * the current Explore ranking with their switch on. Nobody else's view carries it, nor does a quoted embed. It sits here
   * rather than in `viewer`, which the like, repost and bookmark answers replace.
   */
  inExplore: z.literal(true).optional(),
  quoteOf: z.union([QuotedPost, Tombstone]).nullable(),
});
export type PostView = z.infer<typeof PostView>;

/** An item of a timeline or a profile's Posts tab. */
export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), post: PostView }),
  z.object({ kind: z.literal("repost"), post: PostView, repostedBy: Author, repostedAt: z.iso.datetime() }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const TimelinePage = page(TimelineItem);
export type TimelinePage = z.infer<typeof TimelinePage>;
export const PostPage = page(PostView);
export type PostPage = z.infer<typeof PostPage>;

export const ThreadResponse = z.object({
  ancestors: z.array(z.union([PostView, Tombstone])),
  post: PostView,
  replies: PostPage,
});
export type ThreadResponse = z.infer<typeof ThreadResponse>;

// ---------------------------------------------------------------- engagement and graph

export const EngagementResponse = z.object({ counts: PostCounts, viewer: ViewerPostState });
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const FollowResponse = z.object({ following: z.boolean(), followerCount: z.number().int().min(0) });
export type FollowResponse = z.infer<typeof FollowResponse>;

export const BlockResponse = z.object({ blocked: z.boolean() });
export type BlockResponse = z.infer<typeof BlockResponse>;

export const MuteResponse = z.object({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponse>;

// ---------------------------------------------------------------- profiles

export const ProfileCounts = z.object({
  posts: z.number().int().min(0),
  followers: z.number().int().min(0),
  following: z.number().int().min(0),
});

export const ViewerProfileState = z.object({ following: z.boolean(), followedBy: z.boolean(), blocked: z.boolean(), muted: z.boolean() });
export type ViewerProfileState = z.infer<typeof ViewerProfileState>;

export const ProfileView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
  counts: ProfileCounts,
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;

// ---------------------------------------------------------------- profile editing

export const BIO_MAX_LENGTH = 160;

/** A bio as stored: trimmed, at most 160 code points, one line of plain text with no control or disguising characters. Empty clears it. */
export const Bio = z
  .string()
  .trim()
  // The line and paragraph separators (Zl, Zp) break a line as a newline does, without being control characters.
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "control characters and line breaks are not allowed")
  .refine((bio) => !FORBIDDEN_FORMAT.test(bio), { message: "invisible direction and spacing characters are not allowed" })
  .refine((bio) => postLength(bio) <= BIO_MAX_LENGTH, { message: `bios have at most ${BIO_MAX_LENGTH} characters` });

/** What the profile screen saves: either field, or both. The handle has its own route and rules. */
export const ProfileEditRequest = z
  .object({ displayName: DisplayName.optional(), bio: Bio.optional() })
  .refine((edit) => edit.displayName !== undefined || edit.bio !== undefined, { message: "nothing to change" });
export type ProfileEditRequest = z.infer<typeof ProfileEditRequest>;

/** The handle rules and the 30-day cooldown are enforced by the flow, which answers with a specific error code. */
export const HandleChangeRequest = z.object({ handle: HandleInput });
export type HandleChangeRequest = z.infer<typeof HandleChangeRequest>;
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
packages/rules test:       Tests  18 passed (18)
packages/db test:       Tests  60 passed (60)
packages/contracts test:       Tests  208 passed (208)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  120 passed (120)
apps/admin test:       Tests  228 passed (228)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  596 passed | 786 skipped (1382)
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
- `count=17`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=17
```

## Step 8: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 9: verify: integration-fresh

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
Tests  782 passed (782)
```

## Step 10: verify: test-database-upgrade

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

## Step 11: verify: integration-upgraded

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
Tests  782 passed (782)
```

## Step 12: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 13: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
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

## Step 14: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 15: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/flows/export.ts`
- `apps/api/src/index.ts`
- `apps/api/src/media/cases.ts`
- `apps/api/src/media/context.ts`
- `apps/api/src/media/flows/serve.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/media/webp.ts`
- `apps/api/src/moderation/context.ts`
- `apps/api/src/moderation/index.ts`
- `apps/api/src/moderation/intake.ts`
- `apps/api/src/social/flows/export.ts`
- `apps/api/src/social/flows/posts.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/integration/http-media.test.ts`
- `apps/api/test/integration/http-staff-decisions.test.ts`
- `apps/api/test/integration/http-staff-enroll.test.ts`
- `apps/api/test/integration/http-staff-sessions.test.ts`
- `apps/api/test/integration/media-cases.test.ts`
- `apps/api/test/integration/media-gates.test.ts`
- `apps/api/test/integration/media-sealed.test.ts`
- `apps/api/test/integration/moderation-decide.ts`
- `apps/api/test/integration/moderation-fixtures.ts`
- `apps/api/test/integration/moderation-seal.test.ts`
- `apps/api/test/lab/README.md`
- `apps/api/test/lab/contention.lab.ts`
- `apps/api/test/lab/hold.lab.ts`
- `apps/api/test/media/webp-bytes.ts`
- `apps/api/test/media/webp.test.ts`
- `apps/api/test/moderation-intake-order.test.ts`
- `apps/api/test/staff/app-mount.test.ts`
- `apps/api/test/staff/route-table.test.ts`
- `apps/app/src/components/PopularNow.tsx`
- `apps/app/src/components/social/HiddenImage.tsx`
- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/MediaViewer.tsx`
- `apps/app/test/hidden-media.test.tsx`
- `packages/contracts/src/media.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/test/media.test.ts`

## Step 16: commit

```bash
git add -A
git commit -q -m "feat(api,app,contracts): holds and images: MediaForCases.hold locks every image row an intake reaches in one id order (FOR KEY SHARE; a post's rows also get its case's hold, an account's are only locked, since the freeze keeps them) and the intake's snapshots list what it returned; reach counts a case's posts, images, sealed and served ones; staffImage is the one function that opens an image for staff and refuses a frozen post's, a sealed and an erased one; dropDisposable deletes at most a batch of the images nothing retains, its candidates chosen by their marks before the freeze is read; detachAll and purgeOwner delete in id order with no filter and the keep trigger decides; purgeProfile takes its posts' row locks first, in id order, and deletes images as its last act; serve, forPosts, readyImages and the export's open follow an image's own state: a withheld or removed image goes to its author only, a sealed one to nobody, and others get the placeholder HiddenMedia; the app draws it ("Image hidden by korbat moderation", or "Sealed: not shown to anyone, you included" for the author) in the grid, the viewer and a quote's row, never loads a hidden image, and Popular now skips it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,app,contracts): holds and images: MediaForCases.hold locks every image row an intake reaches in one id order (FOR KEY SHARE; a post's rows also get its case's hold, an account's are only locked, since the freeze keeps them) and the intake's snapshots list what it returned; reach counts a case's posts, images, sealed and served ones; staffImage is the one function that opens an image for staff and refuses a frozen post's, a sealed and an erased one; dropDisposable deletes at most a batch of the images nothing retains, its candidates chosen by their marks before the freeze is read; detachAll and purgeOwner delete in id order with no filter and the keep trigger decides; purgeProfile takes its posts' row locks first, in id order, and deletes images as its last act; serve, forPosts, readyImages and the export's open follow an image's own state: a withheld or removed image goes to its author only, a sealed one to nobody, and others get the placeholder HiddenMedia; the app draws it ("Image hidden by korbat moderation", or "Sealed: not shown to anyone, you included" for the author) in the grid, the viewer and a quote's row, never loads a hidden image, and Popular now skips it`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 43>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
