import { eq } from "drizzle-orm";
import { handleHistory, profiles, type Db } from "@korbat/db";
import { isUniqueViolation, type ProfileStore } from "../auth";

/**
 * Public profiles through the korbat_api pool. Onboarding writes the profile and the reservation of
 * its handle in one transaction; the unique index on lower(handle) and the primary key of
 * handle_history decide races and refuse a handle another profile holds or ever held.
 */
export function createProfileStore(apiDb: Db): ProfileStore {
  const columns = { id: profiles.id, handle: profiles.handle, displayName: profiles.displayName };
  return {
    async create({ id, handle, displayName }) {
      try {
        const profile = await apiDb.transaction(async (tx) => {
          const [created] = await tx.insert(profiles).values({ id, handle, displayName }).returning(columns);
          // The handle chosen at onboarding is reserved like every later one (1b design, section 6); a row for it under another profile ends the transaction.
          await tx.insert(handleHistory).values({ handleLower: handle.toLowerCase(), profileId: id });
          return created!;
        });
        return { ok: true, profile };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
    async find(id) {
      const [profile] = await apiDb
        .select({ ...columns, handleChangedAt: profiles.handleChangedAt, verifiedAt: profiles.verifiedAt, showInExplore: profiles.showInExplore })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (!profile) return null;
      const { handleChangedAt, verifiedAt, showInExplore, ...pub } = profile;
      // The badge is a fact of the profile row (verified_at), read here so the account screen sees it on /me; so is the
      // author's Explore switch, which the privacy screen shows and the public profile never carries.
      return { ...pub, handleChangedAt: handleChangedAt?.toISOString() ?? null, verified: verifiedAt !== null, showInExplore };
    },
    async setVerified(id, at) {
      await apiDb.update(profiles).set({ verifiedAt: at }).where(eq(profiles.id, id));
    },
  };
}
