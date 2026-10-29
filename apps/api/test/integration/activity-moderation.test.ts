import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTIVITY_PAGE_SIZE, AuthorCasesPage, type ActivityEntry } from "@korbat/contracts";
import { activityPage } from "../../src/activity/flows";
import { storedImageName } from "../../src/media/files";
import { activityHarness, type ActivityHarness } from "./activity-harness";
import { matchForTest } from "./automation-fixtures";
import { decideForTest, leavesNoModerationRows, suspendForTest } from "./moderation-decide";
import { aPost, ground, intake, newImageRow, newPostRow, saveText, uuids } from "./moderation-fixtures";

// Decisions are real, confirmed with a staff key; the suites around them sign accounts up over HTTP.
vi.setConfig({ testTimeout: 240_000 });

/** A time as the database writes Activity's: ISO in UTC to the microsecond. */
const MICROS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * Moderation entries of Activity (2d design, section 5.5.2; section 12.3): read only from the reads the author's own Cases
 * and Notices use and from lost_told_for, never written; listed no earlier than the author may be told and no older than
 * 90 days by the told time; merged with the social entries by (at, key) into one stable order across pages.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: moderation entries in Activity", () => {
  let h: ActivityHarness;
  /** Rows this file wrote that no fixture removes: releases and quarantine files, by id. */
  const releases: string[] = [];
  const lostMedia: string[] = [];

  beforeAll(async () => {
    h = await activityHarness();
  }, 120_000);
  afterAll(async () => {
    try {
      await h?.migrateDb.execute(sql`delete from quarantine_files where media_id = any(${uuids(lostMedia)})`);
      await h?.migrateDb.execute(sql`delete from releases where id = any(${uuids(releases)})`);
    } finally {
      await h?.close();
    }
  }, 120_000);

  const signUp = () => h.signUp();
  const moderation = (items: readonly ActivityEntry[]) => items.filter((entry) => entry.type === "moderation");
  /** A decision's id and when its author was told, to the microsecond. */
  const decisionsOf = async (postId: string) =>
    h.migrateDb.execute<{ id: string; kind: string; at: string | null; told: boolean }>(sql`
      select d.id, d.kind::text as kind, to_char(d.informed_at at time zone 'UTC', ${MICROS}) as at, (d.author_mail <> 'none' and d.informed_at is not null) as told
        from decisions d join cases c on c.id = d.case_id where c.target_type = 'post' and c.target_id = ${postId}::uuid order by d.decided_at, d.id`);
  /** A release of these posts, as the command line's replay writes one (no seal, no admin), and its notice as given. */
  async function releaseOf(postIds: string[], notice: string): Promise<{ id: string; at: string }> {
    const [row] = await h.migrateDb.execute<{ id: string; at: string }>(sql`
      insert into releases (post_ids, basis, released_at, replay_of, backups_clear_at, author_notice)
      values (${uuids(postIds)}, 'period', now(), gen_random_uuid(), now() + interval '30 days', 'none')
      returning id, to_char(released_at at time zone 'UTC', ${MICROS}) as at`);
    releases.push(row!.id);
    await h.migrateDb.execute(sql`update releases set author_notice = ${notice} where id = ${row!.id}::uuid`);
    return row!;
  }

  test("a decision told to its author is an entry about its post, at the time it was told; one its author was told nothing of, one held untold and one the dispatch has not told yet make none, until told", async () => {
    const ada = await signUp();
    const post = await h.post(ada, "a post a decision withholds");
    await decideForTest(h.apiDb, post.id, "withheld");
    const [withhold] = await decisionsOf(post.id);
    expect(withhold).toMatchObject({ kind: "interim", told: true });
    const entry = { type: "moderation", kind: "decision", key: `d:${withhold!.id}`, at: withhold!.at, new: true, target: "post", id: withhold!.id, postId: post.id, postCreatedAt: post.createdAt };
    expect((await h.page(ada)).items).toEqual([entry]);
    // Told nothing: 3c's silent decisions carry author_mail none.
    const [mail] = await h.migrateDb.execute<{ state: string }>(sql`select author_mail::text as state from decisions where id = ${withhold!.id}::uuid`);
    await h.migrateDb.execute(sql`update decisions set author_mail = 'none' where id = ${withhold!.id}::uuid`);
    expect((await h.page(ada)).items).toEqual([]);
    await h.migrateDb.execute(sql`update decisions set author_mail = ${mail!.state}::delivery_state where id = ${withhold!.id}::uuid`);
    // Held with an order's notice, and then not yet told by the dispatch: informed_at is null, with no mail
    // (decisions_informed), until the dispatch tells it.
    await h.migrateDb.execute(sql`update decisions set informed_at = null, author_mail = 'none' where id = ${withhold!.id}::uuid`);
    expect((await h.page(ada)).items).toEqual([]);
    expect(moderation(await h.all(ada, "all"))).toEqual([]);
    await h.migrateDb.execute(sql`update decisions set informed_at = ${withhold!.at}::timestamptz, author_mail = ${mail!.state}::delivery_state where id = ${withhold!.id}::uuid`);
    expect((await h.page(ada)).items).toEqual([entry]);
    // The tab Conversations keeps none.
    expect((await h.page(ada, { tab: "conversations" })).items).toEqual([]);
    // Restored: every decision the author was told of is an entry, newest first, and no other.
    await decideForTest(h.apiDb, post.id, "visible");
    const told = (await decisionsOf(post.id)).filter((row) => row.told).map((row) => `decision:${row.id}`).reverse();
    expect(h.summary((await h.page(ada)).items)).toEqual(told);
  });

  test("a decision about the account names the account; a report about the recipient, the finding a decision rests on and a staff note never appear", async () => {
    const [cat, bob] = [await signUp(), await signUp()];
    const reported = await h.post(cat, "a post someone reports");
    const { decisionId, basisDecisionId } = await suspendForTest(h.apiDb, cat.id);
    const items = moderation(await h.all(cat));
    expect(items.find((entry) => entry.id === decisionId)).toMatchObject({ kind: "decision", target: "account", postId: null, postCreatedAt: null });
    expect(items.find((entry) => entry.id === basisDecisionId)).toMatchObject({ kind: "decision", target: "post" });
    // Bob's report of Cat's post and a staff note on its case: neither is anything Cat's reads may name.
    const recorded = await intake(h.apiDb, ground.rule(bob.id, "R1"), aPost(reported.id));
    const caseId = recorded.items[0]!.caseId!;
    const [decider] = await h.migrateDb.execute<{ id: string }>(sql`select decided_by as id from decisions where id = ${decisionId}::uuid`);
    await saveText(h.apiDb, caseId, decider!.id, "note");
    // decideForTest's own decisions removed below include this post's case: it is the suite's to decide.
    await decideForTest(h.apiDb, reported.id, "withheld");
    const after = moderation(await h.all(cat));
    const [told] = await h.migrateDb.execute<{ n: number }>(sql`
      select count(*)::int as n from decisions d join cases c on c.id = d.case_id
       where ((c.target_type = 'account' and c.target_id = ${cat.id}::uuid) or c.target_id in (select id from posts where author_id = ${cat.id}::uuid))
         and d.author_mail <> 'none' and d.informed_at is not null`);
    expect(after).toHaveLength(told!.n);
    expect(after.every((entry) => entry.kind === "decision")).toBe(true);
  });

  test("a decision told 91 days ago is no entry, one told 89 days ago is; the Cases screen lists both", async () => {
    const ada = await signUp();
    const [old, recent] = [await h.post(ada, "decided long ago"), await h.post(ada, "decided a while ago")];
    await decideForTest(h.apiDb, old.id, "withheld");
    await decideForTest(h.apiDb, recent.id, "withheld");
    const [[oldDecision], [recentDecision]] = [await decisionsOf(old.id), await decisionsOf(recent.id)];
    await h.migrateDb.execute(sql`update decisions set informed_at = now() - interval '91 days' where id = ${oldDecision!.id}::uuid`);
    await h.migrateDb.execute(sql`update decisions set informed_at = now() - interval '89 days' where id = ${recentDecision!.id}::uuid`);
    expect(moderation(await h.all(ada)).map((entry) => entry.id)).toEqual([recentDecision!.id]);
    const cases = AuthorCasesPage.parse(await (await ada.b.fetch("/api/moderation/cases")).json());
    expect(cases.decisions.map((row) => row.id).sort()).toEqual([oldDecision!.id, recentDecision!.id].sort());
  });

  test("a release whose notice is held makes no entry until its hold ends; a refused upload and a lost image the dispatch told are entries; the merge with the social entries keeps one order across pages, ties included", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    const replies = [await h.post(bob, "reply one", { replyToId: root.id }), await h.post(bob, "reply two", { replyToId: root.id }), await h.post(bob, "reply three", { replyToId: root.id })];
    // A release of Ada's post, its notice held: nothing; then pending, as releaseHeldNotices moves it once the hold ends.
    const release = await releaseOf([root.id], "held");
    expect(moderation((await h.page(ada)).items)).toEqual([]);
    await h.migrateDb.execute(sql`update releases set author_notice = 'pending' where id = ${release.id}::uuid`);
    expect(moderation((await h.page(ada)).items)).toEqual([{ type: "moderation", kind: "release", key: `r:${release.id}`, at: release.at, new: true, target: "account", id: release.id, postId: null, postCreatedAt: null }]);
    // A refused upload: an image on no post, refused for an acting match.
    const upload = await newImageRow(h.migrateDb, ada.id, null);
    const matchId = await matchForTest(h.migrateDb, upload, "acting");
    const [refusal] = await h.migrateDb.execute<{ id: string; at: string }>(sql`
      insert into upload_refusals (media_id, owner_id, match_id, refused_at) values (${upload}::uuid, ${ada.id}::uuid, ${matchId}::uuid, now())
      returning id, to_char(refused_at at time zone 'UTC', ${MICROS}) as at`);
    // A lost image of a post of Ada's: no entry while its mail is pending, one once 3d's dispatch told it.
    const lostPost = await newPostRow(h.migrateDb, ada.id);
    const lost = await newImageRow(h.migrateDb, ada.id, lostPost);
    lostMedia.push(lost);
    await h.migrateDb.execute(sql`insert into quarantine_files (media_id, file, lost_at) values (${lost}::uuid, ${storedImageName(lost, "small")}, now())`);
    expect(moderation(await h.all(ada)).map((entry) => entry.kind).sort()).toEqual(["release", "upload"]);
    await h.migrateDb.execute(sql`select public.lost_told(${lost}::uuid, 'sent'::delivery_state)`);
    const [lostRow] = await h.migrateDb.execute<{ at: string; created: string }>(sql`
      select to_char(q.lost_at at time zone 'UTC', ${MICROS}) as at, to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created
        from quarantine_files q join posts p on p.id = ${lostPost}::uuid where q.media_id = ${lost}::uuid`);
    const items = moderation(await h.all(ada));
    expect(items.find((entry) => entry.kind === "upload")).toEqual({ type: "moderation", kind: "upload", key: `u:${refusal!.id}`, at: refusal!.at, new: true, target: "account", id: refusal!.id, postId: null, postCreatedAt: null });
    expect(items.find((entry) => entry.kind === "lost")).toEqual({ type: "moderation", kind: "lost", key: `l:${lost}`, at: lostRow!.at, new: true, target: "post", id: lost, postId: lostPost, postCreatedAt: lostRow!.created });

    // Ties: the release, the refusal and the loss at the second reply's time exactly. Keys then decide, highest first: u, r,
    // l, then e.
    const [tie] = await h.migrateDb.execute<{ at: string }>(sql`select created_at::text as at from activity_items where post_id = ${replies[1]!.id}::uuid`);
    await h.migrateDb.execute(sql`update releases set released_at = ${tie!.at}::timestamptz where id = ${release.id}::uuid`);
    await h.migrateDb.execute(sql`update upload_refusals set refused_at = ${tie!.at}::timestamptz where id = ${refusal!.id}::uuid`);
    await h.migrateDb.execute(sql`update quarantine_files set lost_at = ${tie!.at}::timestamptz where media_id = ${lost}::uuid`);
    const whole = await activityPage(h.activity.deps, ada.id, { tab: "all" });
    expect(whole.items).toHaveLength(6);
    expect(whole.nextCursor).toBeNull();
    const keys = whole.items.map((entry) => entry.key);
    const atTie = whole.items.filter((entry) => entry.at === whole.items.find((e) => e.type === "post" && e.post.id === replies[1]!.id)!.at).map((entry) => entry.key.slice(0, 1));
    expect(atTie).toEqual(["u", "r", "l", "e"]);
    // Every page size gives the same entries in the same order, each once.
    for (const size of [1, 2, 4]) {
      const paged: string[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < 20; n++) {
        const got = await activityPage({ ...h.activity.deps, pageSize: size }, ada.id, { tab: "all", cursor });
        expect(got.items.length).toBeLessThanOrEqual(size);
        paged.push(...got.items.map((entry) => entry.key));
        if (got.nextCursor === null) break;
        cursor = got.nextCursor;
      }
      expect(paged, `pages of ${size}`).toEqual(keys);
    }
    expect(ACTIVITY_PAGE_SIZE).toBe(30);
  });

  leavesNoModerationRows(() => h.apiDb);

  test("this file left no row behind: the accounts it made go with what hangs on them, and 2d's tables hold what they held before it", async () => {
    await h.migrateDb.execute(sql`delete from quarantine_files where media_id = any(${uuids(lostMedia.splice(0))})`);
    await h.migrateDb.execute(sql`delete from releases where id = any(${uuids(releases.splice(0))})`);
    await h.removeMade();
    expect(await h.counts()).toEqual(h.before);
  });
});
