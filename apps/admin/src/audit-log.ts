import { AUDIT_EXPORT_MAX, AuditExportLine, AuditPageQuery, type AuditEntry, type AuditPage } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { describeError } from "./messages";
import type { Loadable } from "./ui";

/**
 * The audit log's reading (3a design, sections 2 and 9): newest first, "Load older" from a page's cursor, and "Go to
 * place", which opens the page whose newest row is at a place the keeper kept. Each read is a person's action.
 */

/**
 * A place as the keeper typed or pasted it, checked by the reader's own query schema (a positive whole number of at most
 * 15 digits), or null, which asks nothing of the API.
 */
export function parsePlace(text: string): number | null {
  const parsed = AuditPageQuery.safeParse({ at: text.trim() });
  return parsed.success && parsed.data.at !== undefined ? parsed.data.at : null;
}

/** 3f Task 6 ("What one key confirmed", 8.7): a key's id, checked, and a period, either end open. */
export interface KeyFilter {
  key: string;
  from?: string;
  to?: string;
}

/**
 * The key filter as the person typed it, checked by the reader's own query schema: a lower-case key's id, and each time
 * an instant or left empty. Null asks nothing of the API.
 */
export function parseKeyFilter(key: string, from: string, to: string): KeyFilter | null {
  const asked = { key: key.trim().toLowerCase(), ...(from.trim() === "" ? {} : { from: from.trim() }), ...(to.trim() === "" ? {} : { to: to.trim() }) };
  const parsed = AuditPageQuery.safeParse(asked);
  return parsed.success && parsed.data.key !== undefined ? { key: parsed.data.key, ...(parsed.data.from ? { from: parsed.data.from } : {}), ...(parsed.data.to ? { to: parsed.data.to } : {}) } : null;
}

export function createAuditReader(api: StaffApi) {
  return {
    newest: (filter: KeyFilter | null = null): Promise<AuditPage> => api.audit({ ...(filter ?? {}) }, { activity: true }),
    older: (cursor: number, filter: KeyFilter | null = null): Promise<AuditPage> => api.audit({ cursor, ...(filter ?? {}) }, { activity: true }),
    at: (place: number): Promise<AuditPage> => api.audit({ at: place }, { activity: true }),
  };
}

export type AuditReader = ReturnType<typeof createAuditReader>;

/** What the audit page shows: every row read so far, newest first, and how it was opened. */
export interface AuditPageView {
  page: Loadable<AuditEntry[]>;
  /** The place to read older rows from, or null when there are none (or while a page loads). */
  cursor: number | null;
  /** The place the page was opened at with Go to place, or null for the newest rows. */
  at: number | null;
  loadingOlder: boolean;
  /** A Load older that failed, in the console's words; the rows already read stay. */
  error: string | null;
  /** 3f Task 6: the key whose confirmed rows the page lists, or null for every row. */
  filter?: KeyFilter | null;
  /** 3f Task 6: the reader's own newest copied place, from the newest answer; null before the first copy. */
  lastPlace?: number | null;
}

export const AUDIT_PAGE_LOADING: AuditPageView = { page: { state: "loading" }, cursor: null, at: null, loadingOlder: false, error: null, filter: null, lastPlace: null };

/**
 * The audit page's reads, each answer shown only on the page it was asked for. Opening a page (the newest, or Go to place)
 * starts a new generation, and an answer of an older generation is dropped: a Load older still in flight when the keeper
 * opens another page would otherwise append its rows to that page, under a heading that names another place, with rows
 * read twice. `show` receives every change; `stop` drops whatever is still in flight once the screen has gone.
 */
export function createAuditPager(reader: AuditReader, show: (view: AuditPageView) => void) {
  let view = AUDIT_PAGE_LOADING;
  let generation = 0;
  const update = (next: Partial<AuditPageView>) => {
    view = { ...view, ...next };
    show(view);
  };

  async function open(read: () => Promise<AuditPage>, at: number | null, filter: KeyFilter | null = null): Promise<void> {
    const mine = ++generation;
    // Nothing older can be asked for until this page has arrived, and a Load older of the page left is over.
    update({ page: { state: "loading" }, cursor: null, loadingOlder: false, error: null, filter });
    try {
      const answer = await read();
      if (mine !== generation) return;
      update({ page: { state: "ready", value: answer.entries }, cursor: answer.nextCursor, at, ...(answer.copy ? { lastPlace: answer.copy.lastPlace } : {}) });
    } catch (err) {
      if (mine === generation) update({ page: { state: "failed", message: describeError(err) } });
    }
  }

  return {
    newest: () => open(() => reader.newest(), null),
    at: (place: number) => open(() => reader.at(place), place),
    /** 3f Task 6: the rows a step-up of one key confirmed, newest first; Load older keeps the key. */
    byKey: (filter: KeyFilter) => open(() => reader.newest(filter), null, filter),
    async older(): Promise<void> {
      const { cursor, page } = view;
      if (cursor === null || view.loadingOlder || page.state !== "ready") return;
      const mine = generation;
      update({ loadingOlder: true, error: null });
      try {
        const answer = view.filter ? await reader.older(cursor, view.filter) : await reader.older(cursor);
        if (mine !== generation) return;
        const shown = view.page.state === "ready" ? view.page.value : [];
        update({ page: { state: "ready", value: [...shown, ...answer.entries] }, cursor: answer.nextCursor, loadingOlder: false });
      } catch (err) {
        if (mine === generation) update({ error: describeError(err), loadingOlder: false });
      }
    },
    stop(): void {
      generation++;
    },
  };
}

// ---------------------------------------------------------------- the daily copy (3f Task 6, sections 7.16 and 8.7)

/** One line of the download as the console holds it: its place and the two hashes it is checked by. */
export interface HeldLine {
  place: number;
  prevHash: string;
  hash: string;
}

/**
 * The download's lines, when they run from place `after` + 1 to place `through` without a break: each line parses as the
 * contracts' AuditExportLine, its place is the one after the line before, and it names that line's hash as its previous.
 * Null for a body that broke off, or whose lines do not continue each other: nothing is saved or marked then.
 */
export function checkDownload(text: string, after: number, through: number): HeldLine[] | null {
  const LF = String.fromCharCode(10);
  const raw = text.split(LF).filter((line) => line.trim() !== "");
  const lines: HeldLine[] = [];
  for (const entry of raw) {
    let parsed: ReturnType<typeof AuditExportLine.safeParse>;
    try {
      parsed = AuditExportLine.safeParse(JSON.parse(entry));
    } catch {
      return null;
    }
    if (!parsed.success) return null;
    const line = parsed.data;
    const before = lines[lines.length - 1];
    if (line.place !== (before === undefined ? after + 1 : before.place + 1)) return null;
    if (before !== undefined && line.prevHash !== before.hash) return null;
    lines.push({ place: line.place, prevHash: line.prevHash, hash: line.hash });
  }
  if (lines.length !== through - after || lines[lines.length - 1]?.place !== through) return null;
  return lines;
}

/** What "Download since my last copy" came to: the places copied, nothing newer, or a download that broke off. */
export type CopyOutcome = { kind: "done"; from: number; to: number; rows: number } | { kind: "none"; lastPlace: number } | { kind: "broken" };

/**
 * "Download since my last copy" (7.16 steps 1 to 4): from the caller's own newest copied place (`lastPlace`, 0 before
 * the first copy) to the head the page shows, at most AUDIT_EXPORT_MAX rows; nothing newer asks for no key. The key
 * confirms the download; the console holds the whole body, checks that its lines run without a break, saves the file,
 * and only then posts the mark with the last line's place and hash. A body that broke off, lines that do not continue
 * each other, or a mark the database refused, records nothing: the outcome is `broken`, and the next press starts at the
 * same place. A refusal before the body (the key, a session that ended) is thrown, for the screen to word.
 */
export async function downloadCopy(
  deps: { exportAudit(params: { after: number; through: number }): Promise<string>; markCopy(body: { through: number; hash: string }): Promise<void>; save(name: string, text: string): void },
  lastPlace: number | null,
  head: number,
): Promise<CopyOutcome> {
  const after = lastPlace ?? 0;
  if (head <= after) return { kind: "none", lastPlace: after };
  const through = Math.min(head, after + AUDIT_EXPORT_MAX);
  let text: string;
  try {
    text = await deps.exportAudit({ after, through });
  } catch (err) {
    // A body that ended on the way arrives as a network failure; every other refusal is the screen's to word.
    if (err instanceof ApiError && err.code === "network") return { kind: "broken" };
    throw err;
  }
  const lines = checkDownload(text, after, through);
  if (lines === null) return { kind: "broken" };
  deps.save(`korbat-audit-${after + 1}-${through}.jsonl`, text);
  try {
    await deps.markCopy({ through, hash: lines[lines.length - 1]!.hash });
  } catch (err) {
    if (err instanceof ApiError && (err.code === "copy_mismatch" || err.code === "network")) return { kind: "broken" };
    throw err;
  }
  return { kind: "done", from: after + 1, to: through, rows: lines.length };
}

/** Saves the file the browser holds as a download of its own, from memory: no request leaves the page for it. */
export function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // The click has handed the bytes to the browser's download; the address is let go once it has.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
