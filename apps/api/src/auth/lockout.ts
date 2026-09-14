import type { KeyValueStore } from "./kv";
import type { AuthRepo } from "./repo";

export const LOCK_THRESHOLD = 5;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Password lockout: the fifth wrong password within 15 minutes pauses password sign-in for
 * 15 minutes. It never blocks email-code sign-in, so guessing passwords cannot lock the owner out.
 */
export function createLockout(deps: { repo: AuthRepo; kv: KeyValueStore; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const key = (userId: string) => `pw-fail:${userId}`;

  return {
    isLocked(user: { lockedUntil: Date | null }): boolean {
      return user.lockedUntil !== null && user.lockedUntil.getTime() > now().getTime();
    },

    async recordFailure(userId: string): Promise<{ failures: number; locked: boolean }> {
      const failures = await deps.kv.incr(key(userId), LOCK_WINDOW_MS);
      const locked = failures >= LOCK_THRESHOLD;
      await deps.repo.setPasswordFailures(userId, failures, locked ? new Date(now().getTime() + LOCK_DURATION_MS) : null);
      if (locked) await deps.kv.del(key(userId));
      return { failures, locked };
    },

    async recordSuccess(userId: string): Promise<void> {
      await deps.kv.del(key(userId));
      await deps.repo.setPasswordFailures(userId, 0, null);
    },
  };
}

export type Lockout = ReturnType<typeof createLockout>;
