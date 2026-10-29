import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { MediaError, mediaForCases } from "../../src/media";
import { PRIVATE_CACHE, PUBLIC_CACHE, serve } from "../../src/media/flows/serve";
import { avatarSet } from "../../src/moderation/automated";
import type { ModerationDeps } from "../../src/moderation/context";
import { automationDeps, matchForTest, removeAutomation } from "./automation-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { deciderWorld, leavesNoModerationRows, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, removeFixtures } from "./moderation-fixtures";
import { removeRecords } from "./records-fixtures";
import { newProfile } from "./social-fixtures";
import { DAY_MS } from "../../src/social/tiers";

// Each test uploads and sets pictures, runs the program's step and commits a moderator's decision: slow on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * 2d Task 4 (design, sections 7.6 and 7.7; section 12.3): the checks of 3d on an avatar. moderation.avatarSet reads the
 * avatar's score and its match record through the media module (`signals` in its avatar form) on the module's background,
 * and the program's step takes the account branch: its finding on the account's case with the picture in its snapshot,
 * and never a measure, whatever AUTOMATION_R1_ACTS says, since no program takes a measure on an account. While
 * AUTOMATION_R1_ACTS is on, an R1 score also puts the picture under review (avatar_review): withheld from everyone but its
 * owner, who is served it under PRIVATE_CACHE, until a person answers the finding. A flag of the matcher opens the finding
 * the same way; an acting match refuses the upload, which then cannot be set. The share card's part of the review is
 * Task 6's (the cards do not exist yet).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the automated checks of an avatar", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let world: DeciderWorld;
  let mod: RealStaff;
  let h: MediaHarness;
  let startedAt: string;
  const accounts: string[] = [];
  const media: string[] = [];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    world = deciderWorld(apiDb);
    mod = await world.staff("moderator");
    h = await mediaHarness(apiDb);
    startedAt = (await apiDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
  }, 240_000);
  // What each test committed goes after it, so that the file's last test finds the moderation tables as they were.
  afterEach(async () => {
    await removeAutomation(migrateDb, startedAt, media.splice(0));
    const made = accounts.splice(0);
    await removeRecords(migrateDb, made);
    await removeFixtures(migrateDb, made);
  });
  afterAll(async () => {
    h.cleanup();
    await world.close();
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** An account three days old with a picture set, whose score the worker's result gave it (the API role writes the column). */
  async function pictured(score: number | null = 0.9): Promise<{ id: string; handle: string; avatar: string }> {
    const owner = await newProfile(apiDb, { createdAt: new Date(Date.now() - 3 * DAY_MS) });
    accounts.push(owner.id);
    const avatar = await h.readyAvatar(owner.id);
    media.push(avatar);
    await apiDb.transaction((tx) => h.deps.repo.attachAvatar(tx, owner.id, avatar));
    if (score !== null) await apiDb.execute(sql`update post_media set nsfw_score = ${score}::real where id = ${avatar}::uuid`);
    return { ...owner, avatar };
  }
  /** The moderation module's dependencies with the scorer `test` (threshold 0.5) and the media module over the harness's store. */
  const depsWith = (config: Parameters<typeof automationDeps>[2]): ModerationDeps => automationDeps(apiDb, { media: mediaForCases(h.deps) }, config);
  /** avatarSet as setAvatar calls it after its commit, and its background task waited for. */
  async function setThen(deps: ModerationDeps, accountId: string, mediaId: string): Promise<void> {
    avatarSet(deps, accountId, mediaId);
    await deps.background.settle();
  }
  /** What serving the large file answers the owner, another account and nobody signed in. */
  async function served(mediaId: string, owner: string, other: string): Promise<[string, string | null][]> {
    const answers: [string, string | null][] = [];
    for (const viewer of [owner, other, null]) {
      const answer = await serve(h.deps, { id: mediaId, size: "large", ifNoneMatch: undefined, viewer: async () => viewer });
      if (answer.kind === "file") await answer.file.handle.close();
      answers.push([answer.kind, answer.kind === "not_found" ? null : answer.cacheControl]);
    }
    return answers;
  }
  /** Whether avatarsOf gives the owner's picture to the owner, to another account and to nobody signed in. */
  const views = async (owner: string, other: string) => Promise.all([owner, other, null].map(async (viewer) => (await h.deps.repo.avatarsOf([owner], viewer)).has(owner)));
  /** The signal of the picture and what the step made of it: its item's case, intake and rule, and the case's decisions. */
  async function finding(mediaId: string) {
    const [row] = await apiDb.execute<{ kind: string; handled: string | null; decision_id: string | null; case_id: string | null; target_type: string | null; target_id: string | null; intake_kind: string | null; rule_id: string | null; decisions: number }>(sql`
      select s.kind, s.handled, s.decision_id, i.case_id, c.target_type::text as target_type, c.target_id, n.kind::text as intake_kind, n.rule_id,
             (select count(*)::int from decisions d where d.case_id = i.case_id) as decisions
        from automated_signals s left join intake_items i on i.id = s.intake_item_id left join intakes n on n.id = i.intake_id left join cases c on c.id = i.case_id
       where s.media_id = ${mediaId}::uuid`);
    return row ?? null;
  }
  const stateOf = async (mediaId: string) => (await apiDb.execute<{ state: string; profile_id: string | null }>(sql`select moderation_state::text as state, profile_id from post_media where id = ${mediaId}::uuid`))[0]!;
  const reviewOf = async (mediaId: string) => (await apiDb.execute<{ item_id: string }>(sql`select item_id from avatar_reviews where media_id = ${mediaId}::uuid`)).map((r) => r.item_id);

  test("AUTOMATION_R1_ACTS on: a score at the threshold opens the program's finding on the account's case and takes no measure; the picture is withheld from everyone but its owner, who is served it privately, until a moderator answers without a reset", async () => {
    const [ada, ben] = [await pictured(0.5), await pictured(null)];
    await setThen(depsWith({ AUTOMATION_R1_ACTS: "on" }), ada.id, ada.avatar);
    const found = await finding(ada.avatar);
    expect(found).toMatchObject({ kind: "r1_score", handled: "finding", decision_id: null, target_type: "account", target_id: ada.id, intake_kind: "automated", rule_id: "R1", decisions: 0 });
    // The snapshot of the account holds the picture, and the case holds its row.
    const [snapshot] = await apiDb.execute<{ media: { id: string }[] | null }>(sql`select media from evidence_snapshots where case_id = ${found!.case_id}::uuid order by taken_at desc limit 1`);
    expect(snapshot!.media?.map((image) => image.id)).toEqual([ada.avatar]);
    expect((await apiDb.execute(sql`select 1 from media_holds where media_id = ${ada.avatar}::uuid and case_id = ${found!.case_id}::uuid and released_at is null`)).length).toBe(1);
    // R1's hold for review: withheld, its outbox row, the owner alone served it and given it in views.
    expect(await reviewOf(ada.avatar)).toHaveLength(1);
    expect(await stateOf(ada.avatar)).toEqual({ state: "withheld", profile_id: ada.id });
    expect((await apiDb.execute<{ cause: string }>(sql`select cause from edge_purges where media_id = ${ada.avatar}::uuid`)).map((r) => r.cause)).toEqual(["state"]);
    expect(await served(ada.avatar, ada.id, ben.id)).toEqual([
      ["file", PRIVATE_CACHE],
      ["not_found", null],
      ["not_found", null],
    ]);
    expect(await views(ada.id, ben.id)).toEqual([true, false, false]);

    // A moderator answers the finding without a reset: the picture is public again.
    const outcome = await world.decideAs(mod, found!.case_id!, { kind: "final", outcome: "no_violation" });
    expect(typeof outcome).not.toBe("string");
    expect(await stateOf(ada.avatar)).toEqual({ state: "visible", profile_id: ada.id });
    expect(await served(ada.avatar, ada.id, ben.id)).toEqual([
      ["file", PUBLIC_CACHE],
      ["file", PUBLIC_CACHE],
      ["file", PUBLIC_CACHE],
    ]);
    expect(await views(ada.id, ben.id)).toEqual([true, true, true]);
  });

  test("AUTOMATION_R1_ACTS on: a moderator who answers the finding with reset_avatar removes the reviewed picture: detached, shown to nobody", async () => {
    const ada = await pictured(0.8);
    await setThen(depsWith({ AUTOMATION_R1_ACTS: "on" }), ada.id, ada.avatar);
    const found = await finding(ada.avatar);
    expect(await stateOf(ada.avatar)).toEqual({ state: "withheld", profile_id: ada.id });
    const outcome = await world.decideAs(mod, found!.case_id!, { kind: "final", ruleId: "R1", actions: [act("reset_avatar")] });
    expect(typeof outcome).not.toBe("string");
    expect(await stateOf(ada.avatar)).toEqual({ state: "visible", profile_id: null });
    expect((await served(ada.avatar, ada.id, ada.id)).map(([kind]) => kind)).toEqual(["not_found", "not_found", "not_found"]);
  });

  test("AUTOMATION_R1_ACTS off: the same finding, no review and no measure; the picture is shown throughout", async () => {
    const [ada, ben] = [await pictured(0.9), await pictured(null)];
    await setThen(depsWith({ AUTOMATION_R1_ACTS: "off" }), ada.id, ada.avatar);
    expect(await finding(ada.avatar)).toMatchObject({ kind: "r1_score", handled: "finding", decision_id: null, target_type: "account", target_id: ada.id, rule_id: "R1", decisions: 0 });
    expect(await reviewOf(ada.avatar)).toEqual([]);
    expect(await stateOf(ada.avatar)).toEqual({ state: "visible", profile_id: ada.id });
    expect(await served(ada.avatar, ada.id, ben.id)).toEqual([
      ["file", PUBLIC_CACHE],
      ["file", PUBLIC_CACHE],
      ["file", PUBLIC_CACHE],
    ]);
  });

  test("a score under the threshold, and the scorer off, open nothing", async () => {
    const [low, off] = [await pictured(0.2), await pictured(0.9)];
    await setThen(depsWith({ AUTOMATION_R1_ACTS: "on" }), low.id, low.avatar);
    await setThen(depsWith({ R1_CLASSIFIER: "off", AUTOMATION_R1_ACTS: "on" }), off.id, off.avatar);
    expect(await finding(low.avatar)).toBeNull();
    expect(await finding(off.avatar)).toBeNull();
  });

  test("a flagging match opens the finding on the account's case the same way, citing no rule, with no measure and no review", async () => {
    const ada = await pictured(null);
    await matchForTest(apiDb, ada.avatar, "other");
    await setThen(depsWith({ MEDIA_MATCH: "test", AUTOMATION_R1_ACTS: "on", AUTOMATION_R2_ACTS: "on" }), ada.id, ada.avatar);
    expect(await finding(ada.avatar)).toMatchObject({ kind: "known_match", handled: "finding", decision_id: null, target_type: "account", target_id: ada.id, intake_kind: "automated", rule_id: null, decisions: 0 });
    expect(await reviewOf(ada.avatar)).toEqual([]);
    expect(await stateOf(ada.avatar)).toEqual({ state: "visible", profile_id: ada.id });
  });

  test("an acting match refuses the upload and holds it: the picture cannot be set (avatar_not_ready)", async () => {
    const owner = await newProfile(apiDb, { createdAt: new Date(Date.now() - 3 * DAY_MS) });
    accounts.push(owner.id);
    const avatar = await h.readyAvatar(owner.id);
    media.push(avatar);
    // The refusal as the matcher's acting match writes it at upload (3d's upload_refusals; its trigger holds the row).
    const matchId = await matchForTest(apiDb, avatar, "acting");
    await apiDb.execute(sql`insert into upload_refusals (media_id, owner_id, match_id, refused_at) values (${avatar}::uuid, ${owner.id}::uuid, ${matchId}::uuid, now())`);
    const refused = await apiDb.transaction((tx) => h.deps.repo.attachAvatar(tx, owner.id, avatar)).then(
      () => null,
      (err: unknown) => (err instanceof MediaError ? err.code : String(err)),
    );
    expect(refused).toBe("avatar_not_ready");
    expect((await stateOf(avatar)).profile_id).toBeNull();
  });

  leavesNoModerationRows(() => apiDb);
});
