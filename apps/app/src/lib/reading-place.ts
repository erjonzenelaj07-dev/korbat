import type { FeedName } from "./feed-rows";

/**
 * Where the reader stopped in Following and Latest (UI design, decisions 8 and 9, section 8.2), kept on this device only:
 * in this browser's storage under korbat.place.<accountId>, one record per account holding each feed's place, and in
 * memory nowhere else. A place is the newest post the reader has seen (at least half in view for half a second; the
 * list's viewability reports it) and the post at the top of the list, each as its row key and time, written one second
 * after scrolling stops and at once when the page is hidden. This is the only module in src that touches those keys
 * (explore.test.tsx holds the app's stores to a list); the session's end clears every one of them through clearPlaces()
 * (lib/session.tsx), and so will the Appearance page's "Clear what this device keeps" (Task 8). A reader who is signed
 * out has no place: nothing is read or written for them.
 */

export const PLACE_PREFIX = "korbat.place.";

/** A feed opens at its stored top when that post is among its newest 100 rows: two pages of 50 (decision 9). */
export const PLACE_WINDOW = 100;

/** How long after the last scroll the place is written. */
export const PLACE_SAVE_MS = 1000;

/** One row of a feed as the place keeps it: its key and when it entered the feed. */
export interface PlaceRow {
  key: string;
  time: string;
}

export interface Place {
  newest: PlaceRow;
  top: PlaceRow;
  savedAt: number;
}

type Places = Partial<Record<FeedName, Place>>;

/** Browser storage, typed locally as lib/appearance.ts types it; every access is guarded, since a private window or blocked storage throws. */
interface Store {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's storage, or null where there is none (native) or the browser refuses it. */
function store(): Store | null {
  try {
    return (globalThis as unknown as { localStorage?: Store }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function placeKey(accountId: string): string {
  return `${PLACE_PREFIX}${accountId}`;
}

const isRow = (value: unknown): value is PlaceRow =>
  typeof value === "object" && value !== null && typeof (value as PlaceRow).key === "string" && typeof (value as PlaceRow).time === "string" && !Number.isNaN(Date.parse((value as PlaceRow).time));

const isPlace = (value: unknown): value is Place =>
  typeof value === "object" && value !== null && isRow((value as Place).newest) && isRow((value as Place).top) && typeof (value as Place).savedAt === "number";

/** Every feed's place an account has here; a damaged record is none. */
function readPlaces(accountId: string): Places {
  try {
    const raw = store()?.getItem(placeKey(accountId));
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Places) : {};
  } catch {
    return {};
  }
}

export function readPlace(accountId: string, feed: FeedName): Place | null {
  const place = readPlaces(accountId)[feed];
  return isPlace(place) ? place : null;
}

export function writePlace(accountId: string, feed: FeedName, place: Place): void {
  try {
    store()?.setItem(placeKey(accountId), JSON.stringify({ ...readPlaces(accountId), [feed]: place }));
  } catch {
    // A browser that refuses storage keeps no place: the feed opens at its newest post next time.
  }
}

/** The keys of every place kept in this browser, whatever the account. */
function placeKeys(): string[] {
  const kept: string[] = [];
  try {
    const browser = store();
    if (!browser) return kept;
    for (let index = 0; index < browser.length; index++) {
      const key = browser.key(index);
      if (key?.startsWith(PLACE_PREFIX)) kept.push(key);
    }
  } catch {
    // Storage that cannot be read holds nothing this app can see.
  }
  return kept;
}

/** Whether any account's place is kept here: the session's first 401 then means a session that ended while away. */
export function placesStored(): boolean {
  return placeKeys().length > 0;
}

/** Forgets every account's place in this browser (the session's end; Task 8's "Clear what this device keeps"). */
export function clearPlaces(): void {
  for (const key of placeKeys()) {
    try {
      store()?.removeItem(key);
    } catch {
      // What cannot be removed cannot be read back either.
    }
  }
}

/** The later of two rows by the time they entered the feed. */
export function newer(a: PlaceRow | null, b: PlaceRow | null): PlaceRow | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.time) > Date.parse(a.time) ? b : a;
}

/**
 * Where a feed opens (decision 9): the key of the stored top row when it is among the first PLACE_WINDOW rows and is not
 * the newest itself, or null for the newest post: nothing stored, the row further down or gone, or "Open feeds at the
 * newest post" on.
 */
export function openingRow(rows: readonly PlaceRow[], place: Place | null, openNewest: boolean): string | null {
  if (!place || openNewest) return null;
  const at = rows.slice(0, PLACE_WINDOW).findIndex((row) => row.key === place.top.key);
  return at > 0 ? place.top.key : null;
}

export interface PlaceKeeper {
  /** The newest post seen so far, the stored one included: the pill counts what is newer. */
  newest(): PlaceRow | null;
  /** Rows that have been half in view for half a second. */
  seen(rows: readonly PlaceRow[]): void;
  /** The row now at the top of the list. */
  top(row: PlaceRow | null): void;
  /** The list scrolled: the place is written a second after the last scroll. */
  scrolled(): void;
  /** The page is hidden or the list goes away: the place is written now. */
  hidden(): void;
  dispose(): void;
}

/**
 * Keeps one feed's place for an account while the reader reads, starting from what was stored. A newest post only ever
 * moves to a newer one; the top row seen is seen. With no account (signed out) it keeps and writes nothing.
 */
export function createPlaceKeeper(accountId: string | null, feed: FeedName, start: Place | null, now: () => number = Date.now): PlaceKeeper {
  let newest: PlaceRow | null = accountId ? (start?.newest ?? null) : null;
  let top: PlaceRow | null = accountId ? (start?.top ?? null) : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (accountId && newest && top) writePlace(accountId, feed, { newest, top, savedAt: now() });
  };
  return {
    newest: () => newest,
    seen(rows) {
      if (!accountId) return;
      for (const row of rows) newest = newer(newest, row);
    },
    top(row) {
      if (!accountId || !row) return;
      top = row;
      newest = newer(newest, row);
    },
    scrolled() {
      if (!accountId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, PLACE_SAVE_MS);
    },
    hidden: save,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
