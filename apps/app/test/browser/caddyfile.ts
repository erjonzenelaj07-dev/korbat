import { APP_SITE, handles, matcherTakes, pathMatchers, readCaddyfile, routeFor, site, type CaddyNode, type Handle, type PathMatcher } from "../../../admin/test/caddyfile";

/**
 * The app's site in infra/caddy/Caddyfile, as the app's browser check needs it (UI design, section 12.3), read with the
 * console's reader (apps/admin/test/caddyfile.ts), so the check serves the export under the headers Caddy really sends
 * and never from a copy: the page's security headers (the app_page_headers snippet, its policy among them) and caching by
 * kind of file, immutable for /_expo/* and /assets/*, no-cache for the page and everything else. The site is the snippet
 * that APP_SITE names, open by default, as Caddy reads it with nothing set. 2d Task 6 (design, sections 8.2 and 12.4): a
 * post's page and a profile's page each ask the API for their share card, and the files' handle says noindex on every page
 * but the five that name no account (@named), all of which the check serves as Caddy sends them.
 */
export { APP_SITE, routeFor };

/**
 * What a request to the app's site reaches: the API, a handle's own answer, a post's or (2d) a profile's page (the shell
 * under the status of the page's card), or the files.
 */
export type AppRoute = { kind: "api" } | { kind: "own"; status: number; body: string; headers: Record<string, string> } | { kind: "post" } | { kind: "profile" } | { kind: "files" };

/** The app's site block, with its snippets put in. */
export function appSite(tree: CaddyNode[] = readCaddyfile()): CaddyNode {
  return site(tree, APP_SITE);
}

/**
 * Whether a handle hands the request to the API as it is (reverse_proxy without a rewrite of its path), or asks it for a
 * page's card (2d Task 6: the rewrite names the post's or the profile's card route); a rewrite to anything else is no route
 * this reader knows.
 */
function proxies(handle: Handle): "api" | "post" | "profile" | null {
  const proxy = handle.block.children?.find((node) => node.tokens[0] === "reverse_proxy");
  if (!proxy) return null;
  const rewrite = proxy.children?.find((node) => node.tokens[0] === "rewrite");
  if (rewrite === undefined) return "api";
  const target = rewrite.tokens[1] ?? "";
  if (target.startsWith("/api/cards/post/")) return "post";
  if (target.startsWith("/api/cards/profile/")) return "profile";
  throw new Error(`a page handle that asks the API for something this reader does not know: ${rewrite.tokens.join(" ")}`);
}

/** The `respond <body> <status>` of a handle that answers by itself, with its header lines; null for any other handle. */
function ownAnswer(handle: Handle): { status: number; body: string; headers: Record<string, string> } | null {
  // A respond with a matcher (respond @push 403) answers only the push network, which the walk never is.
  const respond = handle.block.children?.find((node) => node.tokens[0] === "respond" && !node.tokens[1]?.startsWith("@"));
  if (!respond) return null;
  const headers: Record<string, string> = {};
  for (const node of handle.block.children ?? []) {
    const [directive, name, value, ...rest] = node.tokens;
    if (directive === "header" && name !== undefined && value !== undefined && rest.length === 0 && !name.startsWith("-") && !name.startsWith("@")) headers[name] = value;
  }
  return { status: Number(respond.tokens[2] ?? 200), body: respond.tokens[1] ?? "", headers };
}

/** Where the site sends a request for `pathname`. */
export function appRoute(siteBlock: CaddyNode, pathname: string): AppRoute {
  const handle = routeFor(siteBlock, pathname);
  const proxy = proxies(handle);
  if (proxy === "api") return { kind: "api" };
  if (proxy === "post" || proxy === "profile") return { kind: proxy };
  const own = ownAnswer(handle);
  if (own) return { kind: "own", ...own };
  return { kind: "files" };
}

/**
 * The response headers a handle's lines set for `pathname`: every `header { ... }` block (the imported app_page_headers),
 * every unconditional `header Name value` line, and each `header @matcher Name value` whose matcher takes the path, which
 * is what Caddy matches on (the header directive runs before try_files). Deletions such as -Server set nothing.
 */
function headersOf(block: CaddyNode): (pathname: string, isFile: boolean) => Record<string, string> {
  const matchers = pathMatchers(block);
  const always: Record<string, string> = {};
  const conditional: { matcher: PathMatcher; name: string; value: string }[] = [];
  const unknown = (node: CaddyNode) => new Error(`a header line the reader does not know: ${node.tokens.join(" ")}`);
  for (const node of block.children ?? []) {
    if (node.tokens[0] !== "header") continue;
    if (node.children !== undefined) {
      if (node.tokens.length !== 1) throw unknown(node);
      for (const field of node.children) {
        const [name, value, ...rest] = field.tokens;
        if (name === undefined || (name.startsWith("-") && value === undefined)) continue;
        if (value === undefined || rest.length > 0 || name.startsWith("-") || name.startsWith("+") || name.startsWith("?")) throw unknown(field);
        always[name] = value;
      }
      continue;
    }
    const [, first, second, third, ...rest] = node.tokens;
    if (first?.startsWith("@")) {
      const matcher = matchers.get(first);
      if (!matcher || second === undefined || third === undefined || rest.length > 0) throw unknown(node);
      conditional.push({ matcher, name: second, value: third });
    } else if (first !== undefined && !(first.startsWith("-") && second === undefined)) {
      if (second === undefined || third !== undefined) throw unknown(node);
      always[first] = second;
    }
  }
  return (pathname, isFile) => {
    const headers = { ...always };
    for (const { matcher, name, value } of conditional) if (matcherTakes(matcher, pathname, isFile)) headers[name] = value;
    return headers;
  };
}

/**
 * The headers the app's site sends with a page or a file: those of the handle the path reaches (the post's page handle
 * for /post/*, 2d's profile's page handle for /u/*, the files' handle for everything else that is not the API). `isFile` says whether the path names a file of
 * the export, for a matcher with `file`.
 */
export function appSiteHeadersFromCaddyfile(tree: CaddyNode[] = readCaddyfile()): (pathname: string, isFile: boolean) => Record<string, string> {
  const block = appSite(tree);
  const statics = handles(block).filter((h) => h.matcher === null);
  if (statics.length !== 1) throw new Error(`the app site needs exactly one handle without a matcher, the files; it has ${statics.length}`);
  const files = headersOf(statics[0]!.block);
  const posts = headersOf(routeFor(block, "/post/x").block);
  const profiles = headersOf(routeFor(block, "/u/x").block);
  return (pathname, isFile) => {
    const kind = appRoute(block, pathname).kind;
    return kind === "post" ? posts(pathname, isFile) : kind === "profile" ? profiles(pathname, isFile) : files(pathname, isFile);
  };
}
