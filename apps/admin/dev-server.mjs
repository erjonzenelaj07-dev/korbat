// The console's development server (3a design, section 13, Task 6): it serves the build with the console site's headers
// and forwards /api/staff/* to the API, as Caddy's console site does in the stack. dev.mjs runs it beside esbuild's watch.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";
import { consoleSiteHeaders } from "./site-headers.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Headers that belong to one connection, never forwarded. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"]);

const isStaffApi = (pathname) => pathname === "/api/staff" || pathname.startsWith("/api/staff/");

/**
 * The file a request names inside `dist`, or null. The path is decoded once and must stay inside the folder: a dot
 * segment, an encoded slash or a backslash that would leave it is refused, and the page is served instead.
 */
async function fileFor(dist, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes(String.fromCharCode(0))) return null;
  const file = path.resolve(dist, `.${path.posix.normalize(decoded.split(path.sep).join("/"))}`);
  if (file !== dist && !file.startsWith(dist + path.sep)) return null;
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? file : null;
}

/** Answers with an error envelope, as the API would. */
function apiError(res, status, code, message) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: { code, message } }));
}

/**
 * The server: `dist` is the build's folder, `api` the API's origin. /api/staff and /api/staff/* go to the API with their
 * method, path, query, headers and body, and the Host header kept, so the staff gate sees the console's host as it does
 * behind Caddy; the API's answer comes back untouched. Any other /api path is 404. Everything else is a file of the
 * build with the console site's headers, and index.html for any path that is not one, so the router's pages load.
 */
export function createDevServer({ dist, api }) {
  const root = path.resolve(dist);
  const upstream = new URL(api);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://console.invalid");

    if (isStaffApi(url.pathname)) {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
      const forward = request({ host: upstream.hostname, port: upstream.port || 80, method: req.method, path: req.url, headers }, (answer) => {
        const back = Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
        res.writeHead(answer.statusCode ?? 502, back);
        answer.pipe(res);
      });
      forward.on("error", () => {
        if (!res.headersSent) apiError(res, 502, "internal", `The API at ${api} is not answering: start it with pnpm --filter @korbat/api dev.`);
        else res.destroy();
      });
      req.pipe(forward);
      return;
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return apiError(res, 404, "not_found", "Not found");

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }

    const file = (await fileFor(root, url.pathname)) ?? path.join(root, "index.html");
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return res.end("The console is still building; reload in a moment.");
    }
    // The page's headers go with every static answer; a hashed file is the only one kept for long.
    const served = file === path.join(root, "index.html") ? "/" : url.pathname;
    res.writeHead(200, { ...consoleSiteHeaders(served), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  });
}

/** The port from the command line: --port N or --port=N, 8090 by default. */
export function parsePort(args) {
  let port = 8090;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    let value;
    if (arg === "--port") value = args[++i];
    else if (arg.startsWith("--port=")) value = arg.slice("--port=".length);
    else throw new Error(`unknown argument ${arg}; the only one is --port <number>`);
    if (value === undefined || !/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error("--port needs a port number from 1 to 65535");
    port = Number(value);
  }
  return port;
}
