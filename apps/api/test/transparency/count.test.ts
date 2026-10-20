import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { PublicFacts, RECIPIENT_RULES, type TransparencyFigures } from "@korbat/contracts";
import { clientNetwork } from "../../src/auth";
import type { AuthDeps } from "../../src/auth/context";
import { resolveSession } from "../../src/auth/middleware";
import type { AppEnv } from "../../src/env";
import { publicTransparency, type TransparencyForAuth } from "../../src/transparency";
import { closeMonths, createRecipientCounter, isReadRoute, sketchKeys, type SketchStore } from "../../src/transparency/recipients";
import type { EditionRow } from "../../src/transparency/repo";
import { publicFacts } from "../../src/transparency/routes";

/**
 * The recipients' count and the public answers without a database (3d design, sections 5, 7.5, 7.6 and 10.6; Task 4;
 * invariants 22 and 23): what resolveSession hands the count, and only there; what the count writes to Valkey, a store
 * that keeps sets here, and nothing else; the month's close; the facts of a server with every tool off; and the shape of
 * the editions' answer. The same against the real Valkey and database is transparency-public.test.ts's.
 */

/** A store that keeps each sketch as the set of what was added, the salt as bytes, and every expiry asked for. */
function memoryStore() {
  const sketches = new Map<string, Set<string>>();
  const values = new Map<string, Buffer>();
  const expiries = new Map<string, number>();
  const calls: string[] = [];
  const store = {
    async pfadd(key: string, ...elements: string[]) {
      calls.push(`pfadd ${key}`);
      const set = sketches.get(key) ?? new Set<string>();
      const before = set.size;
      for (const element of elements) set.add(String(element));
      sketches.set(key, set);
      return set.size > before ? 1 : 0;
    },
    async pfcount(...keys: string[]) {
      return new Set(keys.flatMap((key) => [...(sketches.get(key) ?? [])])).size;
    },
    async expire(key: string, seconds: number, mode: string) {
      calls.push(`expire ${key} ${seconds} ${mode}`);
      if (mode === "NX" && expiries.has(key)) return 0;
      expiries.set(key, seconds);
      return 1;
    },
    async set(key: string, value: Buffer, ex: string, seconds: number, nx: string) {
      calls.push(`set ${key} ${ex} ${seconds} ${nx}`);
      if (nx === "NX" && values.has(key)) return null;
      values.set(key, value);
      expiries.set(key, seconds);
      return "OK";
    },
    async getBuffer(key: string) {
      return values.get(key) ?? null;
    },
    async exists(...keys: string[]) {
      return keys.filter((key) => sketches.has(key) || values.has(key)).length;
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const key of keys) if (sketches.delete(key) || values.delete(key)) n++;
      return n;
    },
  };
  return { store: store as unknown as SketchStore, sketches, values, expiries, calls };
}

/** Lets the count's unwaited promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const log = pino({ level: "silent" });
const AT = new Date("2014-05-17T10:00:00.000Z");
/** A bearer token of the form the app sends, which the fake session store knows. */
const GOOD = `kb1_${"g".repeat(43)}`;
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

describe("the recipients' count, as resolveSession hands it on (3d Task 4)", () => {
  /** The middleware alone, over a session store that knows one bearer token, and a client address set as clientIdentity sets it. */
  function app(handler: TransparencyForAuth | null) {
    const deps = {
      config: { allowedOrigins: ["http://localhost:8081"] },
      sessions: { resolve: async (token: string) => (token === GOOD ? { session: { userId: "a1b2c3d4-0000-4000-8000-000000000001" }, slid: false } : null) },
    } as unknown as AuthDeps;
    const a = new Hono<AppEnv>();
    a.use(
      createMiddleware<AppEnv>(async (c, next) => {
        c.set("clientIp", "203.0.113.9");
        await next();
      }),
    );
    a.use(resolveSession(deps, () => handler));
    a.all("*", (c) => c.json({ ok: true }));
    return a;
  }
  function recording() {
    const calls: unknown[][] = [];
    const handler: TransparencyForAuth = {
      seen: (...args) => void calls.push(["seen", ...args]),
      seenSignedOut: (...args) => void calls.push(["seenSignedOut", ...args]),
    };
    return { calls, handler };
  }

  test("a request whose session resolved is seen by its account; a GET without one is seenSignedOut with the address, the agent and the path", async () => {
    const { calls, handler } = recording();
    const a = app(handler);
    expect((await a.request("/api/timeline/latest", { headers: { authorization: `Bearer ${GOOD}` } })).status).toBe(200);
    expect((await a.request("/api/timeline/latest", { headers: { "user-agent": FIREFOX } })).status).toBe(200);
    expect(calls).toEqual([
      ["seen", "a1b2c3d4-0000-4000-8000-000000000001"],
      ["seenSignedOut", "203.0.113.9", FIREFOX, "/api/timeline/latest"],
    ]);
  });

  test("a write without a session is not counted, nor is a token that resolves no session on a write", async () => {
    const { calls, handler } = recording();
    const a = app(handler);
    await a.request("/api/notices", { method: "POST" });
    await a.request("/api/notices", { method: "POST", headers: { authorization: `Bearer kb1_${"b".repeat(43)}` } });
    expect(calls).toEqual([]);
  });

  test("until a handler is registered nothing is counted, and a handler that throws never fails the request", async () => {
    expect((await app(null).request("/api/timeline/latest")).status).toBe(200);
    const throwing: TransparencyForAuth = {
      seen: () => {
        throw new Error("Valkey is down");
      },
      seenSignedOut: () => {
        throw new Error("Valkey is down");
      },
    };
    expect((await app(throwing).request("/api/timeline/latest")).status).toBe(200);
    expect((await app(throwing).request("/api/timeline/latest", { headers: { authorization: `Bearer ${GOOD}` } })).status).toBe(200);
  });

  test("seen adds the account to the UTC month's sketch, which lives 70 days from its first write", async () => {
    const m = memoryStore();
    const count = createRecipientCounter({ store: m.store, signedOut: true, log, now: () => AT });
    count.seen("account-1");
    count.seen("account-1");
    count.seen("account-2");
    await settle();
    expect([...m.sketches.keys()]).toEqual(["mau:in:2014-05"]);
    expect(m.sketches.get("mau:in:2014-05")!.size).toBe(2);
    expect(m.expiries.get("mau:in:2014-05")).toBe(RECIPIENT_RULES.sketchDays * 86_400);
    expect(m.calls.filter((call) => call.startsWith("expire")).every((call) => call.endsWith(" NX"))).toBe(true);
  });

  test("seenSignedOut adds HMAC-SHA-256(the day's salt, network LF agent cut at 256 bytes) to the day's sketch, and nothing else is kept", async () => {
    const m = memoryStore();
    const count = createRecipientCounter({ store: m.store, signedOut: true, log, now: () => AT });
    const long = `${FIREFOX}${"x".repeat(400)}`;
    count.seenSignedOut("203.0.113.9", FIREFOX, "/api/posts/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a");
    // The same reader on another public read, and on another address of the same IPv6 /64, is one value.
    count.seenSignedOut("203.0.113.9", FIREFOX, "/api/profiles/someone/replies");
    count.seenSignedOut("2001:db8:1:2:aaaa::1", long, "/api/timeline/explore");
    count.seenSignedOut("2001:db8:1:2:bbbb::2", `${long}yyyy`, "/api/timeline/latest");
    await settle();
    expect([...m.sketches.keys()]).toEqual(["mau:out:2014-05-17"]);
    expect([...m.values.keys()]).toEqual(["mau:salt:2014-05-17"]);
    const salt = m.values.get("mau:salt:2014-05-17")!;
    expect(salt.length).toBe(32);
    expect(m.expiries.get("mau:salt:2014-05-17")).toBe(RECIPIENT_RULES.saltHours * 3_600);
    const digest = (address: string, agent: string) =>
      createHmac("sha256", salt)
        .update(Buffer.concat([Buffer.from(clientNetwork(address), "utf8"), Buffer.from([10]), Buffer.from(agent, "utf8").subarray(0, RECIPIENT_RULES.userAgentBytes)]))
        .digest("hex");
    expect([...m.sketches.get("mau:out:2014-05-17")!].sort()).toEqual([digest("203.0.113.9", FIREFOX), digest("2001:db8:1:2::", long)].sort());
    // The salt was set once, with SET NX and its 26 hours, and read back: the process keeps it for the day.
    expect(m.calls.filter((call) => call.startsWith("set "))).toEqual([`set mau:salt:2014-05-17 EX ${RECIPIENT_RULES.saltHours * 3_600} NX`]);
  });

  test("seenSignedOut counts none of a crawler that names itself, another path, or anything while RECIPIENTS_SIGNED_OUT is off", async () => {
    const m = memoryStore();
    const on = createRecipientCounter({ store: m.store, signedOut: true, log, now: () => AT });
    on.seenSignedOut("203.0.113.9", "Mozilla/5.0 (compatible; Googlebot/2.1)", "/api/timeline/latest");
    for (const path of ["/api/media/x/small.webp", "/api/posts/x/status", "/api/health", "/api/me", "/api/timeline/following", "/api/posts/x/explore", "/api/profiles/a/followers"]) on.seenSignedOut("203.0.113.9", FIREFOX, path);
    const off = createRecipientCounter({ store: m.store, signedOut: false, log, now: () => AT });
    off.seenSignedOut("203.0.113.9", FIREFOX, "/api/timeline/latest");
    await settle();
    expect(m.calls).toEqual([]);
  });

  test("a store that fails or throws is swallowed: the calls return at once and throw nothing", async () => {
    const failing = new Proxy({}, { get: () => () => Promise.reject(new Error("Valkey is down")) }) as unknown as SketchStore;
    const throwing = new Proxy({}, {
      get: () => () => {
        throw new Error("Valkey is gone");
      },
    }) as unknown as SketchStore;
    for (const store of [failing, throwing]) {
      const count = createRecipientCounter({ store, signedOut: true, log, now: () => AT });
      expect(() => count.seen("account-1")).not.toThrow();
      expect(() => count.seenSignedOut("203.0.113.9", FIREFOX, "/api/timeline/latest")).not.toThrow();
    }
    await settle();
  });

  test("the seven public reads are counted, and their neighbours are not", () => {
    for (const path of ["/api/posts/p1", "/api/posts/p1/thread", "/api/timeline/latest", "/api/timeline/explore", "/api/profiles/h", "/api/profiles/h/posts", "/api/profiles/h/replies"]) {
      expect([path, isReadRoute(path)]).toEqual([path, true]);
    }
    for (const path of ["/api/posts", "/api/posts/p1/status", "/api/posts/p1/like", "/api/profiles/h/follow", "/api/timeline/latest/x", "/api/public/facts"]) {
      expect([path, isReadRoute(path)]).toEqual([path, false]);
    }
  });

  test("source: the count writes nothing to PostgreSQL and logs no salt, digest, address or agent", () => {
    const source = readFileSync(new URL("../../src/transparency/recipients.ts", import.meta.url), "utf8");
    const counter = source.slice(source.indexOf("export function createRecipientCounter"), source.indexOf("const CLOSE_MONTHS"));
    expect(counter).not.toMatch(/repo|apiDb|execute|insert/);
    expect([...counter.matchAll(/log[.][a-z]+[(]([^;]*)[)]/g)].map((m) => m[1])).toEqual(['{ err }, "recipients: a count was not recorded"']);
  });
});

describe("the month's close (3d Task 4)", () => {
  function repoOf(stored: string[]) {
    const rows: { month: string; signedIn: number; signedOutDays: number | null; method: number }[] = [];
    return {
      rows,
      repo: {
        monthStored: async (month: string) => stored.includes(month) || rows.some((row) => row.month === month),
        storeMonth: async (row: (typeof rows)[number]) => {
          rows.push(row);
          return true;
        },
      },
    };
  }

  test("the month before stores the month's sketch's count and the sum of its days' counts, then its keys go", async () => {
    const m = memoryStore();
    const april = new Date("2014-04-10T08:00:00.000Z");
    const count = createRecipientCounter({ store: m.store, signedOut: true, log, now: () => april });
    count.seen("a");
    count.seen("b");
    count.seenSignedOut("203.0.113.9", FIREFOX, "/api/timeline/latest");
    await settle();
    const { repo, rows } = repoOf([]);
    expect(await closeMonths({ store: m.store, repo, signedOut: true }, AT)).toEqual(["2014-04"]);
    expect(rows).toEqual([{ month: "2014-04", signedIn: 2, signedOutDays: 1, method: RECIPIENT_RULES.method }]);
    expect([...m.sketches.keys()]).toEqual([]);
    // Again: nothing to close.
    expect(await closeMonths({ store: m.store, repo, signedOut: true }, AT)).toEqual([]);
  });

  test("with RECIPIENTS_SIGNED_OUT off the second number is null; a month without a sketch gets no row; a stored month only loses its keys", async () => {
    const m = memoryStore();
    await m.store.pfadd(sketchKeys.month("2014-03"), "a");
    await m.store.pfadd(sketchKeys.month("2014-04"), "b");
    const { repo, rows } = repoOf(["2014-03"]);
    expect(await closeMonths({ store: m.store, repo, signedOut: false }, AT)).toEqual(["2014-04"]);
    expect(rows).toEqual([{ month: "2014-04", signedIn: 1, signedOutDays: null, method: RECIPIENT_RULES.method }]);
    expect(m.sketches.has(sketchKeys.month("2014-03"))).toBe(false);
    // The running month is never closed.
    await m.store.pfadd(sketchKeys.month("2014-05"), "c");
    expect(await closeMonths({ store: m.store, repo, signedOut: false }, AT)).toEqual([]);
    expect(m.sketches.has(sketchKeys.month("2014-05"))).toBe(true);
  });
});

describe("the public answers' shape (3d Task 4)", () => {
  test("the facts of a server with every tool off, the edge as its adapter, and the setting", () => {
    const off = publicFacts({ EDGE_PURGE: "off", RECIPIENTS_SIGNED_OUT: "on", HEAD_WITNESS: "off" });
    expect(PublicFacts.parse(off)).toEqual(off);
    expect([off.r1.state, off.match.state, off.edge, off.witness, off.recipientsSignedOut]).toEqual(["off", "off", { on: false, test: false }, { on: false, test: false }, true]);
    expect(publicFacts({ EDGE_PURGE: "test", RECIPIENTS_SIGNED_OUT: "off", HEAD_WITNESS: "off" })).toMatchObject({ edge: { on: true, test: true }, recipientsSignedOut: false });
    expect(publicFacts({ EDGE_PURGE: "cloudflare", RECIPIENTS_SIGNED_OUT: "on", HEAD_WITNESS: "off" }).edge).toEqual({ on: true, test: false });
    // 3d Task 5: the head's witness prints its adapter, a test one as such.
    expect(publicFacts({ EDGE_PURGE: "off", RECIPIENTS_SIGNED_OUT: "on", HEAD_WITNESS: "rfc3161" }).witness).toEqual({ on: true, test: false });
    expect(publicFacts({ EDGE_PURGE: "off", RECIPIENTS_SIGNED_OUT: "on", HEAD_WITNESS: "test" }).witness).toEqual({ on: true, test: true });
  });

  test("the editions' answer: each year's newest version, newest year first, with its older versions and the day each was replaced", () => {
    const figures = { restrictions: { byGround: [], byMeasure: [], total: "0" }, noBreach: "0", intakes: [], appeals: [], reexaminations: [], accountMeasures: [], automated: { findings: [], measures: [] }, recipients: "not recorded" } as TransparencyFigures;
    const row = (year: number, version: number, at: string, reason: EditionRow["reason"]): EditionRow => ({ year, version, publishedAt: new Date(at), method: 1, reason, figures });
    const answer = publicTransparency([
      row(2014, 3, "2016-01-05T10:00:00Z", "correction"),
      row(2014, 2, "2015-05-02T10:00:00Z", "hold_ended"),
      row(2014, 1, "2015-03-01T07:10:00Z", "first"),
      row(2013, 1, "2014-03-01T07:10:00Z", "first"),
    ]);
    expect(answer.editions.map((edition) => [edition.year, edition.version, edition.publishedOn, edition.reason, edition.older.map((older) => [older.version, older.publishedOn, older.replacedOn, older.reason])])).toEqual([
      [2014, 3, "2016-01-05", "correction", [[1, "2015-03-01", "2015-05-02", "first"], [2, "2015-05-02", "2016-01-05", "hold_ended"]]],
      [2013, 1, "2014-03-01", "first", []],
    ]);
  });
});
