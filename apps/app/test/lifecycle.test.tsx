import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import EmailRevert from "../src/app/email-revert/[token]";
import { exportMessage } from "../src/app/settings/account";
import { SettingsNav, type SettingsPage } from "../src/components/SettingsNav";
import { VerifiedChip } from "../src/components/ui";
import { ApiError } from "../src/lib/api";
import { exportFilename } from "../src/lib/download";

/**
 * The account-lifecycle screens (1b design, section 9): the row of settings links, the verified badge
 * chip and the export download. The screens themselves need the router and a session, so what can be
 * checked without a browser is rendered on its own or read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** The route parameters the screen under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules), and the row needs only what
// Link does with `asChild`: hand the child its href, which react-native-web renders as a real anchor. A
// screen also reads its route parameters, and could navigate, which a static render never does.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined },
  useLocalSearchParams: () => route.params,
}));
// A screen reads the session only to refresh it after its call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

const PAGES: SettingsPage[] = ["security", "privacy", "profile", "account"];

describe("the settings row", () => {
  test("links every settings screen as a real anchor inside a navigation landmark", () => {
    const out = html(<SettingsNav current="security" />);
    expect(out).toMatch(/<nav\b|role="navigation"/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual(PAGES.map((page) => `/settings/${page}`));
  });

  test("marks the current page and only it", () => {
    for (const page of PAGES) {
      const current = anchors(html(<SettingsNav current={page} />)).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, page).toHaveLength(1);
      expect(current[0], page).toContain(`href="/settings/${page}"`);
    }
  });

  test("every settings screen shows the row and names itself as the current page", () => {
    const dir = path.join(SRC, "app", "settings");
    const screens = readdirSync(dir).filter((file) => file.endsWith(".tsx") && !file.startsWith("_"));
    expect(screens.sort()).toEqual(PAGES.map((page) => `${page}.tsx`).sort());
    for (const file of screens) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).toContain(`<SettingsNav current="${file.replace(/\.tsx$/, "")}"`);
    }
  });
});

describe("the verified badge chip", () => {
  test("renders its label and names itself for a screen reader, as an image, since ARIA lets no generic element carry a name", () => {
    const out = html(<VerifiedChip />);
    expect(out).toContain("Verified");
    const tag = /<div[^>]*aria-label="verified account"[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain('role="img"');
  });

  test("is what post cards and the profile header show for a verified account", () => {
    for (const file of [path.join("components", "social", "PostCard.tsx"), path.join("app", "u", "[handle]", "index.tsx")]) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source, file).toMatch(/verified \? <VerifiedChip \/> : null/);
    }
  });
});

describe("the export download", () => {
  test("takes its file name from Content-Disposition and falls back to a plain one", () => {
    expect(exportFilename('attachment; filename="korbat-export-alice-2026-09-24.zip"')).toBe("korbat-export-alice-2026-09-24.zip");
    expect(exportFilename(null)).toBe("korbat-export.zip");
    expect(exportFilename("attachment")).toBe("korbat-export.zip");
    // Only the API's own shape of name reaches the browser's download prompt.
    expect(exportFilename('attachment; filename="../evil.zip"')).toBe("korbat-export.zip");
  });
});

describe("the email-revert page, opened from the link in the email-changed notice", () => {
  const LABEL = "Move my account back to this address";
  /** The opening tag of the button whose text is the label, or "" when there is none. */
  const buttonTag = (markup: string): string => {
    const at = markup.indexOf(LABEL);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };

  test("with the link's token it explains what happens and offers the button, which nothing happens without", () => {
    route.params = { token: "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2) };
    const out = html(<EmailRevert />);
    expect(out).toContain(LABEL);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(buttonTag(out)).not.toBe("");
    expect(buttonTag(out)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
  });

  test("with anything else in place of the token it says the link is incomplete and disables the button", () => {
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const out = html(<EmailRevert />);
      expect(out, token).toContain('role="alert"');
      expect(out, token).toMatch(/link is incomplete/);
      expect(buttonTag(out), token).toContain('aria-disabled="true"');
    }
  });

  test("the button posts the token to the undo route and the page then offers Sign in", () => {
    const source = readFileSync(path.join(SRC, "app", "email-revert", "[token].tsx"), "utf8");
    expect(source).toContain('api("/api/auth/email/revert", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });
});

/**
 * The settings screens' own rules, read from their source: the static render cannot press a key or
 * move the focus, so what a keyboard does there is checked in the code that does it.
 */
describe("the settings forms", () => {
  const account = readFileSync(path.join(SRC, "app", "settings", "account.tsx"), "utf8");
  const profile = readFileSync(path.join(SRC, "app", "settings", "profile.tsx"), "utf8");

  /** The body of the function or component `name` declares at the top of the file, up to its closing brace at the start of a line. */
  function block(source: string, name: string): string {
    const from = source.indexOf(`function ${name}(`);
    expect(from, name).toBeGreaterThanOrEqual(0);
    return source.slice(from, source.indexOf("\n}\n", from));
  }

  /** The first statement of the function `name` inside `outer`, comments skipped. */
  function firstStatement(source: string, outer: string, name: string): string {
    const body = block(source, outer);
    const at = body.indexOf(`function ${name}(`);
    expect(at, `${outer} ${name}`).toBeGreaterThanOrEqual(0);
    const lines = body
      .slice(at)
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    return lines[0] ?? "";
  }

  test("Enter follows the same rules as the button: every action begins with its button's condition", () => {
    expect(firstStatement(account, "useAction", "act")).toBe("if (busy) return;");
    expect(firstStatement(account, "EmailSection", "start")).toBe("if (email.trim().length === 0) return;");
    expect(firstStatement(account, "EmailSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "BadgeSection", "start")).toBe("if (phone.trim().length === 0) return;");
    expect(firstStatement(account, "BadgeSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "DeleteSection", "confirm")).toBe("if (!CODE.test(code.trim()) || !matches) return;");
    expect(firstStatement(profile, "ProfileForm", "save")).toBe("if (!saved || !ready || busy) return;");
    expect(firstStatement(profile, "HandleSection", "change")).toBe("if (!ready || busy) return;");
  });

  test("the account's own address is refused in its own words, without asking the API", () => {
    const email = block(account, "EmailSection");
    expect(email).toContain("const current = email.trim().toLowerCase() === me.user.email.toLowerCase();");
    expect(email).toContain('<Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />');
    const start = email.slice(email.indexOf("function start("));
    const refusal = start.indexOf('setError("That is already your email address.");');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(start.indexOf('api("/api/auth/email/change/start"'));
  });

  test("the badge section shows only in a build that says on, and every build defaults to off", () => {
    expect(account).toContain('const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";');
    const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");
    expect(read("infra", "compose.yml")).toContain("EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}");
    const dockerfile = read("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_BADGE=off");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac');
    const infraEnv = read("infra", ".env.example");
    expect(infraEnv).toMatch(/^WEB_BADGE=off$/m);
    expect(infraEnv).toMatch(/^API_VERIFY_PROVIDER=off$/m);
    // The development API runs the dev provider, so the development app shows the section.
    expect(read("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_BADGE=on$/m);
    expect(read("apps", "api", ".env.example")).toMatch(/^VERIFY_PROVIDER=dev$/m);
  });

  test("the focus survives a step change: code fields take it, and going back hands it to the section's first control", () => {
    for (const label of ["Code from the email", "Code from the text message"]) {
      const fields = account.split("\n").filter((line) => line.includes(`<Field label="${label}"`));
      expect(fields.length, label).toBeGreaterThan(0);
      for (const field of fields) expect(field, label).toContain(" autoFocus ");
    }
    expect(block(account, "EmailSection")).toContain("useFocusOnReturn(flowId !== null, emailRef);");
    expect(block(account, "EmailSection")).toContain('<Field ref={emailRef} label="New email address"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(verified || flowId !== null, phoneRef);");
    expect(block(account, "BadgeSection")).toContain('<Field ref={phoneRef} label="Phone number"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(!verified, removeRef);");
    expect(block(account, "BadgeSection")).toContain('<Button ref={removeRef} label="Remove badge"');
    expect(block(account, "DeleteSection")).toContain("useFocusOnReturn(flowId !== null, sendRef);");
    expect(block(account, "DeleteSection")).toContain('<Button ref={sendRef} label="Send me a code"');
    const hook = block(account, "useFocusOnReturn");
    expect(hook).toContain("if (!away && wasAway.current) target.current?.focus();");
    // The field and the button hand the ref to the element react-native-web renders, whose focus() moves the browser's focus.
    const ui = readFileSync(path.join(SRC, "components", "ui.tsx"), "utf8");
    expect(block(ui, "Field")).toContain("<TextInput\n        ref={ref}");
    expect(block(ui, "Button")).toContain("<Pressable ref={ref}");
  });

  test("the export's daily limit says when the next export is allowed", () => {
    const limited = (seconds: number) => new ApiError(429, "rate_limited", "Too many requests. Wait a moment and try again.", seconds);
    expect(exportMessage(limited(3600))).toBe("You exported your data today already. You can export again in about an hour.");
    expect(exportMessage(limited(20 * 3600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(limited(20 * 3600 - 600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toBe("Confirm it's you to continue.");
  });

  test("the export says it was downloaded only once the whole body arrived; a body that fails part way is an error", () => {
    const exporting = block(account, "ExportSection");
    const saved = exporting.indexOf("saveBlob(await res.blob(), exportFilename(res.headers.get(\"content-disposition\")));");
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThan(exporting.indexOf('setDone("Your export was downloaded.");'));
    // A rejected res.blob() leaves the action through useAction, which shows the error and no note.
    expect(exporting).toContain("useAction(run, exportMessage)");
  });
});
