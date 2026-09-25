import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { ProfileView } from "@korbat/contracts";
import { closeDb, createDb, handleHistory, profiles, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createProfileStore } from "../../src/profiles/store";
import { createPost, getPost } from "../../src/social/flows/posts";
import { HANDLE_COOLDOWN_MS, changeHandle, editProfile } from "../../src/social/flows/profile-edit";
import { profile } from "../../src/social/flows/profiles";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `h_${randomBytes(5).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** The profile the history reserves a handle for, or null when the handle was never left behind. */
  const reservedBy = async (handle: string) =>
    (await db.select({ profileId: handleHistory.profileId }).from(handleHistory).where(eq(handleHistory.handleLower, handle.toLowerCase())))[0]?.profileId ?? null;

  test("an edit is stored, shown to everyone through the profile flow, and recorded as an event", async () => {
    const ada = await h.established();
    const view = await editProfile(h.deps, ada.id, { displayName: "Ada Lovelace", bio: "Analytical engines." });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(view.viewer).toBeUndefined();
    expect(await profile(h.deps, null, ada.handle)).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    expect((await editProfile(h.deps, ada.id, { bio: "" })).bio).toBe("");
    expect(h.events.filter((e) => e.userId === ada.id)).toEqual([
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
    ]);
  });

  test("changing the handle reserves the old one, stamps the change, and existing posts show the new handle at once", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    h.clock.next();
    const root = await createPost(h.deps, ada.id, { body: "by ada", media: [] });
    h.clock.next();
    const reply = await createPost(h.deps, bob.id, { body: "to ada", media: [], replyToId: root.id });
    const to = newHandle();
    const view = await changeHandle(h.deps, ada.id, { handle: to.toUpperCase() });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: to, counts: { posts: 1, followers: 0, following: 0 } });
    expect(view.viewer).toBeUndefined();
    const row = (await h.repo.findProfileById(ada.id))!;
    expect(row.handle).toBe(to);
    expect(row.handleChangedAt).not.toBeNull();
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    expect((await getPost(h.deps, null, root.id)).author.handle).toBe(to);
    expect((await getPost(h.deps, null, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: to });
    expect(await rejection(profile(h.deps, null, ada.handle))).toBe("not_found");
    expect((await profile(h.deps, bob.id, to)).id).toBe(ada.id);
    expect(h.events).toContainEqual({ userId: ada.id, type: "handle_changed", metadata: { from: ada.handle, to } });
    // What /me reads from the profile store follows the change too.
    expect(await createProfileStore(db).find(ada.id)).toEqual({ id: ada.id, handle: to, displayName: `Profile ${ada.handle}`, handleChangedAt: row.handleChangedAt!.toISOString(), verified: false });
  });

  test("a handle another profile holds, in any case, or ever held is handle_taken; the profile itself may go back after the cooldown", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const to = newHandle();
    await changeHandle(h.deps, ada.id, { handle: to });
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: to.toUpperCase() }))).toBe("handle_taken");
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: ada.handle }))).toBe("handle_taken");
    expect((await h.repo.findProfileById(bob.id))!.handle).toBe(bob.handle);
    expect(await rejection(changeHandle(h.deps, ada.id, { handle: ada.handle }))).toBe("handle_cooldown");
    h.clock.jump(HANDLE_COOLDOWN_MS);
    expect((await changeHandle(h.deps, ada.id, { handle: ada.handle })).handle).toBe(ada.handle);
    expect(await reservedBy(to)).toBe(ada.id);
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: to }))).toBe("handle_taken");
  });

  test("two accounts racing for the same free handle: exactly one wins and the other is handle_taken", async () => {
    for (let i = 0; i < 6; i++) {
      const [ada, bob] = await Promise.all([h.established(), h.established()]);
      const to = newHandle();
      const outcomes = await Promise.allSettled([changeHandle(h.deps, ada.id, { handle: to }), changeHandle(h.deps, bob.id, { handle: to })]);
      const won = outcomes.filter((o): o is PromiseFulfilledResult<ProfileView> => o.status === "fulfilled");
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0]!.reason as { code: string }).code).toBe("handle_taken");
      const holders = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.handle, to));
      expect(holders.map((r) => r.id)).toEqual([won[0]!.value.id]);
    }
  });

  test("two changes by the same account in flight leave every handle it held in the history", async () => {
    const ada = await h.established();
    const [x, y] = [newHandle(), newHandle()];
    const outcomes = await Promise.allSettled([changeHandle(h.deps, ada.id, { handle: x }), changeHandle(h.deps, ada.id, { handle: y })]);
    // The later one may have read the earlier one's stamp and stopped at the cooldown; otherwise both ran, one after the other, on the locked row.
    const done = outcomes.filter((o): o is PromiseFulfilledResult<ProfileView> => o.status === "fulfilled").map((o) => o.value.handle);
    for (const o of outcomes) if (o.status === "rejected") expect((o.reason as { code: string }).code).toBe("handle_cooldown");
    expect(done.length).toBeGreaterThanOrEqual(1);
    const final = (await h.repo.findProfileById(ada.id))!.handle;
    expect(done).toContain(final);
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    for (const handle of done) if (handle !== final) expect(await reservedBy(handle)).toBe(ada.id);
  });

  test("onboarding writes the handle into the history in the profile's transaction and refuses a handle another profile ever had", async () => {
    const store = createProfileStore(db);
    const ada = await h.established();
    await changeHandle(h.deps, ada.id, { handle: newHandle() });
    const id = randomUUID();
    const handle = newHandle();
    expect(await store.create({ id, handle, displayName: "New" })).toEqual({ ok: true, profile: { id, handle, displayName: "New" } });
    expect(await reservedBy(handle)).toBe(id);
    for (const taken of [ada.handle, ada.handle.toUpperCase(), handle.toUpperCase()]) {
      const late = randomUUID();
      expect(await store.create({ id: late, handle: taken, displayName: "Late" }), taken).toEqual({ ok: false, reason: "handle_taken" });
      expect(await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, late)), taken).toEqual([]);
    }
  });
});
