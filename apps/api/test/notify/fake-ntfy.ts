import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * A stand-in for the push server (3f design, section 12, `fakeNtfy`): an HTTP server that records each publish (topic,
 * priority, tag, title, text and token) and answers 200 with ntfy's message JSON. It can be told to fail: to refuse the
 * next requests with a status, for a number of them or for a time, or to drop them without an answer.
 */
export interface Publish {
  topic: string;
  priority: string | null;
  tags: string | null;
  title: string | null;
  text: string;
  /** The bearer token the request carried, or null. */
  token: string | null;
  method: string;
}

export interface FakeNtfy {
  /** The base URL the publisher posts to, as http://ntfy:2586 is in the stack. */
  url: string;
  /** Every publish the server answered 200, in order. */
  published: Publish[];
  /** Every request, answered or refused. */
  requests: number;
  /** Refuses the next `count` requests with this status, or every request until `until` (a time in ms) when it is given. */
  fail(options: { status?: number; count?: number; until?: number; drop?: boolean }): void;
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

export async function fakeNtfy(now: () => number = Date.now): Promise<FakeNtfy> {
  const published: Publish[] = [];
  let requests = 0;
  let failing: { status: number; count: number | null; until: number | null; drop: boolean } | null = null;

  const server: Server = createServer((req, res) => {
    void (async () => {
      requests++;
      const text = await read(req);
      if (failing) {
        const timed = failing.until !== null && now() < failing.until;
        const counted = failing.count !== null && failing.count > 0;
        if (timed || counted) {
          if (counted) failing.count = failing.count! - 1;
          if (failing.drop) {
            req.socket.destroy();
            return;
          }
          res.writeHead(failing.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ code: failing.status * 100 + 1, http: failing.status, error: "refused by the test" }));
          return;
        }
        failing = null;
      }
      const auth = req.headers.authorization ?? null;
      const topic = (req.url ?? "/").split("?")[0]!.slice(1);
      published.push({
        topic,
        priority: (req.headers["x-priority"] as string | undefined) ?? null,
        tags: (req.headers["x-tags"] as string | undefined) ?? null,
        title: (req.headers["x-title"] as string | undefined) ?? null,
        text,
        token: auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null,
        method: req.method ?? "",
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `m${published.length}`, time: Math.floor(now() / 1000), event: "message", topic, message: text }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    published,
    get requests() {
      return requests;
    },
    fail({ status = 503, count, until, drop = false }) {
      failing = { status, count: count ?? null, until: until ?? null, drop };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
