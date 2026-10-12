import { randomUUID } from "node:crypto";
import pino from "pino";
import type { AuthEventType } from "../../src/auth/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "../../src/social/context";
import type { HandleChangeResult, ProfileRow, SocialRepo } from "../../src/social/repo";

export interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

/** An events dependency that keeps what the flows asked the auth module to record, instead of writing auth_events. */
export function recordingEvents(): SocialEvents & { recorded: RecordedEvent[] } {
  const recorded: RecordedEvent[] = [];
  return {
    recorded,
    async append(userId, type, metadata) {
      recorded.push({ userId, type, metadata });
    },
  };
}

/**
 * The profile-edit flows without a database: profiles by id, and the handle history as the real
 * table keeps it (one row per lowercase handle, owned by one profile for good). The repository fake
 * has only the three methods those flows call, checked against the real signatures; the limit store
 * is in memory; the clock moves only when a test says so, so timestamps compare exactly; and the
 * events fake records what the server would write to auth_events.
 */
export function profileHarness(start = 1_789_000_000_000) {
  let t = start;
  const rows = new Map<string, ProfileRow>();
  /** handle_history: the lowercase handle and the profile it belongs to. */
  const history = new Map<string, string>();
  /** 3e: the handles of the history that a retirement in the ledger keeps from everyone, their former holder included. */
  const retired = new Set<string>();
  const events = recordingEvents();
  const repo = {
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const row = rows.get(id);
      if (!row) return false;
      if (patch.displayName !== undefined) row.displayName = patch.displayName;
      if (patch.bio !== undefined) row.bio = patch.bio;
      return true;
    },
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      const row = rows.get(id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
      // As the real claim statement: a retired handle is refused before anything else, to its former holder too.
      if (retired.has(to)) return { ok: false, reason: "handle_retired" };
      const inUse = [...rows.values()].some((other) => other.id !== id && other.handle.toLowerCase() === to);
      if (inUse || (history.has(to) && history.get(to) !== id)) return { ok: false, reason: "handle_taken" };
      const from = row.handle;
      // As the real insert with "on conflict do nothing": a handle already in the history keeps its owner.
      if (!history.has(from.toLowerCase())) history.set(from.toLowerCase(), id);
      row.handle = to;
      row.handleChangedAt = now;
      return { ok: true, from };
    },
  } satisfies Pick<SocialRepo, "findProfileById" | "updateProfile" | "changeHandle">;
  const deps: SocialDeps = {
    repo: repo as unknown as SocialRepo,
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => t),
    log: pino({ level: "silent" }),
    now: () => new Date(t),
    events,
  };
  return {
    deps,
    events: events.recorded,
    history,
    retired,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    /** 3e: what a retirement does to a profile that still holds the handle: the placeholder, and no change time. */
    retire(id: string, placeholder: string): void {
      const row = rows.get(id)!;
      retired.add(row.handle.toLowerCase());
      row.handle = placeholder;
      row.handleChangedAt = null;
    },
    /** A profile as onboarding leaves it: the handle chosen then is in the history. */
    profile(handle: string): ProfileRow {
      const id = randomUUID();
      const row: ProfileRow = { id, handle, displayName: `Profile ${handle}`, bio: "", verified: false, followerCount: 0, followingCount: 0, postCount: 0, createdAt: new Date(t), handleChangedAt: null };
      rows.set(id, row);
      history.set(handle.toLowerCase(), id);
      return row;
    },
  };
}
