import { EDGE_RULES } from "@korbat/contracts";

/**
 * The edge's purge adapter (3d design, section 5 "The adapters", section 7.4; Task 3), chosen by EDGE_PURGE when the
 * process starts. It is given prefixes and nothing else, and it imports nothing of the media module: the outbox's job
 * (edge.ts) reads the rows and hands it the prefixes of one round. An architecture test holds it to that.
 *
 *   - `off` (the default): sends nothing; the job closes every outbox row as off, and the header is the only bound.
 *   - `test`: keeps each call's prefixes in memory and accepts them, but fails a call one of whose prefixes contains
 *     "fail"; it is built only while the app's site is closed, in the process as at start.
 *   - `cloudflare`: one POST to the provider's purge route of the zone, with the prefixes as JSON and the bearer token,
 *     bounded at EDGE_RULES.timeoutMs. A refusal, a body that does not say success, a timeout or no connection answers
 *     `failed`; nothing is thrown for them, and the token is in nothing the adapter answers, throws or shows.
 */

/** What the provider made of one call: it took the purge, or it did not (for any reason). */
export type EdgeOutcome = "accepted" | "failed";
export type EdgeMode = "off" | "test" | "cloudflare";

export interface EdgeAdapter {
  readonly mode: EdgeMode;
  /**
   * The prefix that covers an image at the edge: `<host>/api/media/<id>/`, both sizes and every query-string variant a
   * stranger may have put into the cache, whatever the cache key.
   */
  prefix(mediaId: string): string;
  /** One request for up to EDGE_RULES.prefixes prefixes. */
  purge(prefixes: readonly string[]): Promise<EdgeOutcome>;
}

/** The `test` adapter, which also shows what it was sent, one array a call. */
export interface TestEdgeAdapter extends EdgeAdapter {
  readonly mode: "test";
  readonly sent: readonly (readonly string[])[];
}

/** What edgeAdapterFrom builds: the `test` adapter shows what it was sent; the other two show nothing beyond the interface. */
export type BuiltEdgeAdapter = (EdgeAdapter & { readonly mode: "off" | "cloudflare" }) | TestEdgeAdapter;

/** The settings the adapter is built from: the configuration's own members of the same names. */
export interface EdgeSettings {
  EDGE_PURGE: EdgeMode;
  APP_SITE: "open" | "closed";
  EDGE_ZONE_ID?: string | undefined;
  EDGE_API_TOKEN?: string | undefined;
  EDGE_HOST?: string | undefined;
}

/** What a test may give in place of the provider: its address (fakeEdge()) and a fetch. */
export interface EdgeOptions {
  apiBase?: string;
  fetch?: typeof fetch;
}

/** The provider's API, which a token with the one permission Zone, Cache Purge reaches. */
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
/** The host the `test` adapter names when EDGE_HOST is unset. */
const TEST_HOST = "edge.test";

const prefixOf = (host: string) => (mediaId: string) => `${host}/api/media/${mediaId}/`;

/** One call names at least one prefix and at most a request's worth: the job never asks for more. */
function checked(prefixes: readonly string[]): void {
  if (prefixes.length === 0) throw new Error("edge purge: a call names at least one prefix");
  if (prefixes.length > EDGE_RULES.prefixes) throw new Error(`edge purge: a call names at most ${EDGE_RULES.prefixes} prefixes`);
}

export function edgeAdapterFrom(settings: EdgeSettings, options: EdgeOptions = {}): BuiltEdgeAdapter {
  switch (settings.EDGE_PURGE) {
    case "off":
      return {
        mode: "off",
        prefix: prefixOf(settings.EDGE_HOST ?? TEST_HOST),
        purge: async () => {
          throw new Error("edge purge: the adapter is off, and nothing is sent");
        },
      };
    case "test": {
      // The same rule as the configuration's, so a test adapter built in the process answers only on a closed site too.
      if (settings.APP_SITE !== "closed") throw new Error("edge purge: EDGE_PURGE=test is refused while APP_SITE is open");
      const sent: string[][] = [];
      return {
        mode: "test",
        sent,
        prefix: prefixOf(settings.EDGE_HOST ?? TEST_HOST),
        async purge(prefixes) {
          checked(prefixes);
          sent.push([...prefixes]);
          return prefixes.some((prefix) => prefix.includes("fail")) ? "failed" : "accepted";
        },
      } satisfies TestEdgeAdapter;
    }
    case "cloudflare": {
      const missing = (["EDGE_ZONE_ID", "EDGE_API_TOKEN", "EDGE_HOST"] as const).filter((name) => !settings[name]);
      if (missing.length > 0) throw new Error(`edge purge: ${missing.join(", ")} required when EDGE_PURGE is cloudflare`);
      const url = `${options.apiBase ?? CLOUDFLARE_API}/zones/${settings.EDGE_ZONE_ID}/purge_cache`;
      const send = options.fetch ?? fetch;
      // The token stays in this closure: no member of the adapter holds it, so no log line of the adapter can print it.
      const token = settings.EDGE_API_TOKEN!;
      return {
        mode: "cloudflare",
        prefix: prefixOf(settings.EDGE_HOST!),
        async purge(prefixes) {
          checked(prefixes);
          try {
            const res = await send(url, {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ prefixes }),
              signal: AbortSignal.timeout(EDGE_RULES.timeoutMs),
              redirect: "error",
            });
            if (!res.ok) {
              await res.body?.cancel();
              return "failed";
            }
            const body = (await res.json()) as { success?: unknown };
            return body.success === true ? "accepted" : "failed";
          } catch {
            // A refused connection, a timeout, a redirect or a body that is not JSON: the purge was not taken. The error is
            // dropped whole, so nothing of the request reaches a log line.
            return "failed";
          }
        },
      };
    }
  }
}
