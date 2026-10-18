import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDevServer } from "../dev-server.mjs";
import { CONSOLE_CSP, consoleSiteHeaders, isHashedPath } from "../site-headers.mjs";
import {
  APP_SITE,
  caddyOrder,
  CONSOLE_SITE,
  consoleSiteHeadersFromCaddyfile,
  handles,
  lines,
  matcherTakes,
  parseCaddyfile,
  pathMatchers,
  readCaddyfile,
  routeFor,
  site,
  type CaddyNode,
  type Handle,
} from "./caddyfile";

/**
 * Caddy's console site (3a design, sections 8 and 13, Task 7) against the console's own definition of its headers,
 * site-headers.mjs, which the development server sends: the two cannot drift, so the console runs locally under the policy
 * it runs under in production. Also the console site's routes, the app site's refusal of the staff API, and how the image,
 * Compose and infra/.env.example carry the console.
 */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

/** The paths the page, the router's addresses, the icon and the hashed files are asked for at, and a hashed name the build does not hold. */
const PATHS = ["/", "/index.html", "/signin", "/audit", "/enroll/abc", "/no/such/page", "/favicon.svg", "/assets/main-ABCDEFGH.js", "/assets/main-ABCDEFGH.css", "/assets/main-MISSING0.js"];
/** Those of the paths that name a file of the build; every other is answered with index.html. */
const FILES = new Set(["/index.html", "/favicon.svg", "/assets/main-ABCDEFGH.js", "/assets/main-ABCDEFGH.css"]);
/**
 * The headers site-headers.mjs gives the answer to `p`, as the development server asks for them: for the path itself when
 * it names a file, and for the page ("/") when index.html is answered in its place.
 */
const devHeaders = (p: string) => consoleSiteHeaders(FILES.has(p) ? p : "/");

/** The answer of a handle that refuses a path: Caddy's own 404 in the API's error envelope, never a proxy. */
function expectRefusal(handle: Handle) {
  const block = lines(handle.block);
  const respond = handle.block.children?.find((node) => node.tokens[0] === "respond");
  expect(respond?.tokens.length, block.join(" | ")).toBe(3);
  expect(respond!.tokens[2]).toBe("404");
  expect(JSON.parse(respond!.tokens[1]!)).toEqual({ error: { code: "not_found", message: "No such route" } });
  expect(block).toContain("header Content-Type application/json");
  expect(block).toContain("header Cache-Control no-store");
  expect(block).toContain("header -Server");
  expect(block.some((line) => line.startsWith("reverse_proxy"))).toBe(false);
}

describe("the reader of the Caddyfile", () => {
  test("reads blocks, quoted values, matchers and snippets, and drops comments", () => {
    const tree = parseCaddyfile(
      [
        "(refuse) {",
        "  respond `{\"a\": 1}` 404",
        "}",
        ":1 {",
        "  # a comment {",
        "  @m path /a/* /b",
        "  handle @m {",
        "    import refuse",
        "  }",
        "  handle {",
        "    header {",
        '      X-One "a; b c"',
        "      -Server",
        "    }",
        "    import /etc/some.caddy",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(tree.map((node) => node.tokens)).toEqual([[":1"]]);
    const one = site(tree, ":1");
    const [first, second] = handles(one);
    expect(first!.match).toEqual({ paths: ["/a/*", "/b"], file: false, not: false });
    expect(lines(first!.block)).toEqual(['respond {"a": 1} 404']);
    expect(second!.matcher).toBeNull();
    expect(lines(second!.block)).toEqual(["header", "X-One a; b c", "-Server", "import /etc/some.caddy"]);
  });

  test("reads path matchers with and without file, negated on one line or in a block, and evaluates them", () => {
    const block = site(
      parseCaddyfile([":1 {", "  @a path /x/*", "  @b {", "    path /x/*", "    file", "  }", "  @c {", "    not {", "      path /x/*", "      file", "    }", "  }", "  @d {", "    not path /x/*", "  }", "  @e header X-A b", "}"].join("\n")),
      ":1",
    );
    const m = pathMatchers(block);
    expect(m.get("@b")).toEqual({ paths: ["/x/*"], file: true, not: false });
    expect(m.get("@c")).toEqual({ paths: ["/x/*"], file: true, not: true });
    expect(m.get("@d")).toEqual({ paths: ["/x/*"], file: false, not: true });
    expect(m.get("@e")).toBeNull();
    const takes = (name: string, p: string, isFile: boolean) => matcherTakes(m.get(name), p, isFile);
    expect([takes("@a", "/x/y", false), takes("@b", "/x/y", false), takes("@b", "/x/y", true), takes("@c", "/x/y", false), takes("@c", "/x/y", true), takes("@c", "/z", true)]).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
    ]);
    expect(() => matcherTakes(m.get("@e"), "/x")).toThrow(/cannot evaluate/);
  });

  test("refuses a block left open or closed twice, and an unclosed quote", () => {
    expect(() => parseCaddyfile(":1 {\n")).toThrow(/open/);
    expect(() => parseCaddyfile("}\n")).toThrow(/never opened/);
    expect(() => parseCaddyfile(':1 {\n  respond "x 404\n}\n')).toThrow(/quote/);
  });

  test("orders handles as Caddy 2.11.4 does: one path most specific first, matchers before none, written order otherwise", () => {
    const order = (text: string) => caddyOrder(handles(site(parseCaddyfile(text), ":1"))).map((h) => h.matcher ?? "none");
    expect(order([":1 {", "  handle /api/* {", "  }", "  handle /api/staff {", "  }", "  handle /api/staff/* {", "  }", "  handle {", "  }", "}"].join("\n"))).toEqual([
      "/api/staff/*",
      "/api/staff",
      "/api/*",
      "none",
    ]);
    // What `caddy adapt` printed for this site on Caddy 2.11.4: a matcher with two paths compares equal to both
    // one-path handles, so the more specific /api/staff/* stays behind /api/* (the comparison is not transitive).
    expect(
      order([":1 {", "  handle /api/* {", "  }", "  @staff path /api/staff /api/staff/*", "  handle @staff {", "  }", "  handle /api/staff/* {", "  }", "  handle {", "  }", "}"].join("\n")),
    ).toEqual(["/api/*", "@staff", "/api/staff/*", "none"]);
  });
});

describe("the console site sends exactly the headers the development server sends", () => {
  test("the CSP of section 3, the one site-headers.mjs defines", () => {
    expect(consoleSiteHeadersFromCaddyfile()("/", false)["Content-Security-Policy"]).toBe(CONSOLE_CSP);
  });

  test("every header, for the page, the router's addresses, the icon and the hashed files", () => {
    const headersFor = consoleSiteHeadersFromCaddyfile();
    for (const p of PATHS) expect(headersFor(p, FILES.has(p)), p).toEqual(devHeaders(p));
  });

  test("the page is neither stored nor transformed, and only the hashed files are kept, for a year", () => {
    const headersFor = consoleSiteHeadersFromCaddyfile();
    for (const p of PATHS) {
      const hashedFile = FILES.has(p) && isHashedPath(p);
      expect(headersFor(p, FILES.has(p))["Cache-Control"], p).toBe(hashedFile ? "public, max-age=31536000, immutable" : "no-store, no-transform");
    }
    // The page answered for a hashed name the build does not hold is a page like any other, never kept under that name.
    expect(headersFor("/assets/main-MISSING0.js", false)["Cache-Control"]).toBe("no-store, no-transform");
    expect(headersFor("/assets/main-ABCDEFGH.js", true)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  });

  test("the development server takes its headers from site-headers.mjs and spells no policy of its own", () => {
    const devServer = read("apps", "admin", "dev-server.mjs");
    expect(devServer).toContain('import { consoleSiteHeaders } from "./site-headers.mjs";');
    expect(devServer).toMatch(/res\.writeHead\(200, \{ \.\.\.consoleSiteHeaders\(served\),/);
    expect(devServer).not.toMatch(/Content-Security-Policy|default-src|trusted-types|Permissions-Policy|immutable/i);
  });

  describe("and the development server's answers carry the Caddyfile's console headers", () => {
    let dist = "";
    let dev: Server;
    let base = "";

    beforeAll(async () => {
      dist = mkdtempSync(path.join(tmpdir(), "korbat-admin-site-"));
      mkdirSync(path.join(dist, "assets"));
      writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>console</title>");
      writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
      writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.js"), "console.log(1)");
      writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.css"), "body{}");
      // No API answers here: only static files are asked for.
      dev = createDevServer({ dist, api: "http://127.0.0.1:9" });
      await new Promise<void>((resolve) => dev.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(dev.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => dev.close(resolve));
      rmSync(dist, { recursive: true, force: true });
    });

    test("the same headers, and no other, on every static answer", async () => {
      const headersFor = consoleSiteHeadersFromCaddyfile();
      // What any HTTP server adds about the answer itself, beside the site's headers.
      const own = new Set(["content-type", "content-length", "date", "connection", "keep-alive", "transfer-encoding"]);
      for (const p of PATHS.filter((p) => p !== "/index.html")) {
        const res = await fetch(`${base}${p}`);
        expect(res.status, p).toBe(200);
        const expected = Object.fromEntries(Object.entries(headersFor(p, FILES.has(p))).map(([name, value]) => [name.toLowerCase(), value]));
        const sent = Object.fromEntries([...res.headers.entries()].filter(([name]) => !own.has(name)));
        expect(sent, p).toEqual(expected);
      }
    });
  });
});

describe("the console site's routes", () => {
  const consoleSite = () => site(readCaddyfile(), CONSOLE_SITE);

  test("the push network's refusal (3f), the staff API, then the rest of the API, then the console's files, whatever order Caddy sorts them in", () => {
    const routes = caddyOrder(handles(consoleSite()));
    expect(routes.map((route) => route.match ?? null)).toEqual([
      { paths: [], file: false, not: false, remoteIp: ["{$PUSH_SUBNET}"] },
      { paths: ["/api/staff", "/api/staff/*"], file: false, not: false },
      { paths: ["/api", "/api/*"], file: false, not: false },
      null,
    ]);
    // A client from the push network gets 403 and reaches nothing; the readers' requests never come from there.
    const push = routes[0]!;
    expect(lines(push.block)).toEqual(["header -Server", "respond 403"]);
    for (const p of ["/", "/api/staff/me", "/api/me"]) expect(routeFor(consoleSite(), p).matcher, p).not.toBe("@push");
  });

  test("3f: on the app's site the API proxy and the app's files each answer a client from the push network 403 first", () => {
    const app = site(readCaddyfile(), APP_SITE);
    expect(lines(app)).toContain("@push remote_ip {$PUSH_SUBNET}");
    expect(lines(routeFor(app, "/api/me").block)).toContain("respond @push 403");
    expect(lines(routeFor(app, "/").block)).toContain("respond @push 403");
  });

  test("/api/staff and /api/staff/* go to the API as on the app's site: 64KB bodies, no Server header, cf-header, the browser's Host", () => {
    for (const p of ["/api/staff", "/api/staff/me", "/api/staff/sessions/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", "/api/staff/enroll/options"]) {
      expect(routeFor(consoleSite(), p).match?.paths, p).toEqual(["/api/staff", "/api/staff/*"]);
    }
    const staff = routeFor(consoleSite(), "/api/staff/me").block;
    const body = staff.children?.find((node) => node.tokens[0] === "request_body");
    expect(body?.tokens).toEqual(["request_body"]);
    expect(lines(body!)).toEqual(["max_size 64KB"]);
    expect(lines(staff)).toContain("header -Server");
    const proxy = staff.children?.find((node) => node.tokens[0] === "reverse_proxy");
    expect(proxy?.tokens).toEqual(["reverse_proxy", "api:3000"]);
    // The import sits inside reverse_proxy, where header_up lines belong: a client-set CF-Connecting-IP is dropped unless TUNNEL=on.
    expect(lines(proxy!)).toEqual(["import /etc/caddy/cf-header.caddy"]);
    // The staff gate compares the Host the browser sent with CONSOLE_ORIGIN, so Caddy sets no Host of its own.
    expect(lines(staff).filter((line) => /header_up|header_down|transport|X-Forwarded/i.test(line))).toEqual([]);
  });

  test("any other path of the API is Caddy's own 404 and never reaches the API", () => {
    for (const p of ["/api", "/api/me", "/api/auth/signin", "/api/staffx", "/api/media"]) {
      const route = routeFor(consoleSite(), p);
      expect(route.match?.paths, p).toEqual(["/api", "/api/*"]);
      expectRefusal(route);
    }
  });

  test("everything else is the console's files from /console, outside the app's /srv, with index.html as the fallback, gzipped", () => {
    for (const p of ["/", "/signin", "/audit", "/enroll/abc", "/assets/main-ABCDEFGH.js", "/favicon.svg", "/apix"]) expect(routeFor(consoleSite(), p).matcher, p).toBeNull();
    const files = lines(routeFor(consoleSite(), "/").block);
    expect(files).toContain("root * /console");
    expect(files).toContain("encode gzip");
    expect(files).toContain("try_files {path} /index.html");
    expect(files).toContain("file_server");
    expect(files).toContain("-Server");
  });

  test("the app's site serves nothing from /console", () => {
    expect(lines(site(readCaddyfile(), APP_SITE)).filter((line) => line.includes("/console"))).toEqual([]);
  });
});

describe("the app's site refuses the staff API ahead of its API proxy", () => {
  const appSite = () => site(readCaddyfile(), APP_SITE);

  test("/api/staff and /api/staff/* reach a 404 of Caddy's own, whatever order Caddy sorts the handles in", () => {
    for (const p of ["/api/staff", "/api/staff/", "/api/staff/me", "/api/staff/signin/options", "/api/staff/sessions/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"]) {
      expectRefusal(routeFor(appSite(), p));
    }
  });

  test("every other API path still reaches the API, and the rest the app's files", () => {
    for (const p of ["/api/me", "/api/auth/signin", "/api/media", "/api/staffx", "/api/staff-notes"]) {
      const route = routeFor(appSite(), p);
      expect(route.match?.paths, p).toEqual(["/api/*"]);
      expect(lines(route.block), p).toContain("reverse_proxy api:3000");
    }
    expect(lines(routeFor(appSite(), "/").block)).toContain("root * /srv");
  });

  test("the refusals match one path each, longer than /api/*, so Caddy sorts them first by its documented rule as well", () => {
    const refusals = handles(appSite()).filter((h) => h.match?.paths.some((p) => p.startsWith("/api/staff")));
    expect(refusals.map((h) => h.match?.paths)).toEqual(expect.arrayContaining([["/api/staff"], ["/api/staff/*"]]));
    expect(refusals).toHaveLength(2);
    const order = caddyOrder(handles(appSite())).map((h) => h.matcher);
    expect(order.indexOf("/api/*")).toBeGreaterThan(Math.max(order.indexOf("/api/staff"), order.indexOf("/api/staff/*")));
  });
});

describe("the image carries the console", () => {
  const dockerfile = () => read("infra", "caddy", "Dockerfile");
  /** The lines of one build stage, from its FROM to the next. */
  const stage = (name: string) => {
    const text = dockerfile();
    const start = text.search(new RegExp(`^FROM .+ AS ${name}$`, "m"));
    expect(start, `a stage named ${name}`).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\nFROM ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  test("the console is built in a stage of its own, from the same Node image as the app's, with only its own packages", () => {
    const web = stage("web");
    const admin = stage("console");
    expect(admin.split("\n")[0]!.replace(/ AS console$/, "")).toBe(web.split("\n")[0]!.replace(/ AS web$/, ""));
    expect(admin).toContain("COPY apps/admin ./apps/admin");
    expect(admin).not.toContain("COPY apps/app");
    expect(admin).toContain("RUN pnpm install --frozen-lockfile --filter @korbat/admin...");
    expect(admin).toContain("RUN pnpm --filter @korbat/admin build");
    // The page holds no build argument: nothing it is built from differs between instances.
    expect(admin).not.toMatch(/^ARG /m);
  });

  test("the final image serves the build from /console, outside the app's /srv, and exposes both sites' ports", () => {
    const text = dockerfile();
    expect(text).toContain("COPY --from=console /repo/apps/admin/dist /console");
    expect(text).toContain("COPY --from=web /repo/apps/app/dist /srv");
    expect(text).toMatch(/^EXPOSE 8080 8090 8091$/m);
    expect(text).toContain("RUN setcap -r /usr/bin/caddy");
  });

  test("3f: the push site hands ntfy the client's address in X-Forwarded-For, with the tunnel on or off", () => {
    // Behind the tunnel Caddy's client is cloudflared, so the X-Forwarded-For that Caddy writes would name cloudflared for
    // every phone, and ntfy, which reads that header (infra/ntfy/server.yml.example), would count all phones as one
    // visitor: 30 wrong tokens from anyone would then shut every phone out (lab L3). With TUNNEL=on the header takes
    // the value of CF-Connecting-IP, which cloudflared sets; with it off Caddy's own value stands.
    expect(dockerfile()).toContain(
      'RUN if [ "$TUNNEL" = "on" ]; then echo "header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}" > /etc/caddy/push-header.caddy; else : > /etc/caddy/push-header.caddy; fi',
    );
    const push = site(readCaddyfile(), ":8091");
    const subscribe = push.children?.find((node) => node.tokens[0] === "handle" && node.tokens[1] === "@subscribe");
    const proxy = subscribe?.children?.find((node) => node.tokens[0] === "reverse_proxy");
    expect(proxy?.tokens).toEqual(["reverse_proxy", "ntfy:2586"]);
    expect(lines(proxy!)).toEqual(["import /etc/caddy/cf-header.caddy", "import /etc/caddy/push-header.caddy"]);
  });
});

describe("Compose and infra/.env.example carry the console", () => {
  /** One service's block of compose.yml: from its name to the next service's. */
  const service = (name: string) => {
    const compose = read("infra", "compose.yml");
    const start = compose.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = compose.slice(start + 1).search(/\n {2}[a-z]+:\n/);
    return compose.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  /** The comment lines right above a line of the file, joined into one text. */
  const commentAbove = (text: string, line: string) => {
    const all = text.split(/\r?\n/);
    const at = all.indexOf(line);
    expect(at, line).toBeGreaterThan(0);
    const comment: string[] = [];
    for (let i = at - 1; i >= 0 && all[i]!.trimStart().startsWith("#"); i--) comment.unshift(all[i]!.trim().replace(/^#\s?/, ""));
    return comment.join(" ");
  };

  test("the API gets the console's origin and relying party ID, empty by default", () => {
    const api = service("api");
    expect(api).toContain("CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}");
    expect(api).toContain("CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}");
  });

  test("Caddy's comment names its three ports", () => {
    const compose = read("infra", "compose.yml");
    const comment = commentAbove(compose, "  caddy:");
    expect(comment).toContain("8080");
    expect(comment).toContain("8090");
    // 3f: the phones' push site.
    expect(comment).toContain("8091");
  });

  test("the development stack publishes the console's site on localhost, on a port of its own", () => {
    const dev = read("infra", "compose.dev.yml");
    const caddy = dev.slice(dev.indexOf("\n  caddy:\n"), dev.indexOf("\n  mailpit:\n"));
    expect(caddy).toContain('"127.0.0.1:${DEV_CADDY_PORT:-8080}:8080"');
    expect(caddy).toContain('"127.0.0.1:${DEV_CONSOLE_PORT:-8090}:8090"');
    // 3f: and the push site, with the profile notify.
    expect(caddy).toContain('"127.0.0.1:${DEV_PUSH_PORT:-8091}:8091"');
  });

  test("infra/.env.example names the console's origin on the published port, and its development port", () => {
    const env = read("infra", ".env.example");
    expect(env).toMatch(/^API_CONSOLE_ORIGIN=http:\/\/localhost:8090$/m);
    expect(env).toMatch(/^API_CONSOLE_RP_ID=$/m);
    expect(env).toMatch(/^# DEV_CONSOLE_PORT=8090$/m);
    // The note that API_CONSOLE_ORIGIN names the same port on localhost.
    expect(commentAbove(env, "# DEV_CONSOLE_PORT=8090")).toMatch(/API_CONSOLE_ORIGIN must name the same port on localhost/);
    expect(commentAbove(env, "# DEV_PG_PORT=55432")).toMatch(/Defaults: 55432, 56379, 3000, 8080, 8090, 51025, 58025, 8091, 2586[.]/);
  });

  test("the passkey comment says the staff console does not use the app's RP ID, word for word", () => {
    const env = read("infra", ".env.example");
    expect(commentAbove(env, "API_WEBAUTHN_RP_ID=")).toBe(
      "Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent domain of that host (korbat.example for app.korbat.example). The staff console does not use it: staff keys have their own RP ID. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it later strands every passkey.",
    );
  });

  test("the TUNNEL_TOKEN note names the three hostnames and the port each points at", () => {
    const note = commentAbove(read("infra", ".env.example"), "TUNNEL_TOKEN=");
    expect(note).toContain("http://caddy:8080");
    expect(note).toContain("http://caddy:8090");
    expect(note).toMatch(/console/i);
    // 3f: the phones' push hostname.
    expect(note).toContain("http://caddy:8091");
    expect(note).toMatch(/push hostname/);
  });

  test("3f: the push network's default subnet, the one Caddy refuses, lies outside the address pools Docker draws its own networks from", () => {
    const compose = read("infra", "compose.yml");
    // Every default of PUSH_SUBNET in compose.yml: the network's and Caddy's, one value.
    const defaults = compose.split("${PUSH_SUBNET:-").slice(1).map((rest) => rest.slice(0, rest.indexOf("}")));
    expect(defaults.length).toBe(2);
    expect(new Set(defaults).size).toBe(1);
    const subnet = defaults[0]!;
    // infra/.env.example names the setting with the same default.
    expect(read("infra", ".env.example").split(String.fromCharCode(10))).toContain(`# PUSH_SUBNET=${subnet}`);
    const [address, bits] = subnet.split("/");
    const octets = (address ?? "").split(".").map(Number);
    expect(octets.length).toBe(4);
    const first = octets.reduce((sum, octet) => sum * 256 + octet, 0);
    const last = first + 2 ** (32 - Number(bits)) - 1;
    const range = (from: string, to: string) => [from, to].map((ip) => ip.split(".").map(Number).reduce((sum, octet) => sum * 256 + octet, 0));
    // Docker's default pools: 172.17.0.0/16 to 172.31.0.0/16, and 192.168.0.0/16 in /20s. A fixed subnet inside them
    // collides with a network Docker gave another project on the same host, and the stack does not start.
    for (const [from, to] of [range("172.17.0.0", "172.31.255.255"), range("192.168.0.0", "192.168.255.255")]) {
      expect(last < from! || first > to!, subnet).toBe(true);
    }
  });
});

/** Nothing in the console site's block is left for a later reader to guess at: every directive is one this test knows. */
test("the console site holds only the directives these tests check", () => {
  const known = new Set(["@staff", "@api", "@push", "handle"]);
  const top = (site(readCaddyfile(), CONSOLE_SITE).children ?? []).map((node: CaddyNode) => node.tokens[0]);
  expect(top.filter((name) => !known.has(name ?? ""))).toEqual([]);
});
