import { describe, expect, test } from "vitest";
import { ageOn, meetsMinimumAge } from "../../src/auth/age";
import { deviceLabel } from "../../src/auth/devices";
import { DISPOSABLE_DOMAINS, DISPOSABLE_DOMAINS_SOURCE } from "../../src/auth/data/disposable-domains";
import { isDisposableEmail } from "../../src/auth/disposable";
import { checkHandle } from "../../src/auth/handles";

describe("handles", () => {
  test("3 to 20 of a-z, 0-9 and underscore", () => {
    expect(checkHandle("ada")).toBeNull();
    expect(checkHandle("ada_lovelace_1815")).toBeNull();
    expect(checkHandle("ab")).toBe("handle_invalid");
    expect(checkHandle("a".repeat(21))).toBe("handle_invalid");
    expect(checkHandle("Ada")).toBe("handle_invalid");
    expect(checkHandle("ada-l")).toBe("handle_invalid");
  });
  test("reserved names are refused", () => {
    for (const handle of ["admin", "korbat", "support", "moderator", "transparency"]) {
      expect(checkHandle(handle), handle).toBe("handle_reserved");
    }
  });
});

describe("minimum age", () => {
  const today = new Date("2026-09-14T10:00:00Z");
  test("turning 16 today is allowed, tomorrow is not", () => {
    expect(meetsMinimumAge("2010-09-14", today)).toBe(true);
    expect(meetsMinimumAge("2010-09-15", today)).toBe(false);
    expect(ageOn("2010-09-15", today)).toBe(15);
  });
  test("uses the date in UTC", () => {
    // 23:59 in UTC-5 on the 14th is already the 15th in UTC.
    expect(meetsMinimumAge("2010-09-15", new Date("2026-09-14T23:59:59-05:00"))).toBe(true);
  });
  test("a 29 February birthday counts from 1 March in common years", () => {
    expect(ageOn("2008-02-29", new Date("2025-02-28T12:00:00Z"))).toBe(16);
    expect(ageOn("2008-02-29", new Date("2025-03-01T12:00:00Z"))).toBe(17);
  });
  test("a date of birth in the future never passes", () => {
    expect(meetsMinimumAge("2030-01-01", today)).toBe(false);
  });
});

describe("device labels", () => {
  test("web labels are browser on OS", () => {
    const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
    expect(deviceLabel(chromeWin, "web")).toBe("Chrome on Windows");
    expect(deviceLabel(`${chromeWin} Edg/139.0.0.0`, "web")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0", "web")).toBe("Firefox on macOS");
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", "web"),
    ).toBe("Safari on iOS");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36", "web")).toBe(
      "Chrome on Android",
    );
    expect(deviceLabel(undefined, "web")).toBe("Browser on unknown OS");
  });
  test("native platforms get app labels", () => {
    expect(deviceLabel("okhttp/4.12", "android")).toBe("korbat for Android");
    expect(deviceLabel(undefined, "ios")).toBe("korbat for iOS");
  });
});

describe("disposable email domains", () => {
  test("listed domains and their subdomains are blocked, in any case", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@eu.mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@MAILINATOR.COM")).toBe(true);
  });
  test("ordinary domains pass and the list is a pinned snapshot", () => {
    expect(isDisposableEmail("ada@gmail.com")).toBe(false);
    expect(isDisposableEmail("ada@proton.me")).toBe(false);
    expect(DISPOSABLE_DOMAINS.length).toBeGreaterThan(1000);
    expect(DISPOSABLE_DOMAINS_SOURCE).toMatch(/^[0-9a-f]{40}$/);
  });
});
