import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APPEARANCE_KEY, readAppearance, setAppearance } from "../src/lib/appearance";
import {
  clearPlaces,
  createPlaceKeeper,
  newer,
  openingRow,
  PLACE_PREFIX,
  PLACE_SAVE_MS,
  PLACE_WINDOW,
  placeKey,
  placesStored,
  readPlace,
  writePlace,
  type Place,
  type PlaceRow,
} from "../src/lib/reading-place";
import { clearSessionTraces, sessionEnded } from "../src/lib/session-end";

/**
 * Where the reader stopped in Following and Latest (UI design, decisions 8 and 9, sections 8.2 and 8.8; Task 5): kept in
 * this browser under korbat.place.<accountId>, per feed, as the newest post the reader has seen and the post at the top
 * of the list, written one second after scrolling stops and when the page is hidden; a feed opens there when that post
 * is among its newest 100, unless the reader chose to open at the newest; nothing is kept for a reader who is signed
 * out; and the session's end clears every place with the appearance.
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
  delete globals.localStorage;
});

const ADA = "00000000-0000-4000-8000-000000000001";
const GRACE = "00000000-0000-4000-8000-000000000002";
/** Row n of a feed, n minutes after nine: a higher number is newer. */
const row = (n: number): PlaceRow => ({ key: `post-${n}`, time: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString() });
const place = (top: number, newest: number, savedAt = 1000): Place => ({ top: row(top), newest: row(newest), savedAt });

describe("the stored place", () => {
  test("is kept per account under korbat.place.<accountId>, per feed, and read back", () => {
    expect(PLACE_PREFIX).toBe("korbat.place.");
    expect(placeKey(ADA)).toBe(`korbat.place.${ADA}`);
    writePlace(ADA, "latest", place(40, 12));
    writePlace(ADA, "following", place(3, 3));
    expect(readPlace(ADA, "latest")).toEqual(place(40, 12));
    expect(readPlace(ADA, "following")).toEqual(place(3, 3));
    expect(JSON.parse(storage.items.get(`korbat.place.${ADA}`)!)).toEqual({ latest: place(40, 12), following: place(3, 3) });
    // Another account on the same browser has none of Ada's.
    expect(readPlace(GRACE, "latest")).toBeNull();
  });

  test("a damaged record, or one of the wrong shape, is no place at all", () => {
    storage.items.set(`korbat.place.${ADA}`, "{not json");
    expect(readPlace(ADA, "latest")).toBeNull();
    storage.items.set(`korbat.place.${ADA}`, JSON.stringify({ latest: { top: { key: 4 }, newest: row(2), savedAt: 1 } }));
    expect(readPlace(ADA, "latest")).toBeNull();
    // Writing again replaces it.
    writePlace(ADA, "latest", place(5, 2));
    expect(readPlace(ADA, "latest")).toEqual(place(5, 2));
  });

  test("a browser that refuses storage keeps nothing and breaks nothing", () => {
    globals.localStorage = {
      getItem: () => {
        throw new Error("The operation is insecure.");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writePlace(ADA, "latest", place(5, 2))).not.toThrow();
    expect(readPlace(ADA, "latest")).toBeNull();
    expect(placesStored()).toBe(false);
  });

  test("the newer of two rows is the later one, and nothing is newer than something", () => {
    expect(newer(row(3), row(5))).toEqual(row(5));
    expect(newer(row(7), row(5))).toEqual(row(7));
    expect(newer(null, row(5))).toEqual(row(5));
    expect(newer(row(5), null)).toEqual(row(5));
  });
});

describe("where a feed opens (decision 9)", () => {
  // The first page and the second, newest first: post 199 down to post 0.
  const rows = Array.from({ length: 200 }, (_, i) => row(199 - i));

  test("at the stored top when it is among the newest 100, two pages of 50", () => {
    expect(PLACE_WINDOW).toBe(100);
    expect(openingRow(rows, place(150, 160), false)).toBe("post-150");
    // The 100th row is the last one in the window.
    expect(openingRow(rows, place(100, 120), false)).toBe("post-100");
  });

  test("else at the newest post: further down, gone, nothing stored, or the reader asks for the newest", () => {
    expect(openingRow(rows, place(99, 120), false)).toBeNull();
    expect(openingRow(rows, place(500, 520), false)).toBeNull();
    expect(openingRow(rows, null, false)).toBeNull();
    expect(openingRow(rows, place(150, 160), true)).toBeNull();
    // The newest post itself is the newest: nothing to move to.
    expect(openingRow(rows, place(199, 199), false)).toBeNull();
  });
});

describe("keeping the place while the reader reads", () => {
  test("the newest seen only ever moves to newer posts; the top follows the list", () => {
    const keeper = createPlaceKeeper(ADA, "latest", place(30, 40));
    expect(keeper.newest()).toEqual(row(40));
    keeper.seen([row(35), row(38)]);
    expect(keeper.newest()).toEqual(row(40));
    keeper.seen([row(44), row(41)]);
    expect(keeper.newest()).toEqual(row(44));
    keeper.top(row(36));
    keeper.hidden();
    expect(readPlace(ADA, "latest")).toMatchObject({ top: row(36), newest: row(44) });
    keeper.dispose();
  });

  test("written one second after scrolling stops, not on every scroll", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 12));
    const keeper = createPlaceKeeper(ADA, "following", null);
    keeper.seen([row(9)]);
    keeper.top(row(7));
    keeper.scrolled();
    vi.advanceTimersByTime(PLACE_SAVE_MS - 100);
    keeper.top(row(6));
    keeper.scrolled();
    vi.advanceTimersByTime(PLACE_SAVE_MS - 100);
    expect(readPlace(ADA, "following")).toBeNull();
    vi.advanceTimersByTime(100);
    expect(readPlace(ADA, "following")).toEqual({ top: row(6), newest: row(9), savedAt: Date.UTC(2026, 9, 21, 12) + 2 * PLACE_SAVE_MS - 100 });
    expect(PLACE_SAVE_MS).toBe(1000);
    keeper.dispose();
  });

  test("written at once when the page is hidden, and not before both rows are known", () => {
    const keeper = createPlaceKeeper(ADA, "latest", null);
    keeper.hidden();
    expect(readPlace(ADA, "latest")).toBeNull();
    keeper.top(row(4));
    keeper.hidden();
    // The top row has been seen: it is the newest when nothing newer was.
    expect(readPlace(ADA, "latest")).toMatchObject({ top: row(4), newest: row(4) });
    keeper.dispose();
  });

  test("nothing is kept for a reader who is signed out", () => {
    vi.useFakeTimers();
    const keeper = createPlaceKeeper(null, "latest", null);
    keeper.seen([row(9)]);
    keeper.top(row(8));
    keeper.scrolled();
    keeper.hidden();
    vi.advanceTimersByTime(5000);
    expect(storage.items.size).toBe(0);
    expect(keeper.newest()).toBeNull();
    keeper.dispose();
  });
});

describe("cleared when the session ends (section 8.8)", () => {
  test("clearPlaces removes every account's place, and only places", () => {
    writePlace(ADA, "latest", place(5, 2));
    writePlace(GRACE, "following", place(5, 2));
    storage.items.set("korbat.device", "kept");
    expect(placesStored()).toBe(true);
    clearPlaces();
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
    expect(placesStored()).toBe(false);
  });

  test("a move from signed in to signed out ends it; so does a first answer of signed out while a place is stored", () => {
    expect(sessionEnded("signed-in", "signed-out", false)).toBe(true);
    expect(sessionEnded("loading", "signed-out", true)).toBe(true);
    // A visitor who never signed in on this browser keeps their appearance.
    expect(sessionEnded("loading", "signed-out", false)).toBe(false);
    expect(sessionEnded("loading", "signed-in", true)).toBe(false);
    expect(sessionEnded("signed-in", "signed-in", true)).toBe(false);
    expect(sessionEnded("signed-out", "signed-out", true)).toBe(false);
  });

  test("its end clears the appearance and every place, and leaves the device's own keys", () => {
    setAppearance({ theme: "dim" });
    writePlace(ADA, "latest", place(5, 2));
    storage.items.set("korbat.device", "kept");
    clearSessionTraces();
    expect(storage.items.has(APPEARANCE_KEY)).toBe(false);
    expect(readAppearance().theme).toBe("system");
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
  });

  test("the provider decides with sessionEnded on every change of its state, and clears through the stores' own functions", () => {
    const session = readFileSync(path.join(SRC, "lib", "session.tsx"), "utf8");
    expect(session).toContain("if (sessionEnded(previous.current, state.status, placesStored())) clearSessionTraces();");
    const end = readFileSync(path.join(SRC, "lib", "session-end.ts"), "utf8");
    expect(end).toContain("clearAppearance();");
    expect(end).toContain("clearPlaces();");
    // reading-place.ts is the only module that touches the places' keys.
    expect(session + end).not.toContain("korbat.place");
  });
});
