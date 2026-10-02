import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { CONSOLE_SITE, consoleSiteHeadersFromCaddyfile, lines, readCaddyfile, routeFor, site } from "../caddyfile";

/**
 * Caddy's console site as the browser check needs it (3a design, sections 8 and 12), in a small Node server that takes
 * its routes and headers from infra/caddy/Caddyfile: a path the site proxies to the API goes to the fixture API, a path it
 * answers itself gets that answer, and everything else is a file of the build, with index.html for a path that names
 * none (try_files), sent with the headers the console site sets for the path asked for. The page is opened at
 * http://localhost:<port>, never 127.0.0.1, since browsers refuse WebAuthn on an IP address.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** The largest body the console site lets through to the staff API (request_body max_size 64KB; Caddy's KB is 1000 bytes). */
const BODY_LIMIT = 64 * 1000;

export interface ConsoleSiteServer {
  origin: string;
  close(): Promise<void>;
}

/** Hands one request under the staff API to the fixtures, with its body read. */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer) => Promise<void>;

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks)));
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

/**
 * What a handle that answers by itself sends: its `respond <body> <status>` and the `header Name value` lines beside it.
 * Null for a handle that does not answer by itself.
 */
function ownAnswer(block: ReturnType<typeof routeFor>["block"]): { status: number; body: string; headers: Record<string, string> } | null {
  const respond = block.children?.find((node) => node.tokens[0] === "respond");
  if (!respond) return null;
  const headers: Record<string, string> = {};
  for (const line of lines(block)) {
    const [directive, name, value, ...rest] = line.split(" ");
    if (directive === "header" && name !== undefined && value !== undefined && rest.length === 0 && !name.startsWith("-")) headers[name] = value;
  }
  return { status: Number(respond.tokens[2]), body: respond.tokens[1] ?? "", headers };
}

export async function startConsoleSite(options: { dist: string; api: ApiHandler }): Promise<ConsoleSiteServer> {
  const dist = path.resolve(options.dist);
  const consoleSite = site(readCaddyfile(), CONSOLE_SITE);
  const headersFor = consoleSiteHeadersFromCaddyfile();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handle = routeFor(consoleSite, url.pathname);

      // The staff API: the handle that proxies to api:3000.
      if (handle.block.children?.some((node) => node.tokens[0] === "reverse_proxy")) {
        const body = await readBody(req);
        if (body === null) {
          res.writeHead(413).end();
          return;
        }
        await options.api(req, res, url, body);
        return;
      }

      // Any other API path: the site's own answer.
      const own = ownAnswer(handle.block);
      if (own) {
        res.writeHead(own.status, own.headers).end(own.body);
        return;
      }

      // The console's files. file_server answers only GET and HEAD.
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const named = await fileFor(dist, url.pathname);
      const file = named ?? path.join(dist, "index.html");
      const info = await stat(file);
      // Caddy matches the header lines on the path asked for, before try_files picks the file; its file matcher holds
      // when that path names a file of the build.
      res.writeHead(200, { ...headersFor(url.pathname, named !== null), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
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
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
