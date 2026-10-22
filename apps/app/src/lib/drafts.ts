/**
 * Drafts on the device (UI design, decision 18, sections 6.15 and 8.8): what the reader is writing, its text and never
 * its images, kept in this browser's storage under korbat.drafts.<accountId>, one entry per context: a new post
 * (`post`), a reply to a post (`reply:<id>`) and a quote of a post (`quote:<id>`). A composer writes its text 500 ms
 * after typing stops and when it leaves the screen, and removes it when the post is sent or the draft discarded.
 * Where there is no browser storage (native, until sub-project 5 chooses a storage library), or the browser refuses it,
 * drafts live in this module's memory for the session instead. This is the only module in src that touches those keys
 * (explore.test.tsx holds the app's stores to a list); the session's end clears every one of them, whatever the account,
 * through clearDrafts() (lib/session-end.ts), as Task 8's "Clear what this device keeps" will. A reader who is signed
 * out keeps no draft.
 */

export const DRAFT_PREFIX = "korbat.drafts.";

/** How long after the last keystroke the text is written. */
export const DRAFT_SAVE_MS = 500;

/** Where a draft belongs: a new post, or a reply to or a quote of one post. */
export type DraftContext = "post" | `reply:${string}` | `quote:${string}`;

/** The context of a composer: a reply to `replyToId`, a quote of `quoteOfId`, or else a new post. */
export function draftContext(replyToId?: string | null, quoteOfId?: string | null): DraftContext {
  if (replyToId) return `reply:${replyToId}`;
  if (quoteOfId) return `quote:${quoteOfId}`;
  return "post";
}

export function draftKey(accountId: string): string {
  return `${DRAFT_PREFIX}${accountId}`;
}

/** Browser storage, typed locally as lib/reading-place.ts types it; every access is guarded, since a private window or blocked storage throws. */
interface Store {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The session's memory, for a platform without browser storage: the same shape, gone when the app ends. */
const memory = new Map<string, string>();
const memoryStore: Store = {
  get length() {
    return memory.size;
  },
  key: (index) => [...memory.keys()][index] ?? null,
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

/** The browser's storage, or the memory where there is none (native) or the browser will not say. */
function store(): Store {
  try {
    return (globalThis as unknown as { localStorage?: Store }).localStorage ?? memoryStore;
  } catch {
    return memoryStore;
  }
}

type Drafts = Partial<Record<DraftContext, string>>;

/** Every draft an account has here; a damaged record is none. */
function readDrafts(accountId: string): Drafts {
  try {
    const raw = store().getItem(draftKey(accountId));
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Drafts) : {};
  } catch {
    return {};
  }
}

function writeDrafts(accountId: string, drafts: Drafts): void {
  try {
    if (Object.keys(drafts).length === 0) store().removeItem(draftKey(accountId));
    else store().setItem(draftKey(accountId), JSON.stringify(drafts));
  } catch {
    // A full or refused store keeps the draft on screen only; nothing else depends on it.
  }
}

/** The kept text of one context, or "" when there is none. */
export function readDraft(accountId: string, context: DraftContext): string {
  const text = readDrafts(accountId)[context];
  return typeof text === "string" ? text : "";
}

/** Keeps a context's text; blank text is no draft, and removes the one kept. */
export function writeDraft(accountId: string, context: DraftContext, text: string): void {
  const drafts = readDrafts(accountId);
  if (text.trim() === "") delete drafts[context];
  else drafts[context] = text;
  writeDrafts(accountId, drafts);
}

export function removeDraft(accountId: string, context: DraftContext): void {
  const drafts = readDrafts(accountId);
  if (!(context in drafts)) return;
  delete drafts[context];
  writeDrafts(accountId, drafts);
}

/** Every drafts key in a store. */
function draftKeys(from: Store): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < from.length; index++) {
      const key = from.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    // Storage that cannot be read holds nothing this module can find.
  }
  return keys;
}

/** Whether any account's draft is kept here: the session's first 401 then means a session that ended while away. */
export function draftsStored(): boolean {
  return draftKeys(store()).length > 0;
}

/** Forgets every account's drafts, in the browser and in memory (the session's end; Task 8's "Clear what this device keeps"). */
export function clearDrafts(): void {
  for (const from of new Set([store(), memoryStore])) {
    for (const key of draftKeys(from)) {
      try {
        from.removeItem(key);
      } catch {
        // What cannot be removed cannot be read back either.
      }
    }
  }
}

/** One composer's draft: what it typed, written once typing stops; removed when sent or discarded. */
export interface DraftKeeper {
  typed(text: string): void;
  sent(): void;
  discarded(): void;
  /** The composer leaves: what waits is written now. */
  dispose(): void;
}

export function createDraftKeeper(accountId: string | null, context: DraftContext): DraftKeeper {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: string | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    waiting = null;
  };
  const flush = () => {
    if (accountId === null || waiting === null) return;
    const text = waiting;
    cancel();
    writeDraft(accountId, context, text);
  };
  const forget = () => {
    cancel();
    if (accountId !== null) removeDraft(accountId, context);
  };
  return {
    typed(text) {
      if (accountId === null) return;
      if (timer !== null) clearTimeout(timer);
      waiting = text;
      timer = setTimeout(flush, DRAFT_SAVE_MS);
    },
    sent: forget,
    discarded: forget,
    dispose: flush,
  };
}
