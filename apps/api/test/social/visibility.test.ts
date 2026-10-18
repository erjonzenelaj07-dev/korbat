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
  test("a post disabled for an authority's order is hidden from everyone, its author included (3f)", () => {
    for (const viewer of [null, other, author]) expect(postAccess(viewer, post("disabled"), false), String(viewer)).toBe("hidden");
    // Answered as a post that does not exist: the tombstone says nothing of why.
    expect(tombstone("x", "hidden")).toEqual({ id: "x", unavailable: true });
  });
  test("the reader decides every state the database stores", () => {
    // The five states above are all of post_state: a seal is a state of images, and 3f's disabled hides a post from all.
    expect([...postState.enumValues].sort()).toEqual(["deleted_by_author", "disabled", "removed", "visible", "withheld"]);
  });
  test("a state the reader does not know is hidden from everyone, its author included", () => {
    // What a value added to the database's enum would be for code that was not told about it: never shown.
    const unknown = { authorId: author, state: "sealed" as StoredPostState };
    for (const viewer of [null, other, author]) expect(postAccess(viewer, unknown, false), String(viewer)).toBe("hidden");
  });
});
