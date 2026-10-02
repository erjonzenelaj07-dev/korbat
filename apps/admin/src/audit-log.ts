import { AuditPageQuery, type AuditEntry, type AuditPage } from "@korbat/contracts";
import type { StaffApi } from "./api";
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

export function createAuditReader(api: StaffApi) {
  return {
    newest: (): Promise<AuditPage> => api.audit({}, { activity: true }),
    older: (cursor: number): Promise<AuditPage> => api.audit({ cursor }, { activity: true }),
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
}

export const AUDIT_PAGE_LOADING: AuditPageView = { page: { state: "loading" }, cursor: null, at: null, loadingOlder: false, error: null };

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

  async function open(read: () => Promise<AuditPage>, at: number | null): Promise<void> {
    const mine = ++generation;
    // Nothing older can be asked for until this page has arrived, and a Load older of the page left is over.
    update({ page: { state: "loading" }, cursor: null, loadingOlder: false, error: null });
    try {
      const answer = await read();
      if (mine !== generation) return;
      update({ page: { state: "ready", value: answer.entries }, cursor: answer.nextCursor, at });
    } catch (err) {
      if (mine === generation) update({ page: { state: "failed", message: describeError(err) } });
    }
  }

  return {
    newest: () => open(reader.newest, null),
    at: (place: number) => open(() => reader.at(place), place),
    async older(): Promise<void> {
      const { cursor, page } = view;
      if (cursor === null || view.loadingOlder || page.state !== "ready") return;
      const mine = generation;
      update({ loadingOlder: true, error: null });
      try {
        const answer = await reader.older(cursor);
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
