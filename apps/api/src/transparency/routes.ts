import { Hono } from "hono";
import type { PublicFacts } from "@korbat/contracts";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import { publicTransparency } from "./editions";
import type { TransparencyRepo } from "./repo";

/**
 * The public answers (3d design, sections 9.1 and 10.6), mounted at /api after the global rate limit and before the
 * session's resolution (app.ts), as the page status is: neither reads a session, a cookie or a table of a person.
 *
 *   GET /api/public/facts         what is switched on now, read from memory, Cache-Control: no-cache, so /rules prints
 *                                 what runs now, also in the minute after a restart;
 *   GET /api/public/transparency  every year's editions from transparency_editions, Cache-Control: public, max-age=3600:
 *                                 nothing in it changes within a day.
 *
 * GET /api/public/head is Task 5's.
 */

/**
 * The facts of the running server (10.6): booleans, names, days and numbers, never a token, a zone, a host or an address.
 * The R1 check, the comparison with known material and the head's witness are built by later tasks and print off until
 * then; the edge prints its adapter (Task 3). A test adapter prints "on" and says it is one.
 */
export function publicFacts(config: Pick<Config, "EDGE_PURGE" | "RECIPIENTS_SIGNED_OUT">): PublicFacts {
  return {
    r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
    match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
    edge: { on: config.EDGE_PURGE !== "off", test: config.EDGE_PURGE === "test" },
    witness: { on: false, test: false },
    recipientsSignedOut: config.RECIPIENTS_SIGNED_OUT === "on",
  };
}

export function transparencyRoutes(deps: { repo: Pick<TransparencyRepo, "editions">; facts: PublicFacts }) {
  const r = new Hono<AppEnv>();
  r.get("/public/facts", (c) => {
    c.header("Cache-Control", "no-cache");
    return c.json(deps.facts);
  });
  r.get("/public/transparency", async (c) => {
    const answer = publicTransparency(await deps.repo.editions());
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(answer);
  });
  return r;
}
