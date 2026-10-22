import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The source files that still paint with Tailwind's own palette (`text-zinc-400`, `bg-sky-500`) and size the text
 * with size and weight classes instead of korbat's tokens and the Text component (UI design, sections 4.2 and 6.2).
 * contrast.test.ts lets these files, and only these, keep palette classes and hex colours; theme.test.ts lets them
 * keep size and weight classes. A listed file that no longer holds a palette class fails contrast.test.ts, so the
 * task that moves a file onto the tokens takes it off this list in the same commit; Task 8 empties it. Paths are
 * from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_COLOUR_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/explore/about.tsx",
  "app/index.tsx",
  "app/post/[id].tsx",
  "app/rules.tsx",
  "app/settings/account.tsx",
  "app/settings/cases/[id].tsx",
  "app/settings/cases/[id]/reply.tsx",
  "app/settings/cases/index.tsx",
  "app/settings/cases/releases/[id].tsx",
  "app/settings/cases/uploads/[id].tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "app/transparency.tsx",
  "app/u/[handle]/index.tsx",
  "components/moderation/CasesLists.tsx",
  "components/moderation/DecisionDetail.tsx",
  "components/moderation/ItemLines.tsx",
  "components/moderation/NoticeStatusView.tsx",
  "components/moderation/RefusedNotice.tsx",
  "components/moderation/ReleaseNotice.tsx",
  "components/moderation/ReportForm.tsx",
  "components/moderation/UploadNotice.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
  "components/social/ExploreList.tsx",
  "components/social/PagedList.tsx",
];

/**
 * The files of src/app and src/components that still hold a bare sentence as a JSX child, a text or a string literal
 * written straight into the markup instead of a words module (UI design, section 1.5). a11y.test.tsx lets these files,
 * and only these, keep them; a listed file that no longer holds one fails, so the task that moves a file's sentences
 * into its area's words module takes it off this list in the same commit. Task 10 records what is left. Paths are from
 * apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_TEXT_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/(auth)/code.tsx",
  "app/(auth)/handle.tsx",
  "app/(auth)/mfa.tsx",
  "app/(auth)/password.tsx",
  "app/(auth)/signin.tsx",
  "app/email-revert/[token].tsx",
  "app/explore/about.tsx",
  "app/index.tsx",
  "app/not-me/[token].tsx",
  "app/passkey-remove/[token].tsx",
  "app/post/[id].tsx",
  "app/settings/account.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "app/u/[handle]/index.tsx",
  "components/moderation/ReportForm.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
  "components/social/ExploreList.tsx",
  "components/social/PagedList.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
