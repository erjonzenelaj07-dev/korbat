import { describe, expect, test } from "vitest";
import { ProfileView } from "@korbat/contracts";
import { SocialError } from "../../src/social/context";
import { HANDLE_COOLDOWN_MS, PROFILE_EDITS_PER_HOUR, changeHandle, editProfile } from "../../src/social/flows/profile-edit";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { profileHarness } from "./profile-harness";

const nobody = "00000000-0000-4000-8000-000000000009";

/** The SocialError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<SocialError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SocialError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

describe("profile editing", () => {
  test("updates the display name, the bio or both, records profile_updated without content, and returns the owner's view", async () => {
    const h = profileHarness();
    const ada = h.profile("ada");
    const named = await editProfile(h.deps, ada.id, { displayName: "Ada Lovelace" });
    expect(ProfileView.parse(named)).toMatchObject({ id: ada.id, handle: "ada", displayName: "Ada Lovelace", bio: "", verified: false, counts: { posts: 0, followers: 0, following: 0 } });
    expect(named.viewer).toBeUndefined();
    expect((await editProfile(h.deps, ada.id, { bio: "Analytical engines." })).bio).toBe("Analytical engines.");
    const both = await editProfile(h.deps, ada.id, { displayName: "Ada", bio: "" });
    expect([both.displayName, both.bio]).toEqual(["Ada", ""]);
    const stored = (await h.deps.repo.findProfileById(ada.id))!;
    expect([stored.displayName, stored.bio, stored.handle]).toEqual(["Ada", "", "ada"]);
    expect(h.events).toEqual([
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
    ]);
  });

  test("allows 10 edits an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = profileHarness();
    const ada = h.profile("ada");
    const bob = h.profile("bob");
    for (let i = 0; i < PROFILE_EDITS_PER_HOUR; i++) await editProfile(h.deps, ada.id, { bio: `edit ${i}` });
    const err = await failure(editProfile(h.deps, ada.id, { bio: "one too many" }));
    expect(err).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR_MS / 1000 });
    expect((await h.deps.repo.findProfileById(ada.id))!.bio).toBe("edit 9");
    expect((await editProfile(h.deps, bob.id, { bio: "bob's own window" })).bio).toBe("bob's own window");
    h.advance(HOUR_MS + 1);
    expect((await editProfile(h.deps, ada.id, { bio: "next hour" })).bio).toBe("next hour");
    expect(h.events.filter((e) => e.userId === ada.id)).toHaveLength(PROFILE_EDITS_PER_HOUR + 1);
  });

  test("an edit with nothing in it is invalid_request, an unknown profile is not_found, and neither is recorded", async () => {
    const h = profileHarness();
    expect(await failure(editProfile(h.deps, h.profile("ada").id, {}))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(editProfile(h.deps, nobody, { bio: "x" }))).toMatchObject({ code: "not_found", status: 404 });
    expect(h.events).toEqual([]);
  });

  test("works without an events dependency, as the 2a tests run the module", async () => {
    const h = profileHarness();
    const ada = h.profile("ada");
    delete h.deps.events;
    expect((await editProfile(h.deps, ada.id, { bio: "quiet" })).bio).toBe("quiet");
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_two" })).handle).toBe("ada_two");
  });
});

describe("handle change", () => {
  test("lowercases the handle, checks its format and the reserved list, and refuses the current one", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ab" }))).toMatchObject({ code: "handle_invalid", status: 400 });
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "no-dashes" }))).toMatchObject({ code: "handle_invalid", status: 400 });
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "Admin" }))).toMatchObject({ code: "handle_reserved", status: 400 });
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ADA_L" }))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(changeHandle(h.deps, nobody, { handle: "ghost" }))).toMatchObject({ code: "not_found", status: 404 });
    const stored = (await h.deps.repo.findProfileById(ada.id))!;
    expect([stored.handle, stored.handleChangedAt]).toEqual(["ada_l", null]);
    expect(h.events).toEqual([]);
  });

  test("moves the old handle into the history, stamps the change, records handle_changed with from and to, and returns the view", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    const view = await changeHandle(h.deps, ada.id, { handle: "Ada_Lovelace" });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: "ada_lovelace", displayName: "Profile ada_l" });
    expect(view.viewer).toBeUndefined();
    const stored = (await h.deps.repo.findProfileById(ada.id))!;
    expect(stored.handle).toBe("ada_lovelace");
    expect(stored.handleChangedAt).toEqual(h.now());
    expect(h.history.get("ada_l")).toBe(ada.id);
    expect(h.events).toEqual([{ userId: ada.id, type: "handle_changed", metadata: { from: "ada_l", to: "ada_lovelace" } }]);
  });

  test("a handle another profile holds, in any case, or ever held is handle_taken; the profile itself may go back to its own", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    const bob = h.profile("bob_b");
    await changeHandle(h.deps, ada.id, { handle: "ada_lovelace" });
    expect(await failure(changeHandle(h.deps, bob.id, { handle: "ADA_LOVELACE" }))).toMatchObject({ code: "handle_taken", status: 409 });
    expect(await failure(changeHandle(h.deps, bob.id, { handle: "ada_l" }))).toMatchObject({ code: "handle_taken", status: 409 });
    expect((await h.deps.repo.findProfileById(bob.id))!.handle).toBe("bob_b");
    h.advance(HANDLE_COOLDOWN_MS);
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_l" })).handle).toBe("ada_l");
    expect(h.history.get("ada_lovelace")).toBe(ada.id);
    expect(h.history.get("ada_l")).toBe(ada.id);
    expect(h.events.map((e) => e.metadata)).toEqual([
      { from: "ada_l", to: "ada_lovelace" },
      { from: "ada_lovelace", to: "ada_l" },
    ]);
  });

  test("waits 30 days between changes, answering handle_cooldown with the seconds left as Retry-After", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    await changeHandle(h.deps, ada.id, { handle: "ada_two" });
    const atOnce = await failure(changeHandle(h.deps, ada.id, { handle: "ada_three" }));
    expect(atOnce).toMatchObject({ code: "handle_cooldown", status: 429, retryAfterSeconds: HANDLE_COOLDOWN_MS / 1000 });
    h.advance(10 * DAY_MS);
    expect((await failure(changeHandle(h.deps, ada.id, { handle: "ada_three" }))).retryAfterSeconds).toBe((20 * DAY_MS) / 1000);
    h.advance(20 * DAY_MS - 500);
    expect((await failure(changeHandle(h.deps, ada.id, { handle: "ada_three" }))).retryAfterSeconds).toBe(1);
    h.advance(500);
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_three" })).handle).toBe("ada_three");
    expect((await h.deps.repo.findProfileById(ada.id))!.handleChangedAt).toEqual(h.now());
    expect(h.events.map((e) => e.metadata)).toEqual([
      { from: "ada_l", to: "ada_two" },
      { from: "ada_two", to: "ada_three" },
    ]);
  });

  test("3e: a retired handle is handle_retired (409) for its former holder and for anyone else; a handle with the placeholder prefix is handle_reserved (400)", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    const bob = h.profile("bob_b");
    await changeHandle(h.deps, ada.id, { handle: "ada_two" });
    h.retired.add("ada_l");
    h.advance(HANDLE_COOLDOWN_MS);
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ada_l" }))).toMatchObject({ code: "handle_retired", status: 409, message: "That handle was retired by korbat. Nobody can use it." });
    expect(await failure(changeHandle(h.deps, bob.id, { handle: "ADA_L" }))).toMatchObject({ code: "handle_retired", status: 409 });
    for (const handle of ["retired_0a1b2c3d4e5f", "retired_bob"]) expect(await failure(changeHandle(h.deps, bob.id, { handle })), handle).toMatchObject({ code: "handle_reserved", status: 400 });
    expect((await h.deps.repo.findProfileById(bob.id))!.handle).toBe("bob_b");
    expect(h.events.map((e) => e.metadata)).toEqual([{ from: "ada_l", to: "ada_two" }]);
  });

  test("3e: the guard of handles refusing under a race answers with its code, as the claim statement would", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    for (const reason of ["handle_retired", "handle_reserved"] as const) {
      const real = h.deps.repo.changeHandle;
      h.deps.repo.changeHandle = async () => ({ ok: false, reason });
      expect(await failure(changeHandle(h.deps, ada.id, { handle: "ada_new" })), reason).toMatchObject({ code: reason, status: reason === "handle_retired" ? 409 : 400 });
      h.deps.repo.changeHandle = real;
    }
    expect(h.events).toEqual([]);
  });

  test("3e: after a retirement swapped the handle for the placeholder and cleared the change time, the first change has no wait", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    await changeHandle(h.deps, ada.id, { handle: "ada_two" });
    // Minutes after a change, a retirement swaps the handle for the placeholder and clears the change time.
    h.retire(ada.id, "retired_0a1b2c3d4e5f");
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_three" })).handle).toBe("ada_three");
    // The ordinary wait applies again from that change on.
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ada_four" }))).toMatchObject({ code: "handle_cooldown" });
    // The retired handle stays refused to its former holder.
    h.advance(HANDLE_COOLDOWN_MS);
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ada_two" }))).toMatchObject({ code: "handle_retired" });
  });
});
