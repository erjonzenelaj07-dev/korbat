import type { Platform } from "@korbat/contracts";

/**
 * Coarse, human-readable device label such as "Chrome on Windows". Deliberately limited to a
 * fixed set of names: it is shown to the account owner, never used for fingerprinting.
 */
export function deviceLabel(userAgent: string | undefined, platform: Platform): string {
  if (platform === "ios") return "korbat for iOS";
  if (platform === "android") return "korbat for Android";
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${os}`;
}
