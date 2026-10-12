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
