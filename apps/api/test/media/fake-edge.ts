import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One request the stand-in took: its method, its path, the prefixes of its body and whether a bearer token came, never the token. */
export interface EdgeRequest {
  method: string;
  path: string;
  contentType: string | null;
  /** The body's prefixes, or null when the body was not the purge's JSON. */
  prefixes: string[] | null;
  bearer: boolean;
}

/**
 * How the stand-in answers: as the provider does when it takes a purge (`ok`), with a server error (`error`), with a 200
 * whose body says it failed (`refused`), with 403 as for a token it does not accept (`forbidden`), or not at all, holding
 * the request open until it is closed (`hang`).
 */
export type EdgeAnswer = "ok" | "error" | "refused" | "forbidden" | "hang";

/**
 * fakeEdge() (3d design, section 12; Task 3): a local HTTP server that stands in for the edge provider's purge route. It
 * records each request, with whether an Authorization header carried a bearer token and never its value, and answers as
 * it is told. Its `apiBase` is what the cloudflare adapter is given in place of the provider's address.
 */
export async function fakeEdge(): Promise<{
  apiBase: string;
  requests: EdgeRequest[];
  answer(how: EdgeAnswer): void;
  close(): Promise<void>;
}> {
  const requests: EdgeRequest[] = [];
  const open = new Set<ServerResponse>();
  let how: EdgeAnswer = "ok";
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let prefixes: string[] | null = null;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { prefixes?: unknown };
        if (Array.isArray(body.prefixes) && body.prefixes.every((p) => typeof p === "string")) prefixes = body.prefixes as string[];
      } catch {
        prefixes = null;
      }
      const authorization = req.headers.authorization ?? "";
      requests.push({ method: req.method ?? "", path: req.url ?? "", contentType: req.headers["content-type"] ?? null, prefixes, bearer: /^Bearer [^ ]+$/.test(authorization) });
      if (how === "hang") {
        open.add(res);
        return;
      }
      const status = how === "error" ? 500 : how === "forbidden" ? 403 : 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: how === "ok", errors: how === "ok" ? [] : [{ code: 1000, message: "refused by the stand-in" }], messages: [], result: how === "ok" ? { id: "stand-in" } : null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    apiBase: `http://127.0.0.1:${port}/client/v4`,
    requests,
    answer(next) {
      how = next;
    },
    async close() {
      for (const res of open) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
