import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { ipHash } from "./identifiers";

export type ProxyTrust = "cloudflare" | "caddy" | "none";

/** The socket's peer address, or "direct" where there is no socket (tests call the app in-process). */
function socketAddress(c: Context<AppEnv>): string {
  try {
    return getConnInfo(c).remote.address ?? "direct";
  } catch {
    return "direct";
  }
}

/**
 * Which address to believe is a deployment fact, never a request's. Behind the Cloudflare tunnel it is
 * cf-connecting-ip, which Cloudflare sets; behind Caddy alone it is the first X-Forwarded-For entry,
 * which Caddy sets from the socket and never copies from the client; with nothing in front, the
 * socket. A missing header falls back down the list; a header the mode does not trust is ignored.
 */
export function resolveClientIp(c: Context<AppEnv>, trust: ProxyTrust): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  if (trust === "cloudflare") return c.req.header("cf-connecting-ip") ?? forwarded ?? socketAddress(c);
  if (trust === "caddy") return forwarded ?? socketAddress(c);
  return socketAddress(c);
}

/** Sets `clientIp` and its keyed hash on every request, before anything limits or records it. */
export function clientIdentity(options: { trust: ProxyTrust; ipHashKey: Buffer }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = resolveClientIp(c, options.trust);
    c.set("clientIp", ip);
    c.set("clientIpHash", ipHash(options.ipHashKey, ip));
    await next();
  });
}
