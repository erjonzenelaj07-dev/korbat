import { Hono } from "hono";
import type { PublicFacts } from "@korbat/contracts";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import { publicTransparency } from "./editions";
import { publicHead } from "./head";
import type { TransparencyRepo } from "./repo";

/**
 * The public answers (3d design, sections 9.1 and 10.6), mounted at /api after the global rate limit and before the
 * session's resolution (app.ts), as the page status is: neither reads a session, a cookie or a table of a person.
 *
 *   GET /api/public/facts         what is switched on now, read from memory, Cache-Control: no-cache, so /rules prints
 *                                 what runs now, also in the minute after a restart;
 *   GET /api/public/transparency  every year's editions from transparency_editions, Cache-Control: public, max-age=3600:
 *                                 nothing in it changes within a day;
 *   GET /api/public/head          the audit head's published values of the last HEAD_RULES.shownDays days (Task 5), public
 *                                 for an hour too: a day gains its value once, after the dispatch hour, and never the place.
 */

/**
 * The facts of the running server (10.6): booleans, names, days and numbers, never a token, a zone, a host or an address.
 * The comparison with known material prints its state (3d Task 7); the edge prints its adapter
 * (Task 3), and the head's witness its own (Task 5), never its authority's address. A test adapter prints "on" and says it
 * is one. 3d Task 6: the R1 check prints its state (off; on and flagging; on and withholding, AUTOMATION_R1_ACTS), whether
 * it is the test scorer, and its two impact assessments' days, each in its own block; the model, its digest, its
 * threshold, its version and the publisher's claim stay null while no classifier is built in, which no build of 3d does.
 */
export function publicFacts(
  config: Pick<Config, "EDGE_PURGE" | "RECIPIENTS_SIGNED_OUT" | "HEAD_WITNESS" | "R1_CLASSIFIER" | "AUTOMATION_R1_ACTS" | "AUTOMATION_DPIA_R1" | "AUTOMATION_DPIA_R1_ACTS"> &
    Partial<Pick<Config, "MEDIA_MATCH" | "AUTOMATION_R2_ACTS" | "AUTOMATION_DPIA_MATCH" | "AUTOMATION_DPIA_MATCH_ACTS" | "HEAD_KEEPER_MAIL">>,
): PublicFacts {
  // 3d Task 7 (sections 2 rows 27 and 49, 10.6): the comparison prints its state (off; on and only alerting, the finding
  // and the urgent alert; on and sealing, AUTOMATION_R2_ACTS), whether it is the test matcher, the source's name and its
  // two impact assessments' days, each in its own block. A source is named here only once it has allowed that; the test
  // matcher's name is "test".
  const match = config.MEDIA_MATCH ?? "off";
  const matchOn = match !== "off";
  const r1On = config.R1_CLASSIFIER !== "off";
  return {
    r1: {
      state: !r1On ? "off" : config.AUTOMATION_R1_ACTS === "on" ? "withholds" : "flags",
      test: config.R1_CLASSIFIER === "test",
      model: null,
      digest: null,
      threshold: null,
      thresholdVersion: null,
      publisherClaim: null,
      dpia: config.AUTOMATION_DPIA_R1 ?? null,
      dpiaActs: config.AUTOMATION_DPIA_R1_ACTS ?? null,
    },
    match: {
      state: !matchOn ? "off" : (config.AUTOMATION_R2_ACTS ?? "on") === "on" ? "seals" : "alerts",
      test: match === "test",
      source: matchOn ? match : null,
      dpia: config.AUTOMATION_DPIA_MATCH ?? null,
      dpiaActs: config.AUTOMATION_DPIA_MATCH_ACTS ?? null,
    },
    edge: { on: config.EDGE_PURGE !== "off", test: config.EDGE_PURGE === "test" },
    witness: { on: config.HEAD_WITNESS !== "off", test: config.HEAD_WITNESS === "test" },
    recipientsSignedOut: config.RECIPIENTS_SIGNED_OUT === "on",
    // 3d review M13: whether the daily value goes to a keeper at all; never the address.
    keeper: config.HEAD_KEEPER_MAIL !== undefined && config.HEAD_KEEPER_MAIL !== "",
  };
}

export function transparencyRoutes(deps: { repo: Pick<TransparencyRepo, "editions" | "headDays">; facts: PublicFacts }) {
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
  r.get("/public/head", async (c) => {
    const answer = publicHead(await deps.repo.headDays());
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(answer);
  });
  return r;
}
