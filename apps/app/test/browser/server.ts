import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { IMPORT_RULES } from "@korbat/contracts";
import { appRoute, appSite, appSiteHeadersFromCaddyfile } from "./caddyfile";

/**
 * Caddy's app site as the browser check needs it (UI design, section 12.3), in a small Node server that takes its routes
 * and headers from infra/caddy/Caddyfile: a path the site proxies to the API goes to the fixture API; a post's page is
 * the export's index.html under the status the fixture API gives the post (204 gives 200, 404 gives 404, anything else
 * 200), as Caddy's /post/* handle asks GET /api/cards/post/<id> (2d Task 6; the status route before it), and a profile's
 * page the same under the status it gives the profile, as the /u/* handle asks GET /api/cards/profile/<handle>; the check
 * serves index.html for both, since Caddy's card.html is the image's and is drawn by the card lab; everything else is a file of the export, with
 * index.html for a path that names none (try_files), sent with the headers the site sets for the path asked for. With
 * `holdBundle` the entry bundle is answered two seconds late, so the walk can look at the first paint, which only
 * theme-boot.js has drawn. The page is opened at http://localhost:<port>, never 127.0.0.1: browsers refuse WebAuthn on an
 * address.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/** The largest JSON body the app site lets through to the API (request_body max_size 64KB; Caddy's KB is 1000 bytes). */
const BODY_LIMIT = 64 * 1000;

/**
 * 3b Task 7: an import's chunk, which the Caddyfile's @import_chunk lets through at 9MB (decimal megabytes, the contracts'
 * IMPORT_RULES.chunkBodyBytes), the one body besides an image upload larger than BODY_LIMIT; every other body stays at it.
 */
const CHUNK_ROUTE = /^\/api\/imports\/[0-9a-f-]{36}\/archive$/;
const limitFor = (method: string | undefined, pathname: string): number => (method === "PUT" && CHUNK_ROUTE.test(pathname) ? IMPORT_RULES.chunkBodyBytes : BODY_LIMIT);

/** How long the entry bundle waits when it is held back. */
export const HOLD_MS = 2000;

/** Hands one API request to the fixtures, with its body read. */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer) => Promise<void>;

/** What the fixture API says of a post's status, as GET /api/cards/post/<id> would: 204 shown, 404 not. */
export type PostStatus = (id: string) => number;

/** 2d Task 6: what it says of a profile's, as GET /api/cards/profile/<handle> would: 204 for a profile it answers, 404 not. */
export type ProfileStatus = (handle: string) => number;

export interface AppSiteServer {
  origin: string;
  /** Holds the entry bundle back two seconds while true. */
  state: { holdBundle: boolean };
  close(): Promise<void>;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The file a path names inside `dist`, or null: decoded once, and never outside the folder. */
async function fileFor(dist: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(dist, `.${path.posix.normalize(decoded)}`);
  if (!file.startsWith(dist + path.sep)) return null;
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? file : null;
}

export async function startAppSite(options: { dist: string; api: ApiHandler; postStatus: PostStatus; profileStatus: ProfileStatus }): Promise<AppSiteServer> {
  const dist = path.resolve(options.dist);
  const block = appSite();
  const headersFor = appSiteHeadersFromCaddyfile();
  const state = { holdBundle: false };

  async function sendFile(req: IncomingMessage, res: ServerResponse, url: URL, file: string, named: boolean, status = 200): Promise<void> {
    const info = await stat(file);
    if (state.holdBundle && url.pathname.startsWith("/_expo/static/js/")) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    res.writeHead(status, { ...headersFor(url.pathname, named), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = appRoute(block, url.pathname);
      if (route.kind === "api") {
        const body = await readBody(req, limitFor(req.method, url.pathname));
        if (body === null) {
          res.writeHead(413).end();
          return;
        }
        await options.api(req, res, url, body);
        return;
      }
      if (route.kind === "own") {
        res.writeHead(route.status, route.headers).end(route.body);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      if (route.kind === "post" || route.kind === "profile") {
        // The second segment of the path, as Caddy's {http.request.uri.path.1} gives it: a post's id or a profile's handle.
        const segment = url.pathname.split("/")[2] ?? "";
        const status = route.kind === "post" ? options.postStatus(segment) : options.profileStatus(segment);
        await sendFile(req, res, url, path.join(dist, "index.html"), false, status === 404 ? 404 : 200);
        return;
      }
      const named = await fileFor(dist, url.pathname);
      await sendFile(req, res, url, named ?? path.join(dist, "index.html"), named !== null);
    })().catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
