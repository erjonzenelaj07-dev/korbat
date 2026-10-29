import { and, eq, isNotNull, sql } from "drizzle-orm";
import { handleHistory, profiles, type Db } from "@korbat/db";
import { handleRefusal, isUniqueViolation, type ProfileStore } from "../auth";
import { WRITE_CLOCK, liveNotSuspended } from "../lib/standing";

/**
 * Public profiles through the korbat_api pool. Onboarding writes the profile and the reservation of
 * its handle in one transaction; the unique index on lower(handle) and the primary key of
 * handle_history decide races and refuse a handle another profile holds or ever held. A handle korbat retired (3e) is
 * refused first, in the same transaction, with its own answer; the database's guard of handles refuses the same, and a
 * placeholder's form, under a race or to a caller that skipped the handle rule, and is answered alike.
 */
export function createProfileStore(apiDb: Db): ProfileStore {
  const columns = { id: profiles.id, handle: profiles.handle, displayName: profiles.displayName };
  return {
    async create({ id, handle, displayName }) {
      try {
        const profile = await apiDb.transaction(async (tx) => {
          // 3e: a retired handle is nobody's, so it is refused before the unique index would call it taken.
          const [retired] = await tx
            .select({ handle: handleHistory.handleLower })
            .from(handleHistory)
            .where(and(eq(handleHistory.handleLower, handle.toLowerCase()), isNotNull(handleHistory.retiredAt)))
            .limit(1);
          if (retired) return null;
          const [created] = await tx.insert(profiles).values({ id, handle, displayName }).returning(columns);
          // The handle chosen at onboarding is reserved like every later one (1b design, section 6); a row for it under another profile ends the transaction.
          await tx.insert(handleHistory).values({ handleLower: handle.toLowerCase(), profileId: id });
          return created!;
        });
        return profile === null ? { ok: false, reason: "handle_retired" } : { ok: true, profile };
      } catch (err) {
        const guarded = handleRefusal(err);
        if (guarded !== null) return { ok: false, reason: guarded };
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
    async find(id) {
      const [profile] = await apiDb
        .select({ ...columns, handleChangedAt: profiles.handleChangedAt, verifiedAt: profiles.verifiedAt, showInExplore: profiles.showInExplore, sharePreviews: profiles.sharePreviews })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (!profile) return null;
      const { handleChangedAt, verifiedAt, showInExplore, sharePreviews, ...pub } = profile;
      // The badge is a fact of the profile row (verified_at), read here so the account screen sees it on /me; so is the
      // author's Explore switch, which the privacy screen shows and the public profile never carries, and (2d, decision
      // 21) the link-preview switch beside it.
      return { ...pub, handleChangedAt: handleChangedAt?.toISOString() ?? null, verified: verifiedAt !== null, showInExplore, sharePreviews };
    },
    /**
     * The badge, profiles.verified_at, which the auth module decides and cannot write. 3e (design, section 7.2): setting it
     * is a write of the account, so the one predicate joins the update's WHERE and the answer says whether a row changed;
     * removing it is open to everyone, and answers true. Setting it locks the row first, in a statement of its own, so the
     * UPDATE that judges comes once the row is held: an UPDATE that waited for a holder that only locked the row would
     * keep the judgment it made before the wait. It is the write's last statement, and so its closing judgment (3e's review).
     */
    async setVerified(id, at) {
      if (at === null) {
        await apiDb.update(profiles).set({ verifiedAt: null }).where(eq(profiles.id, id));
        return true;
      }
      return apiDb.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${id}::uuid for no key update`);
        const updated = await tx.update(profiles).set({ verifiedAt: at }).where(and(eq(profiles.id, id), liveNotSuspended("profiles", WRITE_CLOCK))).returning({ id: profiles.id });
        return updated.length === 1;
      });
    },
    /** A plain read of the same fact, which startBadge asks first as a courtesy, so that no code is sent to a suspended account; the write decides. */
    async suspended(id) {
      const [row] = (await apiDb.execute(sql`select not ${liveNotSuspended("p", WRITE_CLOCK)} as suspended from profiles p where p.id = ${id}::uuid and p.deleted_at is null`)) as unknown as { suspended: boolean }[];
      return row?.suspended ?? false;
    },
  };
}
