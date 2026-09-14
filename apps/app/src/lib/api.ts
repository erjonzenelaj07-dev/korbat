import { Platform } from "react-native";
import { HealthResponse } from "@korbat/contracts";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`, { credentials: "include" });
  return HealthResponse.parse(await res.json());
}
