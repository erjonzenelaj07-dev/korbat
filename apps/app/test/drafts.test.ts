import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearDrafts, createDraftKeeper, DRAFT_PREFIX, DRAFT_SAVE_MS, draftContext, draftKey, draftsStored, readDraft, removeDraft, writeDraft } from "../src/lib/drafts";
import { writePlace } from "../src/lib/reading-place";
import { clearSessionTraces, sessionEnded, tracesStored } from "../src/lib/session-end";
import { sourceFiles } from "./legacy-files";

/**
 * Drafts on the device (UI design, decision 18, sections 6.15 and 8.8; Task 6): the composer keeps its text, never its
 * images, in this browser's storage under korbat.drafts.<accountId>, one entry per context (a new post, a reply to a
 * post, a quote of a post), written 500 ms after typing stops, removed when the post is sent or the draft discarded,
 * kept in memory where there is no browser storage (native until sub-project 5), and every one of them, whatever the
 * account, removed when the session ends.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** localStorage as far as the stores use it, keys in the order they were set. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const globals = globalThis as { localStorage?: unknown };
let storage = fakeStorage();

beforeEach(() => {
  storage = fakeStorage();
  globals.localStorage = storage;
});

afterEach(() => {
  vi.useRealTimers();
  clearDrafts();
  delete globals.localStorage;
});

const ADA = "00000000-0000-4000-8000-000000000001";
const GRACE = "00000000-0000-4000-8000-000000000002";
const POST = "00000000-0000-4000-8000-000000000101";

describe("the store", () => {
  test("one key per account, one entry per context: a new post, a reply to a post, a quote of a post", () => {
    expect(DRAFT_PREFIX).toBe("korbat.drafts.");
    expect(draftKey(ADA)).toBe(`korbat.drafts.${ADA}`);
    expect(draftContext()).toBe("post");
    expect(draftContext(POST)).toBe(`reply:${POST}`);
    expect(draftContext(undefined, POST)).toBe(`quote:${POST}`);
    writeDraft(ADA, "post", "Morning light");
    writeDraft(ADA, `reply:${POST}`, "Lovely");
    writeDraft(GRACE, "post", "Compilers");
    expect(readDraft(ADA, "post")).toBe("Morning light");
    expect(readDraft(ADA, `reply:${POST}`)).toBe("Lovely");
    expect(readDraft(ADA, `quote:${POST}`)).toBe("");
    expect(readDraft(GRACE, "post")).toBe("Compilers");
    expect(JSON.parse(storage.items.get(draftKey(ADA))!)).toEqual({ post: "Morning light", [`reply:${POST}`]: "Lovely" });
  });

  test("a blank draft is no draft, and removing the last one removes the account's key", () => {
    writeDraft(ADA, "post", "Morning light");
    writeDraft(ADA, "post", "   ");
    expect(storage.items.has(draftKey(ADA))).toBe(false);
    writeDraft(ADA, "post", "Morning light");
    writeDraft(ADA, `quote:${POST}`, "Look");
    removeDraft(ADA, "post");
    expect(readDraft(ADA, "post")).toBe("");
    expect(readDraft(ADA, `quote:${POST}`)).toBe("Look");
    removeDraft(ADA, `quote:${POST}`);
    expect([...storage.items.keys()]).toEqual([]);
  });

  test("a damaged record reads as no draft, and storage that throws loses nothing but the draft", () => {
    storage.items.set(draftKey(ADA), "{not json");
    expect(readDraft(ADA, "post")).toBe("");
    storage.items.set(draftKey(ADA), JSON.stringify({ post: 7 }));
    expect(readDraft(ADA, "post")).toBe("");
    globals.localStorage = {
      get length() {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeDraft(ADA, "post", "x")).not.toThrow();
    expect(() => readDraft(ADA, "post")).not.toThrow();
    expect(() => clearDrafts()).not.toThrow();
  });

  test("without browser storage (native until sub-project 5) drafts live in memory for the session", () => {
    delete globals.localStorage;
    writeDraft(ADA, "post", "In memory");
    expect(readDraft(ADA, "post")).toBe("In memory");
    expect(draftsStored()).toBe(true);
    clearDrafts();
    expect(readDraft(ADA, "post")).toBe("");
    expect(draftsStored()).toBe(false);
  });
});

describe("the keeper of one composer", () => {
  test("written 500 ms after typing stops, not before, and only the last words", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(ADA, "post");
    keeper.typed("Mor");
    vi.advanceTimersByTime(300);
    keeper.typed("Morning");
    vi.advanceTimersByTime(DRAFT_SAVE_MS - 1);
    expect(readDraft(ADA, "post")).toBe("");
    vi.advanceTimersByTime(1);
    expect(DRAFT_SAVE_MS).toBe(500);
    expect(readDraft(ADA, "post")).toBe("Morning");
    keeper.dispose();
  });

  test("leaving writes what is waiting at once", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(ADA, `reply:${POST}`);
    keeper.typed("Lovely");
    keeper.dispose();
    expect(readDraft(ADA, `reply:${POST}`)).toBe("Lovely");
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    expect(readDraft(ADA, `reply:${POST}`)).toBe("Lovely");
  });

  test("sent: the draft is removed, and a write still waiting never lands", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(ADA, "post");
    keeper.typed("Morning");
    vi.advanceTimersByTime(DRAFT_SAVE_MS);
    keeper.typed("Morning light");
    keeper.sent();
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    keeper.dispose();
    expect(readDraft(ADA, "post")).toBe("");
    expect(storage.items.has(draftKey(ADA))).toBe(false);
  });

  test("discarded: the same", () => {
    vi.useFakeTimers();
    writeDraft(ADA, `quote:${POST}`, "Look at this");
    const keeper = createDraftKeeper(ADA, `quote:${POST}`);
    keeper.typed("Look at this one");
    keeper.discarded();
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    keeper.dispose();
    expect(readDraft(ADA, `quote:${POST}`)).toBe("");
  });

  test("a reader who is signed out keeps no draft", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(null, "post");
    keeper.typed("Anonymous words");
    vi.advanceTimersByTime(DRAFT_SAVE_MS);
    keeper.dispose();
    expect([...storage.items.keys()]).toEqual([]);
  });
});

describe("the session's end (section 8.8)", () => {
  test("clears every draft, whatever the account, and leaves the device's own keys", () => {
    writeDraft(ADA, "post", "Morning light");
    writeDraft(GRACE, `reply:${POST}`, "Compilers");
    storage.items.set("korbat.device", "kept");
    expect(draftsStored()).toBe(true);
    clearSessionTraces();
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
    expect(draftsStored()).toBe(false);
  });

  test("a draft kept here, like a place, makes the first signed-out answer the end of a session", () => {
    expect(tracesStored()).toBe(false);
    writeDraft(ADA, "post", "Morning light");
    expect(tracesStored()).toBe(true);
    expect(sessionEnded("loading", "signed-out", tracesStored())).toBe(true);
    clearDrafts();
    writePlace(ADA, "latest", { newest: { key: POST, time: "2026-10-21T10:00:00.000Z" }, top: { key: POST, time: "2026-10-21T10:00:00.000Z" }, savedAt: 1 });
    expect(tracesStored()).toBe(true);
    clearSessionTraces();
    expect(tracesStored()).toBe(false);
  });

  test("drafts.ts is the only module that touches the drafts' keys, and the composer reaches them through it", () => {
    const owners = sourceFiles().filter((file) => file.text.includes("korbat.drafts"));
    expect(owners.map((file) => file.name)).toEqual(["lib/drafts.ts"]);
    const composer = readFileSync(path.join(SRC, "components", "social", "Composer.tsx"), "utf8");
    expect(composer).toContain('from "@/lib/drafts"');
    expect(composer).not.toMatch(/localStorage/);
  });
});

