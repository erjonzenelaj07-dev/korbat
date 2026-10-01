// `pnpm --filter @korbat/admin dev [--port <number>]`: the staff console beside the README's quick start. esbuild
// rebuilds dist/ on every change, with the production build's own options, and the development server serves it on
// 127.0.0.1:8090 with the console site's headers, forwarding /api/staff/* to the API at http://localhost:3000 with the
// Host header kept. Open it at http://localhost:8090, never 127.0.0.1: browsers refuse WebAuthn on an IP address, and
// the API's CONSOLE_ORIGIN (apps/api/.env) must name the same port.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";
import { buildOptions } from "./build.mjs";
import { createDevServer, parsePort } from "./dev-server.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const API = "http://localhost:3000";

let port;
try {
  port = parsePort(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, "assets"), { recursive: true });
const builder = await context(buildOptions(DIST));
await builder.watch();

const server = createDevServer({ dist: DIST, api: API });
server.listen(port, "127.0.0.1", () => {
  console.log(`The staff console: http://localhost:${port} (forwarding /api/staff/* to ${API}; CONSOLE_ORIGIN must be http://localhost:${port})`);
});

const stop = async () => {
  server.close();
  await builder.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
