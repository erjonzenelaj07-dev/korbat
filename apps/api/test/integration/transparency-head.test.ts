import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { HEAD_KINDS, HEAD_RULES, HEAD_WITNESSES, PublicFacts, PublicHead } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createTransparency, witnessFrom, type SketchStore } from "../../src/transparency";
import { headValue } from "../../src/transparency/head";
import { TEST_TOKEN } from "../../src/transparency/witness";
import { fakeWitness, grantedAnswer } from "../transparency/fake-witness";
import { pgError, rolledBack } from "./staff-fixtures";

/**
 * The audit head's daily value on the database (3d design, sections 2 row 9, 6.5, 7.7, 7.14 and 10.6; Task 5; 12.1 rows
 * 22 and 24, 11.1's row "A published head is changed"): head_value() against the API's own digest; head_publications'
 * closed lists, grants and two triggers as the API's role, which can publish no value of its own making and set the
 * token and the publication each once; the transparency job's day: the row, the witness (off, test and rfc3161 against
 * fakeWitness()), the publication, the keeper's mail through the auth module's mailKeeper, head_unwitnessed and
 * head_missed; and GET /api/public/head, which never holds the place. The job's clock stands in January 2027, so its
 * daily edition pass asks for 2026's edition, which is not due on the database's clock, and writes nothing; the head's
 * day is the database's own today. Every row the test commits is deleted afterwards, as the migrator.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the audit head's daily value (3d Task 5)", () => {
  let config: Config;
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  const logger = pino({ level: "silent" });
  const KEEPER = "keeper@korbat.example";
  /** No sketch exists: the job's month close finds nothing to close. */
  const noSketches = { exists: async () => 0 } as unknown as SketchStore;
  /** The job's clock: a January morning of 2027 after the dispatch hour, one day further for each new day's pass. */
  let day = 0;
  const clock = () => new Date(Date.UTC(2027, 0, 4 + day, config.MODERATION_DISPATCH_HOUR, 30));

  const cleanUp = async () => {
    await migrateDb.execute(sql`delete from public.head_publications`);
    await migrateDb.execute(sql`delete from public.alert_outbox where kind in ('head_unwitnessed', 'head_missed')`);
  };
  /** The database's today and the audit head as they stand. */
  const today = async () => (await migrateDb.execute<{ day: string }>(sql`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as day`))[0]!.day;
  const auditHead = async (q: Pick<DbTx, "execute"> = migrateDb) => (await q.execute<{ seq: number; hash: string }>(sql`select seq::int as seq, hash from public.audit_head where id = 1`))[0]!;
  const dayBefore = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00.000Z`) - n * 86_400_000).toISOString().slice(0, 10);

  /** The module as index.ts builds it: the auth module's mailKeeper over a memory mailer, and the witness the settings name. */
  function build(overrides: Partial<Config> = {}, witness?: ReturnType<typeof witnessFrom>) {
    const settings = { ...config, ...overrides };
    const mailer = new MemoryMailer();
    const auth = createAuth({ config: settings, logger, authDb, kv: new MemoryKv(), mailer, profiles: createProfileStore(apiDb), turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } });
    const module = createTransparency({ apiDb, redis: noSketches, auth: auth.forTransparency, config: settings, logger, now: clock, ...(witness ? { witness } : {}) });
    const app = createApp({ config: settings, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, transparency: module });
    return { module, app, mailer, kept: () => mailer.sent.filter((m) => m.template === "head_published") };
  }
  const headRows = () =>
    migrateDb.execute<{ day: string; kind: string; chain_seq: number | null; value: string; witness: string; token: Buffer | null; published: boolean; retired: boolean }>(sql`
      select to_char(day, 'YYYY-MM-DD') as day, kind, chain_seq::int as chain_seq, value, witness, token, published_at is not null as published, retired_at is not null as retired
        from public.head_publications order by day desc, kind`);
  const alerts = () => migrateDb.execute<{ kind: string; facts: Record<string, unknown> }>(sql`select kind, facts from public.alert_outbox where kind in ('head_unwitnessed', 'head_missed') order by id`);

  beforeAll(async () => {
    config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    await cleanUp();
  });
  afterEach(async () => {
    await cleanUp();
    day++;
  });
  afterAll(async () => {
    await cleanUp();
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  test("head_value() is the API's digest of the tag, the day, the place and the hash; its lists are HEAD_KINDS and HEAD_WITNESSES; the grants are 6.5's", async () => {
    const [vectors] = await apiDb.execute<{ lab: string; empty: string }>(sql`
      select public.head_value('2026-10-18'::date, 42, '24cc975360df565521f1acca5b67f924d33ca0a0999355f667c4c289b1632fe1') as lab,
             public.head_value('2026-10-19'::date, 0, ${"0".repeat(64)}) as empty`);
    expect(vectors!.lab).toBe("917907fc36f065a78e0b730230eac9c4f1c2882c77efc7a868a65ee336e0899e");
    expect(vectors!.empty).toBe(headValue("2026-10-19", 0, "0".repeat(64)));
    const head = await auditHead();
    const [now] = await apiDb.execute<{ value: string }>(sql`select public.head_value('2031-05-06'::date, ${head.seq}::bigint, ${head.hash}) as value`);
    expect(now!.value).toBe(headValue("2031-05-06", head.seq, head.hash));
    const listOf = async (name: string) => {
      const [check] = await migrateDb.execute<{ def: string }>(sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.head_publications'::regclass and c.conname = ${name}`);
      return [...check!.def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]);
    };
    expect(await listOf("head_publications_kind")).toEqual([...HEAD_KINDS]);
    expect(await listOf("head_publications_witness")).toEqual([...HEAD_WITNESSES]);
    const [rights] = await migrateDb.execute<Record<string, boolean>>(sql`
      select has_table_privilege('korbat_api', 'public.head_publications', 'SELECT') as sel,
             has_table_privilege('korbat_api', 'public.head_publications', 'INSERT') as ins,
             has_table_privilege('korbat_api', 'public.head_publications', 'DELETE') as del,
             has_column_privilege('korbat_api', 'public.head_publications', 'token', 'UPDATE') as token,
             has_column_privilege('korbat_api', 'public.head_publications', 'witnessed_at', 'UPDATE') as witnessed,
             has_column_privilege('korbat_api', 'public.head_publications', 'published_at', 'UPDATE') as published,
             has_column_privilege('korbat_api', 'public.head_publications', 'value', 'UPDATE') as value,
             has_column_privilege('korbat_api', 'public.head_publications', 'chain_seq', 'UPDATE') as place,
             has_column_privilege('korbat_api', 'public.head_publications', 'retired_at', 'UPDATE') as retired,
             has_function_privilege('korbat_api', 'public.head_value(date, bigint, text)', 'EXECUTE') as value_fn,
             has_function_privilege('public', 'public.head_value(date, bigint, text)', 'EXECUTE') as value_pub`);
    expect({ ...rights }).toEqual({ sel: true, ins: true, del: false, token: true, witnessed: true, published: true, value: false, place: false, retired: false, value_fn: true, value_pub: false });
  });

  test("as the API's role the insert is forced: a head of today, its place and value from audit_head as it stands, nothing else; one head row a day", async () => {
    await rolledBack(apiDb, async (tx) => {
      const [row] = await tx.execute<{ day: string; kind: string; chain_seq: number; value: string; witness: string; rest: boolean }>(sql`
        insert into public.head_publications (day, kind, chain_seq, value, witness, token, witnessed_at, published_at, retired_at, last_day)
        values ('2001-02-03', 'restore', 1, ${"f".repeat(64)}, 'test', ${Buffer.from("3003020100", "hex")}, '2001-02-03', '2001-02-03', '2001-02-03', '2001-01-01')
        returning to_char(day, 'YYYY-MM-DD') as day, kind, chain_seq::int as chain_seq, value, witness,
                  token is null and witnessed_at is null and published_at is null and retired_at is null and last_day is null as rest`);
      const head = await auditHead(tx);
      expect({ ...row }).toEqual({ day: await today(), kind: "head", chain_seq: head.seq, value: headValue(await today(), head.seq, head.hash), witness: "test", rest: true });
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.head_publications (witness) values ('none')`))))?.code).toBe("23505");
      expect(await tx.execute(sql`insert into public.head_publications (witness) values ('none') on conflict (day, kind) do nothing returning day`)).toHaveLength(0);
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`insert into public.head_publications (witness) values ('openssl')`))))?.code).toBe("23514");
    });
  });

  test("as the API's role the token and the publication change once, from null, at the clock's time; nothing else changes, and nothing is deleted", async () => {
    await rolledBack(apiDb, async (tx) => {
      const d = await today();
      await tx.execute(sql`insert into public.head_publications (witness) values ('rfc3161')`);
      const where = sql`day = ${d}::date and kind = 'head'`;
      const [set] = await tx.execute<{ fresh: boolean }>(sql`update public.head_publications set token = ${Buffer.from(TEST_TOKEN)}, witnessed_at = '2001-01-01' where ${where} returning witnessed_at = now() as fresh`);
      expect(set!.fresh).toBe(true);
      const refused = async (statement: ReturnType<typeof sql>) => (await pgError(tx.transaction((sp) => sp.execute(statement))))?.message;
      expect(await refused(sql`update public.head_publications set token = ${Buffer.from("30", "hex")} where ${where}`)).toBe("moderation_column");
      expect(await refused(sql`update public.head_publications set witnessed_at = now() - interval '1 day' where ${where}`)).toBe("moderation_column");
      const [published] = await tx.execute<{ fresh: boolean }>(sql`update public.head_publications set published_at = '2001-01-01' where ${where} returning published_at = now() as fresh`);
      expect(published!.fresh).toBe(true);
      expect(await refused(sql`update public.head_publications set published_at = null where ${where}`)).toBe("moderation_column");
      // Every other column is out of the role's grants: the value, the place, the witness's name, the retirement.
      for (const statement of [
        sql`update public.head_publications set value = ${"0".repeat(64)} where ${where}`,
        sql`update public.head_publications set chain_seq = 1 where ${where}`,
        sql`update public.head_publications set witness = 'none' where ${where}`,
        sql`update public.head_publications set retired_at = now() where ${where}`,
        sql`delete from public.head_publications where ${where}`,
      ]) {
        expect((await pgError(tx.transaction((sp) => sp.execute(statement))))?.code).toBe("42501");
      }
    });
    await rolledBack(apiDb, async (tx) => {
      const where = sql`day = (now() at time zone 'UTC')::date and kind = 'head'`;
      // A token without its time, a token larger than 16 KB, and a token on a row whose witness nobody asked are refused.
      await tx.execute(sql`insert into public.head_publications (witness) values ('none')`);
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update public.head_publications set token = ${Buffer.from("30", "hex")} where ${where}`))))?.code).toBe("23514");
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update public.head_publications set token = ${Buffer.from("30", "hex")}, witnessed_at = now() where ${where}`))))?.code).toBe("23514");
    });
    await rolledBack(apiDb, async (tx) => {
      await tx.execute(sql`insert into public.head_publications (witness) values ('test')`);
      const big = Buffer.alloc(HEAD_RULES.tokenMaxBytes + 1, 1);
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update public.head_publications set token = ${big}, witnessed_at = now() where day = (now() at time zone 'UTC')::date`))))?.code).toBe("23514");
    });
  });

  test("witness off: the job's day publishes the row named none, mails the keeper the day, the value, the place and the hash, which give the value again, and writes no audit row", async () => {
    const { module, kept } = build({ HEAD_KEEPER_MAIL: KEEPER });
    const before = await auditHead();
    const round = await module.round();
    expect(round.editions).toEqual([]);
    expect(round.head).toMatchObject({ day: await today(), inserted: true, witnessed: null, published: true, mailed: "sent", alerts: [], done: true });
    // The publication is no audit row: it would move the head it publishes.
    expect((await auditHead()).seq).toBe(before.seq);
    const [row] = await headRows();
    expect({ ...row }).toMatchObject({ day: await today(), kind: "head", chain_seq: before.seq, value: headValue(await today(), before.seq, before.hash), witness: "none", token: null, published: true, retired: false });
    expect(kept()).toHaveLength(1);
    const mail = kept()[0]!;
    expect(mail.to).toBe(KEEPER);
    expect(mail.data).toEqual({ day: await today(), value: row!.value, seq: String(before.seq), hash: before.hash, witnessed: "none" });
    // The keeper's check: the day, the place and the hash give the value.
    expect(headValue(mail.data.day!, Number(mail.data.seq), mail.data.hash!)).toBe(mail.data.value);
    // A later round of the same day writes and mails nothing.
    const later = await module.round();
    expect(later.head).toBeNull();
    expect(kept()).toHaveLength(1);
  });

  test("no keeper's address: the value is published and no mail is sent; the test witness on a closed site stores its token first", async () => {
    const { module, mailer } = build({ HEAD_KEEPER_MAIL: undefined, HEAD_WITNESS: "test", APP_SITE: "closed" });
    const round = await module.round();
    expect(round.head).toMatchObject({ witnessed: "stored", published: true, mailed: "off", done: true });
    expect(mailer.sent).toEqual([]);
    const [row] = await headRows();
    expect([row!.witness, Buffer.from(row!.token!).equals(Buffer.from(TEST_TOKEN)), row!.published]).toEqual(["test", true, true]);
  });

  test("rfc3161 against fakeWitness(): the answer stored as received, and GET /api/public/head offers it as base64 with the day's value and never the place", async () => {
    const fake = await fakeWitness();
    try {
      const witness = witnessFrom({ HEAD_WITNESS: "rfc3161", APP_SITE: "open", HEAD_WITNESS_URL: "https://tsa.example/" }, { url: fake.url });
      const { module, app, kept } = build({ HEAD_KEEPER_MAIL: KEEPER, HEAD_WITNESS: "rfc3161", HEAD_WITNESS_URL: "https://tsa.example/" }, witness);
      const round = await module.round();
      expect(round.head).toMatchObject({ witnessed: "stored", published: true, mailed: "sent", done: true });
      expect(fake.requests).toHaveLength(1);
      const [row] = await headRows();
      expect(fake.requests[0]!.body.subarray(24, 56).toString("hex")).toBe(row!.value);
      expect(Buffer.from(row!.token!).equals(grantedAnswer(fake.requests[0]!.body))).toBe(true);
      expect(kept()[0]!.data.witnessed).toBe("stored");
      const res = await app.request("/api/public/head", { headers: { cookie: "korbat_session=abc" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      const body = await res.json();
      const answer = PublicHead.parse(body);
      expect(answer.days).toEqual([{ day: await today(), kind: "head", value: row!.value, witness: "rfc3161", token: grantedAnswer(fake.requests[0]!.body).toString("base64"), retiredOn: null, lastDay: null }]);
      expect(JSON.stringify(body)).not.toMatch(/chainSeq|chain_seq|"seq"|hash/);
      // The facts route says the witness is on, and is no test adapter.
      expect(PublicFacts.parse(await (await app.request("/api/public/facts")).json()).witness).toEqual({ on: true, test: false });
    } finally {
      await fake.close();
    }
  });

  test("an authority that does not answer: the value is published without a token, reads none, head_unwitnessed once; a later round asks again and stores the later token", async () => {
    const fake = await fakeWitness();
    try {
      fake.answer("error");
      const witness = witnessFrom({ HEAD_WITNESS: "rfc3161", APP_SITE: "open", HEAD_WITNESS_URL: "https://tsa.example/" }, { url: fake.url });
      const { module, app } = build({ HEAD_WITNESS: "rfc3161", HEAD_WITNESS_URL: "https://tsa.example/" }, witness);
      const first = await module.round();
      expect(first.head).toMatchObject({ witnessed: "unanswered", published: true, alerts: ["head_unwitnessed"], done: false });
      const d = await today();
      expect((await alerts()).map((a) => [a.kind, a.facts])).toEqual([["head_unwitnessed", { day: `${d}T00:00:00.000Z` }]]);
      const shown = PublicHead.parse(await (await app.request("/api/public/head")).json());
      expect(shown.days.map((entry) => [entry.witness, entry.token])).toEqual([["none", null]]);
      // The same day's next round asks again; a second failure writes no second alert within the day.
      const second = await module.round();
      expect(second.head).toMatchObject({ witnessed: "unanswered", published: false, alerts: [], done: false });
      expect(await alerts()).toHaveLength(1);
      fake.answer("ok");
      const third = await module.round();
      expect(third.head).toMatchObject({ witnessed: "stored", done: true });
      expect(fake.requests).toHaveLength(3);
      const [row] = await headRows();
      expect([row!.witness, row!.token === null]).toEqual(["rfc3161", false]);
      expect(PublicHead.parse(await (await app.request("/api/public/head")).json()).days[0]!.witness).toBe("rfc3161");
    } finally {
      await fake.close();
    }
  });

  test("head_missed: the day's first round finds the day before without a published value while an earlier day has one; on the head's first day nothing is missed", async () => {
    const d = await today();
    const first = build();
    expect((await first.module.round()).head).toMatchObject({ alerts: [] });
    expect(await alerts()).toEqual([]);
    await cleanUp();
    // Three days ago a value was published; the day before today has none.
    const earlier = dayBefore(d, 3);
    await migrateDb.execute(sql`insert into public.head_publications (day, kind, chain_seq, value, witness, published_at) values (${earlier}::date, 'head', 0, ${headValue(earlier, 0, "0".repeat(64))}, 'none', now())`);
    day++;
    const next = build();
    expect((await next.module.round()).head).toMatchObject({ alerts: ["head_missed"] });
    expect((await alerts()).map((a) => [a.kind, a.facts])).toEqual([["head_missed", { day: `${dayBefore(d, 1)}T00:00:00.000Z` }]]);
  });

  test("GET /api/public/head: the published rows of the last 30 days, newest first, a restore with its last day and a retired value with its day; nothing unpublished, nothing older", async () => {
    const d = await today();
    const value = (n: number) => headValue(dayBefore(d, n), n, "0".repeat(64));
    const at = (n: number) => sql`${dayBefore(d, n)}::date`;
    await migrateDb.execute(sql`
      insert into public.head_publications (day, kind, chain_seq, value, witness, published_at, retired_at, last_day) values
        (${at(1)}, 'head', 1, ${value(1)}, 'none', now(), null, null),
        (${at(2)}, 'restore', 2, ${value(2)}, 'none', now(), null, ${at(5)}),
        (${at(3)}, 'head', null, ${value(3)}, 'none', now(), now(), null),
        (${at(4)}, 'head', 4, ${value(4)}, 'none', null, null, null),
        (${at(HEAD_RULES.shownDays)}, 'head', 30, ${value(HEAD_RULES.shownDays)}, 'none', now(), null, null),
        (${at(HEAD_RULES.shownDays - 1)}, 'head', 29, ${value(HEAD_RULES.shownDays - 1)}, 'none', now(), null, null)`);
    const { app } = build();
    const answer = PublicHead.parse(await (await app.request("/api/public/head")).json());
    expect(answer.days).toEqual([
      { day: dayBefore(d, 1), kind: "head", value: value(1), witness: "none", token: null, retiredOn: null, lastDay: null },
      { day: dayBefore(d, 2), kind: "restore", value: value(2), witness: "none", token: null, retiredOn: null, lastDay: dayBefore(d, 5) },
      { day: dayBefore(d, 3), kind: "head", value: value(3), witness: "none", token: null, retiredOn: d, lastDay: null },
      { day: dayBefore(d, HEAD_RULES.shownDays - 1), kind: "head", value: value(HEAD_RULES.shownDays - 1), witness: "none", token: null, retiredOn: null, lastDay: null },
    ]);
  });
});
