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
import { deciderWorld, type DeciderWorld } from "../integration/moderation-decide";
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
  removeDecided,
  removeFixtures,
  report,
  staffProfile,
  type DecisionInput,
  type TestStaff,
} from "../integration/moderation-fixtures";
import { ageCase } from "../integration/retention-fixtures";
import { newProfile } from "../integration/social-fixtures";
import { rolledBack } from "../integration/staff-fixtures";
import { ageOrderForTest, effectForTest, effectParams, effectWith, orderForTest, removeOrderAlerts } from "../integration/orders-fixtures";

/**
 * The contention lab of moderation decisions (3c design, sections 2 and 12): what a decision's transaction costs and what
 * it meets, measured against the real database with migration 0016. The lab issues the statements itself, as SQL: a
 * decision is its profile lock, its row and its ledger rows, whose triggers do the rest; a like, a follow, a deletion and
 * a purge are the statements the social and media repositories issue. Every measured transaction is rolled back, so the
 * lab leaves no decision. Its one audit row is the R4 removal that the redaction's rounds need committed, which is a real,
 * confirmed decision. The accounts and posts it commits for the two-session rounds and the large accounts are removed at
 * the end. It writes one line of JSON for each measurement, with how busy the machine's
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
  /** The one thing the lab confirms with a real key: the R4 removal that the redaction's rounds make final again and again. */
  let world: DeciderWorld | null = null;

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
    await world?.close();
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

  test("the R4 redaction against a decision that derives the post's level, a report that holds the post's images and a notice that locks them through the account: forty rounds each, both orders", async () => {
    // Migration 0018's redaction takes its decision's case, then the post, then the post's images in id order, as
    // moderation_apply and an intake do. A committed R4 removal, final for its author seven months ago, is redacted in a
    // transaction that is rolled back, so every round finds it due again.
    world = deciderWorld(apiDb);
    const staff = await world.staff("moderator");
    const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
    committed.push(author.id, reporter.id);
    const postId = await newPostRow(apiDb, author.id);
    for (const position of [0, 1, 2, 3]) await newImageRow(apiDb, author.id, postId, position);
    const r4Case = (await intake(apiDb, ground.rule(reporter.id), aPost(postId))).items[0]!.caseId!;
    const removal = await world.decideAs(staff, r4Case, { kind: "final", ruleId: "R4", actions: [act("remove")] });
    if (typeof removal === "string") throw new Error(`the lab's R4 removal was not recorded: ${removal}`);
    await ageCase(migrateDb, r4Case, "7 months");
    // A second, open case of the same post, on which the other side decides: its measure derives the post's level.
    const openCase = (await report(apiDb, aPost(postId))).caseId;
    const withhold = await decisionParams(apiDb, staff, openCase, { kind: "interim", actions: [act("withhold")] });
    const pause = (tx: DbTx) => tx.execute(sql`select pg_sleep(0.015)`);

    const redaction = async (tx: DbTx) => {
      const [row] = (await tx.execute(sql`select public.redact_r4_body(${removal.decisionId}::uuid) as done`)) as unknown as { done: boolean }[];
      if (!row!.done) throw new Error("the redaction changed nothing");
    };
    const others: Record<string, (tx: DbTx) => Promise<unknown>> = {
      "interim withhold on the post's other case (moderation_apply)": (tx) => decisionWith(tx, staff, author.id, openCase, withhold),
      "report under a rule, which holds the post's images": async (tx) => {
        await intake(tx, ground.rule((await newProfile(tx as unknown as Db)).id), aPost(postId));
      },
      "notice naming the post and its author's account, which locks the images through both": async (tx) => {
        await intake(tx, ground.csam(), [aPost(postId, 1), anAccount(author.id, author.handle, 2)]);
      },
    };

    const ROUNDS = 40;
    const load = await busy();
    const single = await timed(() => rolledBack(apiDb, redaction));
    line("redaction alone", { images: 4, busyPercent: load, ms: single });
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
        const [a, b] = await Promise.all(round % 2 === 0 ? [side(redaction, 0)(), side(other, ahead)()] : [side(redaction, ahead)(), side(other, 0)()]);
        for (const [who, outcome] of [["redaction", a], ["other", b]] as const) counts[`${who}: ${outcome}`] = (counts[`${who}: ${outcome}`] ?? 0) + 1;
      }
      line("redaction contention", { redaction: "redact_r4_body of a post removal", against: otherName, rounds: ROUNDS, busyPercent: load, outcomes: counts, longestMs: Math.round(longest) });
    }
  });

  test("3f, Task 4: the end of an order's preservation against the ten-item effect of the same order on the same author's posts: forty rounds, both orders", async () => {
    // Migration 0029's order_preservation_end takes the case of the item's decision (and those of the post's other
    // copies), then the item, then the post, then its image rows (design, section 5, the lock order, item 3); the effect
    // transaction takes the authors' profiles, the cases through its intake's items, the items' rows and then, post by
    // post, the snapshot, the decision and the measure. One order of eleven posts by one author: its first item was given
    // effect with a real key and aged past its six months, so every round finds its preservation due again; the other
    // ten are given effect in one transaction with a made-up confirmation of their params. Both sides roll back.
    const started = new Date();
    world ??= deciderWorld(apiDb);
    const staff = await world.staff("moderator");
    const author = await newProfile(apiDb);
    committed.push(author.id);
    const posts: string[] = [];
    for (let n = 0; n < 11; n++) {
      const postId = await newPostRow(apiDb, author.id);
      await newImageRow(apiDb, author.id, postId, 0);
      posts.push(postId);
    }
    const order = await orderForTest(apiDb, staff, { posts });
    const first = order.items[0]!;
    const done = await effectForTest(world, staff, order.id, effectParams(order, { itemIds: [first.id] }));
    if (typeof done === "string") throw new Error(`the lab's first effect was not recorded: ${done}`);
    await ageOrderForTest(migrateDb, order.id, 200 * 24 * 60);
    const ten = done.items.filter((item) => item.id !== first.id).map((item) => item.id);
    const params = effectParams(done, { itemIds: ten });
    const pause = (tx: DbTx) => tx.execute(sql`select pg_sleep(0.015)`);
    const ending = async (tx: DbTx) => {
      const [row] = (await tx.execute(sql`select public.order_preservation_end(${first.id}::uuid) as done`)) as unknown as { done: boolean }[];
      if (!row!.done) throw new Error("the preservation's end changed nothing");
    };
    const effect = async (tx: DbTx) => {
      await effectWith(tx, staff, order.id, params);
    };

    try {
      const ROUNDS = 40;
      const load = await busy();
      line("preservation end alone", { images: 1, busyPercent: load, ms: await timed(() => rolledBack(apiDb, ending)) });
      line("ten-item effect alone", { items: ten.length, busyPercent: load, ms: await timed(() => rolledBack(apiDb, effect)) });
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
              return fromDatabase ? `${fromDatabase.code} ${fromDatabase.message}` : ((err as { code?: string }).code ?? String(err));
            },
          );
          longest = Math.max(longest, performance.now() - start);
          return outcome;
        };
        const ahead = Math.floor(Math.random() * 8);
        const [a, b] = await Promise.all(round % 2 === 0 ? [side(ending, 0)(), side(effect, ahead)()] : [side(ending, ahead)(), side(effect, 0)()]);
        for (const [who, outcome] of [["preservation end", a], ["effect", b]] as const) counts[`${who}: ${outcome}`] = (counts[`${who}: ${outcome}`] ?? 0) + 1;
      }
      line("preservation end contention", { end: "order_preservation_end of one item", against: "the ten-item effect of the same order", rounds: ROUNDS, busyPercent: load, outcomes: counts, longestMs: Math.round(longest) });
    } finally {
      await removeDecided(migrateDb, posts, []);
      await removeOrderAlerts(migrateDb, started);
    }
  });

  test("3f, Task 3: the ten-item effect of one order against an intake on its posts, a seal on one of its authors and the purge of the other: forty rounds each, both orders", async () => {
    // Section 13 asked for this part in Task 3, and 3f's review carried it to Task 8 (ruling 14). The effect transaction
    // (design, section 5, the lock order, items 1 and 2) takes its authors' profiles in id order, the cases through its
    // intake's items, the items' rows and then, post by post, the snapshot, the decision and the measure, whose triggers
    // take the post and its images. Against it: a report and a notice on its posts, which take the cases and the posts'
    // images; an interim seal of one author's images on the path for child sexual abuse material, which takes that
    // author's profile and every image of the account; and the purge of the other author's account, as the repositories
    // issue it. One order of ten posts, five by each author, given effect in one transaction with a made-up confirmation
    // of its params; every side rolls back, so every round finds the order as it was.
    const started = new Date();
    world ??= deciderWorld(apiDb);
    const staff = await world.staff("moderator");
    const [sealed, purged] = [await newProfile(apiDb), await newProfile(apiDb)];
    committed.push(sealed.id, purged.id);
    const posts: string[] = [];
    for (const author of [sealed, purged]) {
      for (let n = 0; n < 5; n++) {
        const postId = await newPostRow(apiDb, author.id);
        await newImageRow(apiDb, author.id, postId, 0);
        posts.push(postId);
      }
    }
    const order = await orderForTest(apiDb, staff, { posts });
    const params = effectParams(order);
    // The seal's case and params, committed once as the decisions' rounds above do: a notice about the first author's
    // account on the path for child sexual abuse material, sealed again in every round and rolled back. The moderator's
    // profile is committed once in the file, whichever test makes it first.
    const [hasProfile] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from profiles where id = ${mod.id}::uuid`);
    if (hasProfile!.n === 0) {
      await staffProfile(apiDb, mod);
      committed.push(mod.id);
    }
    const accountCase = (await report(apiDb, anAccount(sealed.id, sealed.handle), "csam")).caseId;
    const seal = await decisionParams(apiDb, mod, accountCase, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
    const pause = (tx: DbTx) => tx.execute(sql`select pg_sleep(0.015)`);
    const effect = async (tx: DbTx) => {
      await effectWith(tx, staff, order.id, params);
    };
    const others: Record<string, (tx: DbTx) => Promise<unknown>> = {
      "report under a rule on one of its posts": async (tx) => {
        await intake(tx, ground.rule((await newProfile(tx as unknown as Db)).id), aPost(posts[2]!));
      },
      "notice naming two of its posts, one of each author, and the first author's account": async (tx) => {
        await intake(tx, ground.csam(), [aPost(posts[1]!, 1), aPost(posts[7]!, 2), anAccount(sealed.id, sealed.handle, 3)]);
      },
      "interim seal of the first author's images": (tx) => decisionWith(tx, mod, sealed.id, accountCase, seal),
      // As the repositories issue it: the profile, every post of the account in id order, the tombstones, the image rows.
      "purge of the second author's account": async (tx) => {
        await tx.execute(sql`select handle from profiles where id = ${purged.id}::uuid for update`);
        await tx.execute(sql`select id from posts where author_id = ${purged.id}::uuid order by id for update`);
        await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now(), body = '' where author_id = ${purged.id}::uuid and state <> 'deleted_by_author'`);
        await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', deleted_at = now() where id = ${purged.id}::uuid and deleted_at is null`);
        await tx.execute(sql`delete from post_media where id in (select id from post_media where owner_id = ${purged.id}::uuid order by id for update) returning id`);
      },
    };

    try {
      const ROUNDS = 40;
      const load = await busy();
      line("ten-item effect alone (Task 3)", { items: params.items.length, authors: 2, busyPercent: load, ms: await timed(() => rolledBack(apiDb, effect)) });
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
                return fromDatabase ? `${fromDatabase.code} ${fromDatabase.message}` : ((err as { code?: string }).code ?? String(err));
              },
            );
            longest = Math.max(longest, performance.now() - start);
            return outcome;
          };
          // Each side starts first in half the rounds, a few milliseconds ahead.
          const ahead = Math.floor(Math.random() * 8);
          const [a, b] = await Promise.all(round % 2 === 0 ? [side(effect, 0)(), side(other, ahead)()] : [side(effect, ahead)(), side(other, 0)()]);
          for (const [who, outcome] of [["effect", a], ["other", b]] as const) counts[`${who}: ${outcome}`] = (counts[`${who}: ${outcome}`] ?? 0) + 1;
        }
        line("effect contention", { effect: "the ten-item effect of one order, two authors", against: otherName, rounds: ROUNDS, busyPercent: load, outcomes: counts, longestMs: Math.round(longest) });
      }
    } finally {
      await removeDecided(migrateDb, posts, []);
      await removeOrderAlerts(migrateDb, started);
    }
  });
});
