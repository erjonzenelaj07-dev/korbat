import { eq } from "drizzle-orm";
import { profiles, type Db } from "@korbat/db";
import { isUniqueViolation, type ProfileStore } from "../auth";

/** Public profiles through the korbat_api pool. The unique index on lower(handle) decides races. */
export function createProfileStore(apiDb: Db): ProfileStore {
  const columns = { id: profiles.id, handle: profiles.handle, displayName: profiles.displayName };
  return {
    async create({ id, handle, displayName }) {
      try {
        const [profile] = await apiDb.insert(profiles).values({ id, handle, displayName }).returning(columns);
        return { ok: true, profile: profile! };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
    async find(id) {
      const [profile] = await apiDb.select(columns).from(profiles).where(eq(profiles.id, id)).limit(1);
      return profile ?? null;
    },
  };
}
