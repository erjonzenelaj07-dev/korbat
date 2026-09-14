import { randomUUID } from "node:crypto";
import { randomToken } from "../../src/auth/crypto";
import type { AuthRepo } from "../../src/auth/repo";

/** A fresh user with one web device. Every call uses a unique email, so tests never collide. */
export async function newUserWithDevice(repo: AuthRepo) {
  const user = await repo.createUser({ email: `it-${randomUUID()}@korbat.local`, termsVersion: "test", now: new Date() });
  const device = await repo.createDevice({ userId: user.id, deviceHash: randomToken(), label: "Chrome on Windows", platform: "web", ipHash: null });
  return { user, device };
}

/** A controllable clock for expiry and window tests. */
export function fakeClock(start: number = Date.now()) {
  let t = start;
  return {
    now: () => new Date(t),
    ms: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}
