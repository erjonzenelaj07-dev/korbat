import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  aPost,
  act,
  actionsOf,
  csamNotice,
  decideIn,
  decisionRow,
  imagePost,
  imageStates,
  insertItem,
  newImageRow,
  newPostRow,
  newTestStaff,
  openCase,
  postRow,
  readCase,
  refusal,
  report,
  rowCounts,
  ruleReport,
  staffProfile,
  uuids,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// The generated sequences run some two and a half thousand ledger steps in the database, each with a derivation, and the named
// cases dozens of statements inside one open transaction: on a loaded machine that takes far longer than the five seconds
// a test gets by default.
vi.setConfig({ testTimeout: 120_000 });

// ---------------------------------------------------------------- the reference implementation

/**
 * One thing that arrives at the ledger of one post. The post has two images and is reached by three cases: case 1 is an
 * earlier case about it that is closed, case 2 the open case about it, case 3 the open case about its author's account.
 * Cases 2 and 3 each hold a suspect item from the start, case 2 an ordinary one too.
 */
type Arrival =
  | { op: "measure"; c: 1 | 2; d: "interim" | "final"; k: "withhold" | "remove" | "withhold_media" | "remove_media"; img?: 0 | 1; key: string }
  | { op: "seal"; c: 2 | 3; d: "interim" | "final"; key: string }
  /** A reversal of the measure or seal with this key. */
  | { op: "lift"; key: string }
  /** The case's unanswered items are answered and it closes. */
  | { op: "close"; c: 2 | 3 }
  /** The case's suspect items are answered; another item may keep it open. */
  | { op: "answer"; c: 2 | 3 }
  /** A new suspect item joins the case, unless it is closed. */
  | { op: "suspect"; c: 2 | 3 }
  | { op: "erase" }
  | { op: "erase_image"; img: 0 | 1 }
  /** The author deletes the post. */
  | { op: "delete" };

interface Derived {
  level: string;
  state: string;
  images: string[];
  /**
   * Explore's three columns, which the same statement as the level writes (3e design, section 6.4): whether hidden_at
   * and restored_at are set, and explore_from's distance from created_at in microseconds, null while it is unset. Every
   * arrival of a sequence runs in the test's one transaction, whose now() never moves, so every span here is 0; the
   * spans themselves are standing-explore.test.ts's, over decisions that each commit.
   */
  hidden: boolean;
  restored: boolean;
  exploreShift: number | null;
}

/** A step's fields in one fixed order, so a step read from the database and one from the reference compare as text. */
const canonical = (step: Derived): string => JSON.stringify([step.level, step.state, step.images, step.hidden, step.restored, step.exploreShift]);

/**
 * What the post's level, its state and its two images' states must be after each arrival, computed here from the rules
 * alone (3c design, section 6.2): a measure is in force when no reversal names it and, if it was taken while deciding,
 * while its case is open, or for a seal while its case holds an unanswered suspect item that arrived no later than the
 * seal's decision. The level is the strongest post measure in force, removed also once the content was erased; the state
 * mirrors it unless the author deleted the post; an image is sealed while a seal in force lists its post, else removed,
 * withheld or visible by its own measures, removed also once it was erased. Time is the arrival's place in the sequence;
 * what the cases held from the start is at time 0.
 */
function reference(sequence: readonly Arrival[]): Derived[] {
  const cases: Record<number, { closed: boolean; items: { at: number; suspect: boolean; answered: boolean }[] }> = {
    1: { closed: true, items: [] },
    2: { closed: false, items: [{ at: 0, suspect: true, answered: false }, { at: 0, suspect: false, answered: false }] },
    3: { closed: false, items: [{ at: 0, suspect: true, answered: false }] },
  };
  const ledger: { key: string; c: number; d: string; k: string; img: number | null; at: number; lifted: boolean }[] = [];
  let erased = false;
  let deleted = false;
  const erasedImages = [false, false];
  // Explore's columns: set when the level leaves visible (hidden_at) and when it comes back to it (restored_at and
  // explore_from, which grows by the span just ended: 0 inside one transaction); a move between withheld and removed sets none.
  let previous = "visible";
  let hidden = false;
  let restored = false;
  let exploreShift: number | null = null;
  const inForce = (m: (typeof ledger)[number]) =>
    !m.lifted && (m.d !== "interim" || (m.k === "seal_media" ? cases[m.c]!.items.some((item) => item.suspect && !item.answered && item.at <= m.at) : !cases[m.c]!.closed));
  const out: Derived[] = [];
  sequence.forEach((arrival, index) => {
    const at = index + 1;
    if (arrival.op === "measure") ledger.push({ key: arrival.key, c: arrival.c, d: arrival.d, k: arrival.k, img: arrival.img ?? null, at, lifted: false });
    else if (arrival.op === "seal") ledger.push({ key: arrival.key, c: arrival.c, d: arrival.d, k: "seal_media", img: null, at, lifted: false });
    else if (arrival.op === "lift") ledger.find((m) => m.key === arrival.key)!.lifted = true;
    else if (arrival.op === "close") {
      for (const item of cases[arrival.c]!.items) item.answered = true;
      cases[arrival.c]!.closed = true;
    } else if (arrival.op === "answer") {
      for (const item of cases[arrival.c]!.items) if (item.suspect) item.answered = true;
    } else if (arrival.op === "suspect") {
      if (!cases[arrival.c]!.closed) cases[arrival.c]!.items.push({ at, suspect: true, answered: false });
    } else if (arrival.op === "erase") erased = true;
    else if (arrival.op === "erase_image") erasedImages[arrival.img] = true;
    else deleted = true;

    const standing = ledger.filter(inForce);
    const level = erased || standing.some((m) => m.k === "remove") ? "removed" : standing.some((m) => m.k === "withhold") ? "withheld" : "visible";
    const sealed = standing.some((m) => m.k === "seal_media");
    const images = [0, 1].map((img) =>
      sealed
        ? "sealed"
        : erasedImages[img] || standing.some((m) => m.k === "remove_media" && m.img === img)
          ? "removed"
          : standing.some((m) => m.k === "withhold_media" && m.img === img)
            ? "withheld"
            : "visible",
    );
    if (previous === "visible" && level !== "visible") hidden = true;
    if (previous !== "visible" && level === "visible") {
      restored = true;
      // The span that just ended is added to it; inside one transaction that span is 0.
      exploreShift = exploreShift ?? 0;
    }
    previous = level;
    out.push({ level, state: deleted ? "deleted_by_author" : level, images, hidden, restored, exploreShift });
  });
  return out;
}

/** Every order of these arrivals in which a reversal comes after what it lifts. */
function orders(arrivals: readonly Arrival[]): Arrival[][] {
  const all: Arrival[][] = [];
  const walk = (taken: Arrival[], left: Arrival[]) => {
    if (left.length === 0) return void all.push(taken);
    left.forEach((next, index) => {
      if (next.op === "lift" && !taken.some((earlier) => (earlier.op === "measure" || earlier.op === "seal") && earlier.key === next.key)) return;
      walk([...taken, next], [...left.slice(0, index), ...left.slice(index + 1)]);
    });
  };
  walk([], [...arrivals]);
  return all;
}

/** A seeded generator of numbers from 0 up to 1, so the generated sequences are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sequence of this many arrivals drawn from everything that can arrive, each reversal after its measure. */
function drawn(random: () => number, length: number): Arrival[] {
  const pick = <T>(of: readonly T[]): T => of[Math.floor(random() * of.length)]!;
  const sequence: Arrival[] = [];
  const liftable: string[] = [];
  let suspects = 0;
  while (sequence.length < length) {
    const key = `m${sequence.length}`;
    const kind = pick(["measure", "measure", "measure", "seal", "lift", "lift", "close", "answer", "suspect", "erase", "erase_image", "delete"] as const);
    if (kind === "measure") {
      const k = pick(["withhold", "remove", "withhold_media", "remove_media"] as const);
      const image = k === "withhold_media" || k === "remove_media" ? { img: pick([0, 1] as const) } : {};
      sequence.push({ op: "measure", c: pick([1, 2] as const), d: k === "withhold" || k === "withhold_media" ? "interim" : pick(["interim", "final"] as const), k, ...image, key });
      liftable.push(key);
    } else if (kind === "seal") {
      sequence.push({ op: "seal", c: pick([2, 3] as const), d: pick(["interim", "final"] as const), key });
      liftable.push(key);
    } else if (kind === "lift") {
      if (liftable.length === 0) continue;
      sequence.push({ op: "lift", key: liftable.splice(Math.floor(random() * liftable.length), 1)[0]! });
    } else if (kind === "suspect") {
      // The replay holds four spare notices for the items that arrive.
      if (suspects === 4) continue;
      suspects++;
      sequence.push({ op: "suspect", c: pick([2, 3] as const) });
    } else if (kind === "close" || kind === "answer") sequence.push({ op: kind, c: pick([2, 3] as const) });
    else if (kind === "erase_image") sequence.push({ op: "erase_image", img: pick([0, 1] as const) });
    else sequence.push({ op: kind });
  }
  return sequence;
}

/**
 * The replay, as a function of the test's own session: it applies each sequence's arrivals to the ledger as rows, calls
 * public.moderation_apply after each and notes what the post and its images then are, and undoes the sequence before the
 * next (a block that ends in an exception rolls its writes back, while what it noted in a variable stays). It writes the
 * ledger's rows itself, with their times, so it needs the triggers of decisions and decision_actions switched off: only
 * the migrator can do that, and only inside the transaction the test rolls back.
 */
const REPLAY = `
create function pg_temp.replay(p_post uuid, p_images uuid[], p_author uuid, p_staff uuid, p_cases uuid[], p_snapshots uuid[], p_answers uuid[], p_intakes uuid[], p_base timestamptz, p_sequences jsonb)
returns jsonb language plpgsql as $fn$
declare
  results jsonb := '[]'::jsonb;
  steps jsonb;
  seq jsonb;
  arrival jsonb;
  op text;
  n integer;
  tick integer;
  spare integer;
  stamp timestamptz;
  keys jsonb;
  made uuid;
  row_id uuid;
  target uuid;
begin
  for seq in select t.value from jsonb_array_elements(p_sequences) with ordinality as t(value, place) order by t.place loop
    steps := '[]'::jsonb;
    begin
      keys := '{}'::jsonb;
      tick := 0;
      spare := 0;
      for arrival in select t.value from jsonb_array_elements(seq) with ordinality as t(value, place) order by t.place loop
        tick := tick + 1;
        stamp := p_base + make_interval(secs => tick);
        op := arrival ->> 'op';
        n := (arrival ->> 'c')::integer;
        if op in ('measure', 'seal') then
          insert into public.decisions (case_id, kind, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                                        facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
          values (p_cases[n], (arrival ->> 'd')::public.decision_kind, 0, 0, 'restricted', 'incompatible', 'R1', 2, 1, 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'report', p_snapshots[n], repeat('a', 64),
                  repeat('b', 64), repeat('c', 64), p_staff, stamp, pg_current_xact_id(), replace(gen_random_uuid()::text, '-', ''), stamp, false, false, false)
          returning id into made;
          insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, created_at)
          values (made, (case when op = 'seal' then 'seal_media' else arrival ->> 'k' end)::public.action_kind,
                  case when (arrival ->> 'img') is not null then p_images[(arrival ->> 'img')::integer + 1] end, p_author,
                  case when op = 'measure' then p_post end, stamp)
          returning id into row_id;
          if op = 'seal' then
            insert into public.seal_posts (action_id, post_id, images) values (row_id, p_post, cardinality(p_images));
          end if;
          keys := keys || jsonb_build_object(arrival ->> 'key', row_id);
        elsif op = 'lift' then
          target := (keys ->> (arrival ->> 'key'))::uuid;
          insert into public.decisions (case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                                        reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
          select x.case_id, 'correction', x.id, 0, 0, 'reversed', 2, 1, x.category, 'report', x.snapshot_id, x.snapshot_digest,
                 repeat('d', 64), p_staff, stamp, pg_current_xact_id(), replace(gen_random_uuid()::text, '-', ''), stamp, false, false, false
            from public.decisions x join public.decision_actions y on y.decision_id = x.id where y.id = target
          returning id into made;
          insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, reverses_action_id, created_at)
          select made, (case when y.kind = 'seal_media' then 'unseal_media' when y.kind in ('withhold', 'remove') then 'restore' else 'restore_media' end)::public.action_kind,
                 y.media_id, y.subject_account_id, y.post_id, y.id, stamp
            from public.decision_actions y where y.id = target;
        elsif op = 'close' then
          update public.intake_items i set answered_by = p_answers[n], outcome = 'no_violation' where i.case_id = p_cases[n] and i.answered_by is null;
          update public.cases k set closed_at = coalesce(k.closed_at, stamp), answered_seq = k.intake_seq where k.id = p_cases[n];
        elsif op = 'answer' then
          update public.intake_items i set answered_by = p_answers[n], outcome = 'no_violation' where i.case_id = p_cases[n] and i.suspect and i.answered_by is null;
        elsif op = 'suspect' then
          if exists (select 1 from public.cases k where k.id = p_cases[n] and k.closed_at is null) then
            spare := spare + 1;
            insert into public.intake_items (intake_id, case_id, target_type, target_id, position, lane, named_handle)
            select p_intakes[spare], k.id, k.target_type, k.target_id, 1, 0, case when k.target_type = 'account' then 'named' end from public.cases k where k.id = p_cases[n]
            returning id into row_id;
            update public.intake_items i set created_at = stamp where i.id = row_id;
          end if;
        elsif op = 'erase' then
          update public.posts p set erased_at = stamp where p.id = p_post;
        elsif op = 'erase_image' then
          update public.post_media m set erased_at = stamp where m.id = p_images[(arrival ->> 'img')::integer + 1];
        elsif op = 'delete' then
          update public.posts p set state = 'deleted_by_author', body = '', deleted_at = stamp where p.id = p_post and p.state <> 'deleted_by_author';
        else
          raise exception 'the replay does not know the arrival %', op;
        end if;
        perform public.moderation_apply(array[p_post], true);
        steps := steps || (
          select jsonb_build_object('level', p.moderation_level, 'state', p.state,
                                    'images', (select jsonb_agg(m.moderation_state order by m.position) from public.post_media m where m.post_id = p.id),
                                    'hidden', p.hidden_at is not null, 'restored', p.restored_at is not null,
                                    'exploreShift', (extract(epoch from p.explore_from - p.created_at) * 1000000)::bigint)
            from public.posts p where p.id = p_post);
      end loop;
      raise exception 'undo' using errcode = 'KB001';
    exception when sqlstate 'KB001' then
      null;
    end;
    results := results || jsonb_build_array(steps);
  end loop;
  return results;
end $fn$`;

/**
 * The derivation and the posts' guard (3c design, section 6.2, property P1) against the real database. First
 * public.moderation_apply against the reference implementation above, over generated sequences of measures, reversals,
 * closures, answers and erasures on one post across three cases, in every order of arrival: after each arrival the
 * post's level, its state and each image's state are what the rules alone give, and where nothing in a set depends on
 * time every order ends the same. Then the named cases, by real decisions through the moderation module's decide, which
 * show that the triggers call the derivation where they must. Then the guard that leaves the moderation columns of posts
 * to it. Every test runs inside one transaction that is rolled back; the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the derivation of a post's level and its images' states, and the posts' guard", () => {
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
  /** The error of one statement inside a transaction, which stays usable: the statement runs in a savepoint. */
  const run = (tx: DbTx, statement: ReturnType<typeof sql>) => pgError(tx.transaction((sp) => sp.execute(statement)));
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
  const removal = { kind: "final", actions: [act("remove")] } as const;
  const restore = (reviewsDecisionId: string) => ({ kind: "correction", reviewsDecisionId, actions: [act("restore")] }) as const;

  describe("moderation_apply against the reference implementation", () => {
    /**
     * The post with its two images, the three cases with their items, a snapshot and an answering decision for each case,
     * and four spare notices, in a transaction of the migrator; then the replay over the sequences, and what it noted.
     */
    async function replayed(sequences: readonly (readonly Arrival[])[]): Promise<Derived[][]> {
      let results: Derived[][] = [];
      await rolledBack(migrateDb, async (tx) => {
        const [author, staff, reporter] = [await profile(tx), await profile(tx), await profile(tx)];
        const postId = await newPostRow(tx, author.id);
        const images = [await newImageRow(tx, author.id, postId, 0), await newImageRow(tx, author.id, postId, 1)];
        const earlier = await openCase(tx, "post", postId);
        await tx.execute(sql`update cases set closed_at = now() - interval '2 days' where id = ${earlier}::uuid`);
        const cases = [earlier, await openCase(tx, "post", postId), await openCase(tx, "account", author.id)];
        await insertItem(tx, { intakeId: await csamNotice(tx), caseId: cases[1]!, targetId: postId, lane: 0 });
        await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id), caseId: cases[1]!, targetId: postId });
        await insertItem(tx, { intakeId: await csamNotice(tx), caseId: cases[2]!, targetType: "account", targetId: author.id, lane: 0, namedHandle: author.handle });
        // Everything the cases hold from the start is a day old; each arrival is a second later than the one before.
        const [{ base }] = (await tx.execute<{ base: string }>(sql`select (now() - interval '1 day')::text as base`)) as unknown as [{ base: string }];
        await tx.execute(sql`update intake_items set created_at = ${base}::timestamptz where case_id = any(${uuids(cases)})`);
        const spares = [await csamNotice(tx), await csamNotice(tx), await csamNotice(tx), await csamNotice(tx)];
        const snapshots: string[] = [];
        for (const [index, caseId] of cases.entries()) {
          const [row] = await tx.execute<{ id: string }>(sql`
            insert into evidence_snapshots (case_id, target_type, target_id, author_handle, digest)
            values (${caseId}::uuid, ${index === 2 ? "account" : "post"}::moderation_target, ${index === 2 ? author.id : postId}::uuid, 'author', ${"e".repeat(64)}) returning id`);
          snapshots.push(row!.id);
        }
        // From here on the ledger is written by hand: the decision triggers would refuse rows that no decision made.
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await tx.execute(sql`alter table public.decision_actions disable trigger user`);
        const answers: string[] = [];
        for (const [index, caseId] of cases.entries()) {
          const [row] = await tx.execute<{ id: string }>(sql`
            insert into decisions (case_id, kind, seen_state_version, through_seq, outcome, rules_version, redress_version, category, source, snapshot_id, snapshot_digest, decided_by, decided_at, xact,
                                   puid, informed_at, suspect, needs_admin, ended_interim)
            values (${caseId}::uuid, 'final', 0, 0, 'no_violation', 2, 1, 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'report', ${snapshots[index]!}::uuid, ${"e".repeat(64)}, ${staff.id}::uuid,
                    ${base}::timestamptz, pg_current_xact_id(), replace(gen_random_uuid()::text, '-', ''), ${base}::timestamptz, false, false, false)
            returning id`);
          answers.push(row!.id);
        }
        await tx.execute(sql.raw(REPLAY));
        const [row] = await tx.execute<{ results: Derived[][] }>(sql`
          select pg_temp.replay(${postId}::uuid, ${uuids(images)}, ${author.id}::uuid, ${staff.id}::uuid, ${uuids(cases)}, ${uuids(snapshots)}, ${uuids(answers)}, ${uuids(spares)},
                                ${base}::timestamptz, ${JSON.stringify(sequences)}::text::jsonb) as results`);
        results = row!.results;
        // The replay undid every sequence: the ledger holds nothing but the three answering decisions.
        const [left] = await tx.execute<{ decisions: number; actions: number }>(
          sql`select (select count(*)::int from decisions where case_id = any(${uuids(cases)})) as decisions, (select count(*)::int from decision_actions where subject_account_id = ${author.id}::uuid) as actions`,
        );
        expect({ ...left! }).toEqual({ decisions: 3, actions: 0 });
      });
      return results;
    }

    /** Runs every sequence and holds each step to the reference; answers the last step of each. */
    async function held(sequences: readonly (readonly Arrival[])[]): Promise<Derived[]> {
      const results = await replayed(sequences);
      expect(results).toHaveLength(sequences.length);
      sequences.forEach((sequence, index) => {
        const expected = reference(sequence);
        if (results[index]!.map(canonical).join() !== expected.map(canonical).join()) {
          // The whole sequence, so a failure can be replayed by hand.
          expect({ sequence, derived: results[index] }).toEqual({ sequence, derived: expected });
        }
      });
      return results.map((steps) => steps[steps.length - 1]!);
    }

    test("the reference itself: the strongest measure in force, a closed case's interim measure not in force, a seal over everything", () => {
      const steps = reference([
        { op: "measure", c: 2, d: "interim", k: "withhold", key: "w" },
        { op: "measure", c: 1, d: "final", k: "remove", key: "r" },
        { op: "seal", c: 3, d: "interim", key: "s" },
        { op: "lift", key: "r" },
        { op: "answer", c: 3 },
        { op: "measure", c: 2, d: "final", k: "remove_media", img: 1, key: "i" },
        { op: "close", c: 2 },
        { op: "delete" },
      ]);
      expect(steps.map((step) => `${step.state}/${step.level} ${step.images.join(",")}`)).toEqual([
        "withheld/withheld visible,visible",
        "removed/removed visible,visible",
        "removed/removed sealed,sealed",
        "withheld/withheld sealed,sealed",
        "withheld/withheld visible,visible",
        "withheld/withheld visible,removed",
        "visible/visible visible,removed",
        "deleted_by_author/visible visible,removed",
      ]);
      // Explore's columns: hidden_at from the first step, which takes the post out of view; the moves between withheld and
      // removed set nothing; restored_at and explore_from when the case's closure gives the post back; deletion, nothing.
      const hiddenOnly = { hidden: true, restored: false, exploreShift: null };
      const given = { hidden: true, restored: true, exploreShift: 0 };
      expect(steps.map(({ hidden, restored, exploreShift }) => ({ hidden, restored, exploreShift }))).toEqual([hiddenOnly, hiddenOnly, hiddenOnly, hiddenOnly, hiddenOnly, hiddenOnly, given, given]);
    });

    /** The distinct ends of the sequences, by level, state and images; Explore's columns depend on the path, not only on the end. */
    const ends = (results: Derived[]) =>
      [...new Set(results.map(({ level, state, images }) => JSON.stringify({ level, state, images })))].map((end) => JSON.parse(end) as Pick<Derived, "level" | "state" | "images">);

    test("a removal from an earlier case with its reversal, and a withhold and an image's removal from the open case with its closure, in every order of arrival: each step is the reference's, and every order ends the same", async () => {
      const sequences = orders([
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
        { op: "lift", key: "r1" },
        { op: "measure", c: 2, d: "interim", k: "withhold", key: "w2" },
        { op: "close", c: 2 },
        { op: "measure", c: 2, d: "final", k: "remove_media", img: 0, key: "i2" },
      ]);
      expect(sequences).toHaveLength(60);
      // Nothing here depends on time: whatever the order, the image's removal is all that is left.
      expect(ends(await held(sequences))).toEqual([{ level: "visible", state: "visible", images: ["removed", "visible"] }]);
    });

    test("image measures from two cases, a reversal, a closure and an erased image, in every order of arrival", async () => {
      const sequences = orders([
        { op: "measure", c: 1, d: "final", k: "remove_media", img: 0, key: "i1" },
        { op: "lift", key: "i1" },
        { op: "measure", c: 2, d: "interim", k: "withhold_media", img: 0, key: "j2" },
        { op: "measure", c: 2, d: "interim", k: "withhold_media", img: 1, key: "k2" },
        { op: "erase_image", img: 1 },
      ]);
      expect(sequences).toHaveLength(60);
      // The open case's withhold of the first image stands; the second image was erased, which outranks its withhold.
      expect(ends(await held(sequences))).toEqual([{ level: "visible", state: "visible", images: ["withheld", "removed"] }]);
    });

    test("two cases' removals with both reversals and the author's deletion, and an erasure against a reversal, in every order of arrival", async () => {
      const removals = orders([
        { op: "measure", c: 2, d: "final", k: "remove", key: "r2" },
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
        { op: "lift", key: "r1" },
        { op: "lift", key: "r2" },
        { op: "delete" },
      ]);
      expect(removals).toHaveLength(30);
      expect(ends(await held(removals))).toEqual([{ level: "visible", state: "deleted_by_author", images: ["visible", "visible"] }]);
      // With the post's content erased, no reversal and no closure brings it back.
      const erased = orders([
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
        { op: "lift", key: "r1" },
        { op: "erase" },
        { op: "measure", c: 2, d: "interim", k: "withhold", key: "w2" },
        { op: "close", c: 2 },
      ]);
      expect(erased).toHaveLength(60);
      expect(ends(await held(erased))).toEqual([{ level: "removed", state: "removed", images: ["visible", "visible"] }]);
    });

    test("a seal taken while deciding, the answer to its suspect item, a later suspect item, and a seal for good with its lifting, in every order of arrival", async () => {
      const sequences = orders([
        { op: "seal", c: 2, d: "interim", key: "s2" },
        { op: "answer", c: 2 },
        { op: "suspect", c: 2 },
        { op: "seal", c: 3, d: "final", key: "s3" },
        { op: "lift", key: "s3" },
      ]);
      expect(sequences).toHaveLength(60);
      const results = await held(sequences);
      // The images end sealed only where the seal taken while deciding was taken after the later suspect item arrived and
      // that item was not answered since: an item that arrives after a seal's decision never brings the seal back.
      const sealed = sequences.filter((_, index) => results[index]!.images[0] === "sealed");
      expect(sealed).toHaveLength(10);
      for (const sequence of sealed) {
        const place = (wanted: (arrival: Arrival) => boolean) => sequence.findIndex(wanted);
        const [answer, suspect, seal] = [place((a) => a.op === "answer"), place((a) => a.op === "suspect"), place((a) => a.op === "seal" && a.c === 2)];
        expect(answer < suspect && suspect < seal, JSON.stringify(sequence)).toBe(true);
      }
      expect(ends(results).map((end) => end.level)).toEqual(expect.arrayContaining(["visible"]));
    });

    test("an account's seal taken while deciding, its case's closure, a seal for good with its lifting, and a removal of the post, in every order of arrival", async () => {
      const sequences = orders([
        { op: "seal", c: 3, d: "interim", key: "s3" },
        { op: "close", c: 3 },
        { op: "seal", c: 3, d: "final", key: "f3" },
        { op: "lift", key: "f3" },
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
      ]);
      expect(sequences).toHaveLength(60);
      // Every seal has ended or was lifted; the removal stands, and the images are not sealed whatever the post's level.
      expect(ends(await held(sequences))).toEqual([{ level: "removed", state: "removed", images: ["visible", "visible"] }]);
    });

    test("eighty drawn sequences of ten arrivals from everything that can arrive", async () => {
      const random = seeded(20261004);
      const sequences = Array.from({ length: 80 }, () => drawn(random, 10));
      const results = await held(sequences);
      // The draw reaches every level and every image state, so the comparison was not over one corner.
      expect(new Set(results.map((end) => end.level))).toEqual(new Set(["visible", "withheld", "removed"]));
      expect(new Set(results.flatMap((end) => end.images))).toEqual(new Set(["visible", "withheld", "removed", "sealed"]));
      expect(results.some((end) => end.state === "deleted_by_author")).toBe(true);
      // And Explore's columns in each of their states: never hidden, hidden and not given back, and given back.
      expect(new Set(results.map((end) => `${end.hidden}/${end.restored}`))).toEqual(new Set(["false/false", "true/false", "true/true"]));
    });
  });

  describe("the named cases, by real decisions", () => {
    test("case 2's interim withhold stays when case 1's removal of the post is reversed: the post ends withheld", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const first = await report(tx, aPost(p.postId));
        const removed = await decideIn(tx, mod, first.caseId, removal);
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        const second = await report(tx, aPost(p.postId));
        expect(second.caseId).not.toBe(first.caseId);
        const withheld = await decideIn(tx, mod, second.caseId, { kind: "interim", actions: [act("withhold")] });
        expect((await actionsOf(tx, withheld))[0]!.no_effect).toBe("already");
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        await decideIn(tx, mod, first.caseId, restore(removed));
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "withheld", level: "withheld" });
        // And the withhold ends with its case.
        await decideIn(tx, mod, second.caseId, { kind: "final", outcome: "no_violation" });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });

    test("two cases' removals: either reversed leaves the post removed, both reversed leave it visible, in either order", async () => {
      await inWorld(async (tx) => {
        for (const order of ["first", "second"] as const) {
          const p = await imagePost(tx);
          const one = await report(tx, aPost(p.postId));
          const removedOne = await decideIn(tx, mod, one.caseId, removal);
          const two = await report(tx, aPost(p.postId));
          const removedTwo = await decideIn(tx, mod, two.caseId, removal);
          expect((await actionsOf(tx, removedTwo))[0]!.no_effect).toBe("already");
          const [early, late] = order === "first" ? [[one.caseId, removedOne], [two.caseId, removedTwo]] : [[two.caseId, removedTwo], [one.caseId, removedOne]];
          await decideIn(tx, mod, early![0]!, restore(early![1]!));
          expect(await postRow(tx, p.postId), order).toMatchObject({ state: "removed", level: "removed" });
          await decideIn(tx, mod, late![0]!, restore(late![1]!));
          expect(await postRow(tx, p.postId), order).toMatchObject({ state: "visible", level: "visible" });
        }
      });
    });

    test("a lifted seal while another case's removal of the post is in force leaves the post removed and its images not sealed", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const rule = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, rule.caseId, removal);
        const suspect = await report(tx, aPost(p.postId), "csam");
        const seal = await decideIn(tx, admin, suspect.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        // Sealed whatever the post's level.
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed", "sealed"]);
        await decideIn(tx, admin, suspect.caseId, { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
      });
    });

    test("an interim withhold stays while a final decision leaves its case open, and ends when the case closes, with no restore", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        await report(tx, aPost(p.postId));
        const partial = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect(await readCase(tx, caseId)).toMatchObject({ answered_seq: 1, intake_seq: 2, closed_at: null });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "withheld", level: "withheld" });
        expect(await decisionRow(tx, partial)).toMatchObject({ ended_interim: false, author_mail: "none" });
        const closing = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "visible", level: "visible" });
        expect(await actionsOf(tx, closing)).toEqual([]);
        // The author was told of the withhold, so they are told that it ended.
        expect(await decisionRow(tx, closing)).toMatchObject({ ended_interim: true, author_mail: "pending" });
      });
    });

    test("a deleted post's state stays deleted_by_author while its level follows the ledger", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const { caseId } = await report(tx, aPost(p.postId));
        await authorDeletes(tx, p.postId);
        const removed = await decideIn(tx, mod, caseId, removal);
        expect((await actionsOf(tx, removed))[0]!.no_effect).toBe("deleted");
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "deleted_by_author", level: "removed" });
        await decideIn(tx, mod, caseId, restore(removed));
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "deleted_by_author", level: "visible" });
      });
    });

    test("erased content keeps a post, and an erased image, removed after every reversal", async () => {
      // As the migrator: only its erasure, which a later migration brings, writes the erasure times.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId));
        const removed = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove"), act("remove_media", p.mediaIds[0]!), act("remove_media", p.mediaIds[1]!)] });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["removed", "removed"]);
        await tx.execute(sql`update posts set erased_at = now() where id = ${p.postId}::uuid`);
        await tx.execute(sql`update post_media set erased_at = now() where id = ${p.mediaIds[0]!}::uuid`);
        await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: removed, actions: [act("restore"), act("restore_media", p.mediaIds[0]!), act("restore_media", p.mediaIds[1]!)] });
        expect(await postRow(tx, p.postId)).toEqual({ state: "removed", level: "removed", erased: true });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["removed", "visible"]);
      }, migrateDb);
    });

    test("image measures: a withheld image ends with its case, a removed one stays until it is reversed, and the post's own level never moves", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const [one, two] = p.mediaIds as [string, string];
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold_media", one)] });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["withheld", "visible"]);
        const removed = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove_media", two)] });
        // The case closed: what was withheld while deciding is visible again, and the removal stands.
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "removed"]);
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "visible", level: "visible" });
        await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: removed, actions: [act("restore_media", two)] });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
      });
    });
  });

  describe("the posts' guard", () => {
    const guarded = { code: "42501", message: "moderation_column" };

    test("the API role moves a post's state only to the author's deletion: every other write of state, level or erasure is refused", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        expect(await run(tx, sql`update posts set state = 'withheld' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await run(tx, sql`update posts set state = 'removed' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await run(tx, sql`update posts set state = 'removed', body = '' where id = ${p.postId}::uuid`)).toEqual(guarded);
        // The level and the erasure time are not the API role's to write at all.
        expect(await run(tx, sql`update posts set moderation_level = 'removed' where id = ${p.postId}::uuid`)).toMatchObject({ code: "42501" });
        expect(await run(tx, sql`update posts set erased_at = now() where id = ${p.postId}::uuid`)).toMatchObject({ code: "42501" });
        expect(await postRow(tx, p.postId)).toEqual({ state: "visible", level: "visible", erased: false });

        // A post a decision withheld or removed is not brought back by a write either.
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await run(tx, sql`update posts set state = 'visible' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await run(tx, sql`update posts set state = 'removed' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "withheld", level: "withheld" });

        // What the API writes on a post still passes on a withheld one: a counter, a statement that names the state
        // without changing it, and the author's deletion.
        expect(await run(tx, sql`update posts set like_count = like_count + 1, reply_count = reply_count + 1 where id = ${p.postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = state, like_count = like_count + 1 where id = ${p.postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${p.postId}::uuid`)).toBeNull();
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "deleted_by_author", level: "withheld" });
      });
    });

    test("the API role inserts a post only as visible, at level visible and unerased, and with Explore's three columns forced null", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const insert = (columns: string, values: string) => run(tx, sql`insert into posts (author_id, body${sql.raw(columns)}) values (${author.id}::uuid, 'a post'${sql.raw(values)})`);
        for (const state of ["withheld", "removed", "deleted_by_author"]) expect(await insert(", state", `, '${state}'`), state).toEqual(guarded);
        for (const level of ["withheld", "removed"]) expect(await insert(", moderation_level", `, '${level}'`), level).toMatchObject({ code: "42501" });
        expect(await insert(", erased_at", ", now()")).toMatchObject({ code: "42501" });
        expect(await insert(", state", ", 'visible'")).toBeNull();
        expect(await insert("", "")).toBeNull();
        // 3e (explore_resume): whatever the insert supplies for hidden_at, restored_at and explore_from, the row holds null.
        const [row] = await tx.execute<{ hidden: string | null; restored: string | null; from: string | null }>(sql`
          insert into posts (author_id, body, hidden_at, restored_at, explore_from) values (${author.id}::uuid, 'forced', now() - interval '1 day', now(), now() - interval '1 hour')
          returning hidden_at as hidden, restored_at as restored, explore_from as from`);
        expect(row).toEqual({ hidden: null, restored: null, from: null });
      });
    });

    test("a post never leaves deleted_by_author, for the migrator either; everything else the migrator may write", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        expect(await run(tx, sql`update posts set state = 'removed', moderation_level = 'removed', erased_at = now() where id = ${p.postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = 'visible', moderation_level = 'visible', erased_at = null where id = ${p.postId}::uuid`)).toBeNull();
        await authorDeletes(tx, p.postId);
        for (const state of ["visible", "withheld", "removed"]) {
          expect(await run(tx, sql`update posts set state = ${state}::post_state where id = ${p.postId}::uuid`), state).toEqual(guarded);
        }
        // The level of a deleted post still follows the ledger.
        expect(await run(tx, sql`update posts set moderation_level = 'removed' where id = ${p.postId}::uuid`)).toBeNull();
        const author = await profile(tx);
        expect(await run(tx, sql`insert into posts (author_id, body, state, moderation_level) values (${author.id}::uuid, 'restored', 'removed', 'removed')`)).toBeNull();
        // The migrator's insert keeps Explore's three columns as given (3e, explore_resume), as a restore of a copy needs.
        const [row] = await tx.execute<{ kept: boolean }>(sql`
          insert into posts (author_id, body, hidden_at, restored_at, explore_from) values (${author.id}::uuid, 'restored', now() - interval '1 day', now(), now() - interval '1 hour')
          returning hidden_at = now() - interval '1 day' and restored_at = now() and explore_from = now() - interval '1 hour' as kept`);
        expect(row!.kept).toBe(true);
      }, migrateDb);
    });

    test("the API role can call neither the writer of the moderation columns nor what only it calls, and writes no seal's list", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const denied = (name: string) => expect.objectContaining({ code: "42501", message: expect.stringMatching(new RegExp(`permission denied for function ${name}`)) });
        expect(await run(tx, sql`select public.moderation_apply(${uuids([p.postId])}, true)`)).toEqual(denied("moderation_apply"));
        expect(await run(tx, sql`select public.item_current_outcome(${p.postId}::uuid, now())`)).toEqual(denied("item_current_outcome"));
        expect(await run(tx, sql`select public.account_is_staff(${p.authorId}::uuid)`)).toEqual(denied("account_is_staff"));
        expect(await run(tx, sql`select public.staff_party_conflict(${mod.id}::uuid, ${uuids([p.authorId])}, null)`)).toEqual(denied("staff_party_conflict"));
        expect(await run(tx, sql`insert into seal_posts (action_id, post_id, images) values (gen_random_uuid(), ${p.postId}::uuid, 1)`)).toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table seal_posts/) });
        expect(await refusal(tx.transaction((sp) => sp.execute(sql`update post_media set moderation_state = 'sealed' where id = ${p.mediaIds[0]!}::uuid`)))).toMatch(/^42501 /);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
