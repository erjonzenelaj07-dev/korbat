import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** One request the stand-in took: its method, its path, its content type and its body's bytes. */
export interface WitnessRequest {
  method: string;
  path: string;
  contentType: string | null;
  body: Buffer;
}

/**
 * How the stand-in answers: with a TimeStampResp whose status is granted and which carries a token (`ok`), with one whose
 * status is rejection and which carries none (`refused`), with a server error (`error`), with a granted answer larger
 * than any token korbat keeps (`huge`), or not at all, holding the request open until it is closed (`hang`).
 */
export type WitnessAnswer = "ok" | "refused" | "error" | "huge" | "hang";

/** A DER length: short below 128, else 0x81 or 0x82 and the bytes. */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}
const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag, ...derLength(content.length)]), content]);

/**
 * The stand-in's granted answer for a request: a TimeStampResp of status 0 (granted) whose token is a SEQUENCE holding the
 * request's own bytes, so a test can tell which request an answer belongs to. It proves nothing: the adapter keeps an
 * answer unparsed beyond its status, and only a real authority's token is checked, with openssl, by whoever reads it.
 */
export function grantedAnswer(request: Buffer, padding = 0): Buffer {
  const status = tlv(0x30, Buffer.from([0x02, 0x01, 0x00]));
  const token = tlv(0x30, Buffer.concat([tlv(0x04, request), tlv(0x04, Buffer.alloc(padding, 0x41))]));
  return tlv(0x30, Buffer.concat([status, token]));
}

/** A rejection (status 2) with no token, as an authority answers a request it will not stamp. */
export const REFUSED_ANSWER = tlv(0x30, tlv(0x30, Buffer.from([0x02, 0x01, 0x02])));

/**
 * fakeWitness() (3d design, section 12; Task 5): a local HTTP server that stands in for a timestamp authority. It
 * records each request with its body, and answers as it is told. Its `url` is what the rfc3161 adapter is given in place
 * of HEAD_WITNESS_URL, which the configuration holds to https.
 */
export async function fakeWitness(): Promise<{
  url: string;
  requests: WitnessRequest[];
  answer(how: WitnessAnswer): void;
  close(): Promise<void>;
}> {
  const requests: WitnessRequest[] = [];
  const open = new Set<ServerResponse>();
  let how: WitnessAnswer = "ok";
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method ?? "", path: req.url ?? "", contentType: req.headers["content-type"] ?? null, body });
      if (how === "hang") {
        open.add(res);
        return;
      }
      if (how === "error") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("the stand-in failed");
        return;
      }
      const answer = how === "refused" ? REFUSED_ANSWER : grantedAnswer(body, how === "huge" ? 20_000 : 0);
      res.writeHead(200, { "content-type": "application/timestamp-reply" });
      res.end(answer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/tsa`,
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
