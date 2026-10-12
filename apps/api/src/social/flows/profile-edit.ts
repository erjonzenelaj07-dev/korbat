import type { HandleChangeRequest, ProfileEditRequest, ProfileView } from "@korbat/contracts";
import { checkHandle } from "../../auth";
import { SocialError, type SocialDeps } from "../context";
import { enforceAccountLimit } from "../limits";
import type { ProfileRow } from "../repo";
import { DAY_MS, HOUR_MS } from "../tiers";
import { profileView } from "./profiles";

/** A handle may change again this long after the last change (1b design, section 7.2). */
export const HANDLE_COOLDOWN_MS = 30 * DAY_MS;
/** Edits of the display name or the bio an account may make in an hour. */
export const PROFILE_EDITS_PER_HOUR = 10;

/** The viewer's own profile row, which the edits below start from. A session always has one; a missing row means the account is gone. */
async function own(deps: SocialDeps, viewer: string): Promise<ProfileRow> {
  const row = await deps.repo.findProfileById(viewer);
  if (!row) throw new SocialError("not_found", 404);
  return row;
}

/** Sets the display name, the bio, or both, and answers with the profile as its owner sees it on the profile route. */
export async function editProfile(deps: SocialDeps, viewer: string, input: ProfileEditRequest): Promise<ProfileView> {
  // The contract refuses an empty edit; a caller that skipped it gets the same answer instead of an update with nothing to set.
  if (input.displayName === undefined && input.bio === undefined) throw new SocialError("invalid_request", 400, "Nothing to change.");
  await enforceAccountLimit(deps.limits, "profile-edit", viewer, PROFILE_EDITS_PER_HOUR, HOUR_MS);
  if (!(await deps.repo.updateProfile(viewer, input))) throw new SocialError("not_found", 404);
  // The event says that the profile changed, not what it says now: the events table holds no content.
  await deps.events?.append(viewer, "profile_updated");
  return profileView(await own(deps, viewer));
}

/**
 * Moves the account to a new handle: the handle rules and the reserved list first, then the 30-day
 * cooldown, then the repository's transaction, which decides whether the handle is free. The handle
 * left behind stays reserved for this account, which may take it back after the next cooldown.
 *
 * 3e (design, section 7.10): a handle korbat retired is refused to everyone, its former holder included
 * (handle_retired, 409), and the placeholder's prefix is in the reserved list. A retirement clears the
 * change time when it swaps the handle, so the first change after it meets no cooldown.
 */
export async function changeHandle(deps: SocialDeps, viewer: string, input: HandleChangeRequest): Promise<ProfileView> {
  const to = input.handle.toLowerCase();
  const problem = checkHandle(to);
  if (problem) throw new SocialError(problem, 400);
  const current = await own(deps, viewer);
  if (current.handle.toLowerCase() === to) throw new SocialError("invalid_request", 400, "That is already your handle.");
  const now = deps.now();
  if (current.handleChangedAt) {
    const allowedAt = current.handleChangedAt.getTime() + HANDLE_COOLDOWN_MS;
    // Retry-After says when the next change is allowed, in whole seconds and never zero.
    if (now.getTime() < allowedAt) throw new SocialError("handle_cooldown", 429, undefined, Math.max(1, Math.ceil((allowedAt - now.getTime()) / 1000)));
  }
  const result = await deps.repo.changeHandle(viewer, to, now);
  if (!result.ok) {
    if (result.reason === "handle_taken" || result.reason === "handle_retired") throw new SocialError(result.reason, 409);
    // The database's guard refused a placeholder's form that the handle rule let through: answered as that rule answers it.
    if (result.reason === "handle_reserved") throw new SocialError("handle_reserved", 400);
    // The row changed under us (a second request of the same account) and already holds this handle.
    if (result.reason === "unchanged") throw new SocialError("invalid_request", 400, "That is already your handle.");
    throw new SocialError("not_found", 404);
  }
  await deps.events?.append(viewer, "handle_changed", { from: result.from, to });
  return profileView(await own(deps, viewer));
}
