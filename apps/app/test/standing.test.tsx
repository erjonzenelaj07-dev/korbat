import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AccountStanding, MeResponse } from "@korbat/contracts";
import { HandleSection } from "../src/app/settings/profile";
import { StandingBlock } from "../src/components/moderation/CasesLists";
import { ReportForm } from "../src/components/moderation/ReportForm";
import { StandingBanner } from "../src/components/StandingBanner";
import { messageFor } from "../src/lib/api";
import { refusalSentence, runningMeasure, STANDING_TEXTS, standingTime } from "../src/lib/standing";

/**
 * The app's part of a suspension taken at once (3e design, sections 9.1, 9.4 to 9.6 and 9.8; Task 3): the banner of a
 * running suspension above every signed-in screen, the refusal's sentence, the report form's suspended state, the line in
 * "Your standing", and Settings, Profile while the suspension runs. Components are server-rendered with made-up answers;
 * what a static render cannot show (the reads of /me on focus and after a refusal) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
// react-native-reanimated is mocked once for every test file in test/setup.ts.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .split(" ")
    .filter((part) => part !== "")
    .join(" ");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ENDS = "2026-10-19T10:00:00.000Z";
const running = (more: Partial<NonNullable<AccountStanding["measure"]>> = {}): AccountStanding => ({
  activeStrikes: 1,
  measure: {
    decisionId: id(9),
    kind: "suspend",
    days: 7,
    state: "running",
    earliestStart: "2026-10-12T10:00:00.000Z",
    startsAt: "2026-10-12T10:00:00.000Z",
    endsAt: ENDS,
    reply: null,
    replyOpen: true,
    appealUntil: "2027-04-12T10:00:00.000Z",
    appealPending: false,
    ...more,
  },
  reporting: null,
  handleRetired: false,
});
const NONE: AccountStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };

describe("3e: the words of a suspension in the app", () => {
  test("the banner's, the refusal's, the report form's and the retired handle's sentences are the design's, with the end printed as standingTime prints it", () => {
    expect(STANDING_TEXTS.banner.running(ENDS)).toBe(
      `Your account is suspended until ${standingTime(ENDS)}. You can read, reply to korbat, appeal, export your data and delete your account. You cannot post, like, repost, bookmark, follow, edit your profile, upload images or report under korbat's rules.`,
    );
    expect(STANDING_TEXTS.banner.label).toBe("Your account's standing");
    expect(STANDING_TEXTS.refused.suspended(ENDS)).toBe(`Your account is suspended until ${standingTime(ENDS)}, so you cannot do this now.`);
    expect(STANDING_TEXTS.refused.terminated).toBe("korbat has terminated your account, so you cannot do this.");
    expect(STANDING_TEXTS.refused.over).toBe("The suspension has just ended. Try again.");
    expect(STANDING_TEXTS.report.suspended(ENDS)).toBe(
      `Your account is suspended until ${standingTime(ENDS)}, so it cannot report under korbat's rules. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
    );
    expect(STANDING_TEXTS.handle.retiredSuspended).toBe("korbat retired your handle; the decision is under Settings, Cases. You can choose a new one when your suspension ends: the 30-day wait will not apply.");
    // The fallback when /me cannot be read after a refusal.
    expect(messageFor("account_suspended")).toBe("Your account is suspended, so you cannot do this now.");
  });

  test("the refusal's sentence follows /me as read after the refusal: until when it runs, a termination, or that it has just ended", () => {
    expect(refusalSentence(running())).toBe(STANDING_TEXTS.refused.suspended(ENDS));
    expect(refusalSentence(running({ kind: "terminate", days: null, endsAt: null }))).toBe(STANDING_TEXTS.refused.terminated);
    expect(refusalSentence(NONE)).toBe(STANDING_TEXTS.refused.over);
    expect(refusalSentence(null)).toBe(STANDING_TEXTS.refused.over);
    // Only a measure that runs refuses anything.
    expect(runningMeasure(running({ state: "announced" }))).toBeNull();
  });
});

describe("3e: the banner (design, section 9.1)", () => {
  test("a running suspension: a region labelled with its standing, the sentence as a level-2 header, and the buttons to the decision, the appeal, the export and the deletion", () => {
    const out = html(<StandingBanner standing={running()} />);
    expect(out).toContain('role="region"');
    expect(out).toContain(`aria-label="${STANDING_TEXTS.banner.label.replace("'", "&#x27;")}"`);
    expect(out).toContain('aria-level="2"');
    const text = textOf(out);
    expect(text).toContain(STANDING_TEXTS.banner.running(ENDS));
    for (const label of [STANDING_TEXTS.banner.read, STANDING_TEXTS.banner.appeal, STANDING_TEXTS.banner.export, STANDING_TEXTS.banner.delete]) expect(text).toContain(label);
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
    expect(out).toContain('href="/settings/account"');
    // No appeal button once the appeal is closed.
    expect(textOf(html(<StandingBanner standing={running({ appealUntil: null })} />))).not.toContain(` ${STANDING_TEXTS.banner.appeal} `);
  });

  test("no banner without a measure (the states that Task 4 builds are tested with it, in announced.test.tsx)", () => {
    expect(html(<StandingBanner standing={NONE} />)).toBe("");
    expect(html(<StandingBanner standing={null} />)).toBe("");
  });

  test("the shell renders it above every signed-in screen, and the session reads /me again on focus and after a refusal account_suspended", () => {
    expect(read("components", "AppShell.tsx")).toContain("<StandingBanner standing={state.me.standing} />");
    const session = read("lib", "session.tsx");
    expect(session).toContain("setSuspendedHandler(quiet)");
    expect(session).toContain('AppState.addEventListener("change"');
    expect(read("lib", "api.ts")).toContain('if (res.status === 403 && code === "account_suspended") onSuspended?.();');
    // The composer's sheet says why in place of its fields while a measure runs.
    expect(read("components", "social", "ComposeSheet.tsx")).toContain("{refusalSentence(standing)}");
  });
});

describe("3e: the report form, Your standing and Settings, Profile while the suspension runs (design, sections 9.4 to 9.6)", () => {
  test("the report form disables its first choice with [report.suspended], and leaves the notice of illegality and the path for child sexual abuse material open", () => {
    const out = html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={running()} />);
    expect(textOf(out)).toContain(STANDING_TEXTS.report.suspended(ENDS));
    const radios = (out.match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? []).slice(0, 3);
    expect(radios).toHaveLength(3);
    expect(radios[0]).toContain('aria-disabled="true"');
    expect(radios[1]).not.toContain('aria-disabled="true"');
    expect(radios[2]).not.toContain('aria-disabled="true"');
    // Without a running measure nothing is disabled.
    expect(textOf(html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={NONE} />))).not.toContain(STANDING_TEXTS.report.suspended(ENDS));
  });

  test("Your standing carries the running suspension's line in the banner's words", () => {
    expect(textOf(html(<StandingBlock activeStrikes={1} standing={running()} />))).toContain(STANDING_TEXTS.banner.running(ENDS));
    expect(textOf(html(<StandingBlock activeStrikes={1} standing={NONE} />))).not.toContain("suspended");
  });

  test("Settings, Profile: the handle's form is replaced by the refusal's sentence, and a retired handle reads [handle.retired.suspended]", () => {
    const me = (handle: string): MeResponse => ({
      user: { id: id(1), email: "ada@example.com", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: { id: id(1), handle, displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true, sharePreviews: false },
      standing: running(),
      avatar: null,
    });
    const retired = textOf(html(<HandleSection me={me("retired_0a1b2c3d4e5f")} run={async () => undefined} refresh={async () => undefined} />));
    expect(retired).toContain(STANDING_TEXTS.handle.retiredSuspended);
    expect(retired).not.toContain(STANDING_TEXTS.handle.retired);
    expect(retired).toContain(STANDING_TEXTS.refused.suspended(ENDS));
    expect(retired).not.toContain("Change handle");
    const plain = textOf(html(<HandleSection me={me("ada_l")} run={async () => undefined} refresh={async () => undefined} />));
    expect(plain).toContain(STANDING_TEXTS.refused.suspended(ENDS));
    expect(plain).not.toContain(STANDING_TEXTS.handle.retiredSuspended);
    expect(read("app", "settings", "profile.tsx")).toContain("{refusalSentence(me.standing)}");
  });
});
