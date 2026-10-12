import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { ipHash, netHash } from "./identifiers";

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

/** The eight groups of an IPv6 address as numbers, the "::" filled in; null when the text is not such an address. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16)));
  const [head, tail] = [groups(halves[0]!), halves.length === 2 ? groups(halves[1]!) : []];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const all = [...head, ...Array.from({ length: missing }, () => 0), ...tail];
  return all.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? all : null;
}

/**
 * The network an address belongs to, for the limits that count per network (3c design, section 7.1): an IPv4 address
 * is its own network, and an IPv6 address is its first 64 bits, since a single subscriber is usually given a whole /64
 * and could otherwise send from a new address every time. An IPv4 address written as an IPv6 one (::ffff:a.b.c.d)
 * counts as the IPv4 address it is. Anything that is no address is taken as it is, so a request without one ("direct",
 * in tests) still has a bucket.
 */
export function clientNetwork(ip: string): string {
  // A zone index names a link of this machine, not a network.
  const address = ip.split("%")[0]!.trim();
  if (isIP(address) !== 6) return ip;
  const mapped = /^::ffff:([0-9]+(?:[.][0-9]+){3})$/i.exec(address);
  if (mapped && isIP(mapped[1]!) === 4) return mapped[1]!;
  // An address that ends in dotted form otherwise (the old "compatible" form) is rare enough to be a bucket of its own.
  const groups = address.includes(".") ? null : ipv6Groups(address);
  if (!groups) return address.toLowerCase();
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** Sets `clientIp`, its keyed hash and the keyed hash of its network on every request, before anything limits or records it. */
export function clientIdentity(options: { trust: ProxyTrust; ipHashKey: Buffer }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = resolveClientIp(c, options.trust);
    c.set("clientIp", ip);
    c.set("clientIpHash", ipHash(options.ipHashKey, ip));
    c.set("clientNetHash", netHash(options.ipHashKey, clientNetwork(ip)));
    await next();
  });
}
