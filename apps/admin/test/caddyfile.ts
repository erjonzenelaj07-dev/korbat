import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A reader for infra/caddy/Caddyfile, just large enough for what it holds (3a design, sections 8 and 12): sites, snippets,
 * handle blocks with path matchers, and header lines. The console's tests read the console site from it, never from a
 * copy: the source scan compares its headers with site-headers.mjs, which the development server sends, and the browser
 * check serves the console with them, so the page is tested under the policy Caddy really sends.
 */
export const CADDYFILE = path.resolve(import.meta.dirname, "..", "..", "..", "infra", "caddy", "Caddyfile");

/** The two sites, by the port they listen on in the container. */
export const APP_SITE = ":8080";
export const CONSOLE_SITE = ":8090";

/** One line of the Caddyfile as tokens, and the lines of its block when it opens one. */
export interface CaddyNode {
  tokens: string[];
  children?: CaddyNode[];
}

/** A line's tokens: words, and "double-quoted" or `backtick-quoted` strings without their quotes; a # starting a token ends the line. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    const char = line[i]!;
    if (char === " " || char === "\t") {
      i++;
      continue;
    }
    if (char === "#") break;
    if (char === '"' || char === "`") {
      const end = line.indexOf(char, i + 1);
      if (end === -1) throw new Error(`an unclosed quote in the Caddyfile: ${line.trim()}`);
      tokens.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < line.length && line[end] !== " " && line[end] !== "\t") end++;
    tokens.push(line.slice(i, end));
    i = end;
  }
  return tokens;
}

/** The text as a tree of lines: a line ending in { opens a block, a lone } closes it. */
function parseTree(text: string): CaddyNode[] {
  const root: CaddyNode[] = [];
  const stack: CaddyNode[][] = [root];
  for (const line of text.split(/\r?\n/)) {
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const top = stack[stack.length - 1]!;
    if (tokens.length === 1 && tokens[0] === "}") {
      if (stack.length === 1) throw new Error("the Caddyfile closes a block it never opened");
      stack.pop();
      continue;
    }
    if (tokens[tokens.length - 1] === "{") {
      const node: CaddyNode = { tokens: tokens.slice(0, -1), children: [] };
      top.push(node);
      stack.push(node.children!);
      continue;
    }
    top.push({ tokens });
  }
  if (stack.length !== 1) throw new Error("the Caddyfile leaves a block open");
  return root;
}

/**
 * An import's name with Caddy's environment placeholders put in, as Caddy does when it reads the file: each {$NAME} or
 * {$NAME:default} becomes the variable's value from `env`, else its default, else nothing. 3f: the app's site is the
 * snippet APP_SITE names (app_site_{$APP_SITE:open}). Only an import's name is read so: the readers compare every other
 * placeholder, such as {$PUSH_SUBNET}, as written.
 */
function withEnvironment(name: string, env: Record<string, string>): string {
  return name.replace(/\{\$([A-Z_][A-Z0-9_]*)(?::([^}]*))?\}/g, (_all: string, key: string, fallback: string | undefined) => env[key] ?? fallback ?? "");
}

/** Each `import <snippet>` line replaced by the snippet's lines, as Caddy does; an import of a file, or of no snippet, stays a line. */
function expand(nodes: CaddyNode[], snippets: Map<string, CaddyNode[]>, env: Record<string, string>, depth = 0): CaddyNode[] {
  if (depth > 10) throw new Error("the Caddyfile's snippets import each other in a loop");
  return nodes.flatMap((node) => {
    if (node.tokens[0] === "import" && node.tokens.length === 2 && node.children === undefined) {
      const name = withEnvironment(node.tokens[1]!, env);
      if (snippets.has(name)) return expand(snippets.get(name)!, snippets, env, depth + 1);
      return [{ tokens: ["import", name] }];
    }
    return [node.children === undefined ? node : { tokens: node.tokens, children: expand(node.children, snippets, env, depth) }];
  });
}

/**
 * The Caddyfile as Caddy sees it: the global options block and the sites, with every snippet (a top-level `(name)` block)
 * imported where it is named and dropped from the top level.
 */
export function parseCaddyfile(text: string, env: Record<string, string> = {}): CaddyNode[] {
  const tree = parseTree(text);
  const snippets = new Map<string, CaddyNode[]>();
  for (const node of tree) {
    const name = /^\((.+)\)$/.exec(node.tokens[0] ?? "")?.[1];
    if (name !== undefined && node.children !== undefined && node.tokens.length === 1) snippets.set(name, node.children);
  }
  return expand(
    tree.filter((node) => !/^\(.+\)$/.test(node.tokens[0] ?? "")),
    snippets,
    env,
  );
}

/** The Caddyfile as Caddy reads it with these environment variables set (none: every placeholder takes its default). */
export function readCaddyfile(env: Record<string, string> = {}): CaddyNode[] {
  return parseCaddyfile(readFileSync(CADDYFILE, "utf8"), env);
}

/** The site block for an address such as :8090. */
export function site(tree: CaddyNode[], address: string): CaddyNode {
  const found = tree.filter((node) => node.children !== undefined && node.tokens.length === 1 && node.tokens[0] === address);
  if (found.length !== 1) throw new Error(`the Caddyfile has ${found.length} sites ${address}, not one`);
  return found[0]!;
}

/**
 * What a matcher matches: one of its paths and, with `file`, only when the path names a file under the site's root (Caddy's
 * file matcher without arguments); `not` negates the whole. Null in a map of matchers when it is none this reader knows.
 */
export interface PathMatcher {
  paths: string[];
  file: boolean;
  not: boolean;
  /**
   * 3f: the client addresses of a `remote_ip` matcher (the push network's subnet), which the readers' requests never come
   * from: such a matcher takes none of them, whatever their path.
   */
  remoteIp?: string[];
}

/** The conditions of one matcher, `path ...` with an optional `file`, as lines of tokens; null when they are anything else. */
function conditions(lines: string[][]): { paths: string[]; file: boolean } | null {
  const paths = lines.filter((tokens) => tokens[0] === "path");
  const file = lines.filter((tokens) => tokens.length === 1 && tokens[0] === "file");
  if (paths.length !== 1 || file.length > 1 || paths.length + file.length !== lines.length) return null;
  return { paths: paths[0]!.slice(1), file: file.length === 1 };
}

/**
 * Every named matcher of a block, by name: `@name path ...`, or a block holding `path ...` and optionally `file`, or one
 * `not path ...` line, or one `not { ... }` block of those.
 */
export function pathMatchers(block: CaddyNode): Map<string, PathMatcher | null> {
  const matchers = new Map<string, PathMatcher | null>();
  for (const node of block.children ?? []) {
    const name = node.tokens[0];
    if (!name?.startsWith("@")) continue;
    let matcher: PathMatcher | null = null;
    if (node.children === undefined && node.tokens[1] === "remote_ip" && node.tokens.length > 2) {
      matcher = { paths: [], file: false, not: false, remoteIp: node.tokens.slice(2) };
    } else if (node.children === undefined) {
      const found = conditions([node.tokens.slice(1)]);
      matcher = found && { ...found, not: false };
    } else if (node.children.length === 1 && node.children[0]!.tokens[0] === "not") {
      const not = node.children[0]!;
      const found = not.children === undefined ? conditions([not.tokens.slice(1)]) : not.tokens.length === 1 ? conditions(not.children.map((child) => child.tokens)) : null;
      matcher = found && { ...found, not: true };
    } else {
      const found = conditions(node.children.map((child) => child.tokens));
      matcher = found && { ...found, not: false };
    }
    matchers.set(name, matcher);
  }
  return matchers;
}

/** Caddy's path matching as this Caddyfile uses it: a trailing * matches any rest, otherwise the path must be equal. */
export function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

/**
 * Whether a matcher takes a request for `pathname`, where `isFile` says whether the path names a file under the site's
 * root (only a matcher with `file` asks). No matcher takes every request.
 */
export function matcherTakes(matcher: PathMatcher | null | undefined, pathname: string, isFile = false): boolean {
  if (matcher === undefined) return true;
  if (matcher === null) throw new Error("a matcher this reader cannot evaluate");
  const inner = matcher.paths.some((pattern) => pathMatches(pattern, pathname)) && (!matcher.file || isFile);
  return matcher.not ? !inner : inner;
}

/** One handle block of a site: its matcher token as written (an inline path, an @name, or none), what it matches, and its lines. */
export interface Handle {
  matcher: string | null;
  match: PathMatcher | undefined;
  block: CaddyNode;
}

/** A site's handle blocks in the order they are written. */
export function handles(siteBlock: CaddyNode): Handle[] {
  const named = pathMatchers(siteBlock);
  return (siteBlock.children ?? [])
    .filter((node) => node.tokens[0] === "handle" && node.children !== undefined)
    .map((block) => {
      const matcher = block.tokens[1] ?? null;
      if (matcher === null) return { matcher, match: undefined, block };
      if (matcher.startsWith("@")) {
        const match = named.get(matcher);
        if (!match) throw new Error(`the handle's matcher ${matcher} is not a path matcher this reader knows`);
        return { matcher, match, block };
      }
      // An inline matcher: the paths written after the directive's name.
      return { matcher, match: { paths: block.tokens.slice(1), file: false, not: false }, block };
    });
}

/**
 * Caddy's order for same-named directives (caddyconfig/httpcaddyfile/directives.go, sortRoutes), which decides which
 * handle a request reaches. Two directives that each match exactly one path go most specific first: the longer path,
 * trailing * left out (the shorter one when the two differ only by it). Otherwise one with a matcher goes before one
 * without, and two with matchers keep the order they are written in. Caddy runs Go's stable sort with that comparison,
 * which for a site's few handles is an insertion sort, so it is one here too: the comparison is not transitive when single
 * and multi-path matchers are mixed, and only the same steps give the same order (the test of this reader pins one such
 * order that `caddy adapt` gave on Caddy 2.11.4).
 */
export function caddyOrder(list: Handle[]): Handle[] {
  // Caddy compares the path of a handle whose one matcher set holds one path; a negated or file matcher is not that.
  const single = (h: Handle) => (h.match !== undefined && !h.match.not && !h.match.file && h.match.paths.length === 1 ? h.match.paths[0]! : null);
  const less = (i: Handle, j: Handle): boolean => {
    const a = single(i);
    const b = single(j);
    if (a !== null && b !== null) {
      const at = a.endsWith("*") ? a.slice(0, -1) : a;
      const bt = b.endsWith("*") ? b.slice(0, -1) : b;
      if (at === bt) return a.length < b.length;
      if (at.length === bt.length) return at < bt;
      return at.length > bt.length;
    }
    return i.matcher !== null && j.matcher === null;
  };
  const out = [...list];
  for (let i = 1; i < out.length; i++) {
    for (let j = i; j > 0 && less(out[j]!, out[j - 1]!); j--) [out[j], out[j - 1]] = [out[j - 1]!, out[j]!];
  }
  return out;
}

/** The handle of a site that a request for `pathname` reaches: the first in Caddy's order whose matcher takes it. */
export function routeFor(siteBlock: CaddyNode, pathname: string): Handle {
  const found = caddyOrder(handles(siteBlock)).find((h) => matcherTakes(h.match, pathname));
  if (!found) throw new Error(`no handle of the site takes ${pathname}`);
  return found;
}

/** Every line of a block, its own and its children's, as text, tokens joined by one space. */
export function lines(node: CaddyNode): string[] {
  return (node.children ?? []).flatMap((child) => [child.tokens.join(" "), ...lines(child)]);
}

/**
 * The response headers the console site sets on a static answer to `pathname`: the `header` block of its handle without a
 * matcher (the static files), and each `header @matcher Name value` line whose matcher takes the request's path, which is
 * what Caddy matches on (the header directive runs before try_files). `isFile` says whether the path names a file of the
 * build, for a matcher with `file`. Deletions such as -Server set nothing.
 */
export function consoleSiteHeadersFromCaddyfile(tree: CaddyNode[] = readCaddyfile()): (pathname: string, isFile: boolean) => Record<string, string> {
  const statics = handles(site(tree, CONSOLE_SITE)).filter((h) => h.matcher === null);
  if (statics.length !== 1) throw new Error(`the console site needs exactly one handle without a matcher, the static files; it has ${statics.length}`);
  const block = statics[0]!.block;
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
