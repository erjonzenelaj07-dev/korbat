import { readFileSync } from "node:fs";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { ALERT_KIND_LIST, ALERT_KINDS, renderAlert, type AlertFacts, type AlertKind } from "@korbat/contracts";
import { createWatcher, type NotifyStore, type OwedPush } from "../../src/notify/main";
import { TOPICS, publish } from "../../src/notify/push";
import { fakeNtfy, type FakeNtfy } from "./fake-ntfy";

/**
 * The publisher (3f design, sections 5 and 7.1 step 5; invariants 14 and 15): every row still owed its push goes to
 * ntfy's topic of its scope with the publisher's token, its priority, its kind as the tag and the fixed text of its kind
 * filled from its facts, which hold counts and times only. A 200 marks it pushed; a 429 (ntfy's request limit) ends the
 * round's publishing and counts nothing (3f's review); anything else counts one attempt and is no cap: the row is tried
 * every round until it is published or past its bound, which is the database's to apply (notify-loop.test.ts). Without a
 * database: the rows come from a store in memory.
 */

const servers: FakeNtfy[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
async function ntfy(now?: () => number) {
  const made = await fakeNtfy(now);
  servers.push(made);
  return made;
}

const NOW = new Date("2026-10-16T09:00:00.000Z");
const row = (id: number, kind: AlertKind, facts: AlertFacts): OwedPush => ({ id, kind, priority: ALERT_KINDS[kind].priority, scope: ALERT_KINDS[kind].scope, facts });

describe("one publish", () => {
  test("goes to the topic of its scope, with the token, its priority, its kind as the tag, the title and the sentence", async () => {
    const s = await ntfy();
    const facts = { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" };
    expect(await publish(fetch, s.url, "tk_secret", row(1, "contact_mail", facts), NOW)).toBe("ok");
    expect(await publish(fetch, s.url, "tk_secret", row(2, "moderation_waiting", { count: 4 }), NOW)).toBe("ok");
    const text = renderAlert("contact_mail", facts, NOW);
    expect(s.published).toEqual([
      { topic: "korbat-oncall", priority: "5", tags: "contact_mail", title: text.title, text: text.sentence, token: "tk_secret", method: "POST" },
      { topic: "korbat-all", priority: "3", tags: "moderation_waiting", title: "Cases are waiting", text: "4 cases or replies are waiting longer than their response time.", token: "tk_secret", method: "POST" },
    ]);
    expect(TOPICS).toEqual({ on_call: "korbat-oncall", all: "korbat-all" });
  });

  test("a refusal is push_refused, and a server that cannot be reached or drops the request push_connect", async () => {
    const s = await ntfy();
    s.fail({ status: 403, count: 1 });
    expect(await publish(fetch, s.url, "tk_secret", row(1, "alert_test", { at: "2026-10-16T08:00:00.000Z" }), NOW)).toBe("push_refused");
    s.fail({ count: 1, drop: true });
    expect(await publish(fetch, s.url, "tk_secret", row(1, "alert_test", { at: "2026-10-16T08:00:00.000Z" }), NOW)).toBe("push_connect");
    expect(await publish(fetch, "http://127.0.0.1:9", "tk_secret", row(1, "alert_test", { at: "2026-10-16T08:00:00.000Z" }), NOW)).toBe("push_connect");
    expect(s.published).toEqual([]);
  });

  test("3f's review: a 429, ntfy's request limit, is throttled: neither a refusal nor a failure to connect", async () => {
    const s = await ntfy();
    s.limit({ burst: 1, refillMs: 60_000 });
    const test = row(1, "alert_test", { at: "2026-10-16T08:00:00.000Z" });
    expect(await publish(fetch, s.url, "tk_secret", test, NOW)).toBe("ok");
    expect(await publish(fetch, s.url, "tk_secret", test, NOW)).toBe("throttled");
    expect(s.published).toHaveLength(1);
  });

  test("every kind with a push leg renders a push that names nobody: no @, no link, nothing but its words, counts and times", async () => {
    const s = await ntfy();
    let id = 0;
    for (const kind of ALERT_KIND_LIST.filter((k) => ALERT_KINDS[k].legs.includes("push"))) {
      const facts: Record<string, number | string> = {};
      for (const name of ALERT_KINDS[kind].facts) facts[name] = name === "at" || name === "since" || name.endsWith("At") ? "2026-10-16T08:59:00.000Z" : 2;
      expect(await publish(fetch, s.url, "tk_secret", row(++id, kind, facts), NOW), kind).toBe("ok");
    }
    expect(s.published.length).toBe(ALERT_KIND_LIST.length - 1);
    for (const p of s.published) {
      expect(`${p.title} ${p.text}`).not.toMatch(/@|http/);
    }
  });
});

/** A store in memory that owes the given rows and records what the round did with them. */
function owing(rows: OwedPush[]) {
  const owed = new Map(rows.map((r) => [r.id, r]));
  const attempts = new Map<number, number>();
  const beats: { mailboxOk: boolean; pushOk: boolean; error: string | null }[] = [];
  const store: NotifyStore = {
    folderMark: async () => null,
    insertMessage: async () => undefined,
    setMark: async () => undefined,
    owedPushes: async () => [...owed.values()].sort((a, b) => a.id - b.id),
    markPushed: async (id) => {
      owed.delete(id);
    },
    markFailed: async (id) => {
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
    },
    beat: async (state) => {
      beats.push(state);
    },
  };
  return { store, owed, attempts, beats };
}

describe("the round's publish step", () => {
  /** A watcher whose mailbox cannot be reached at all, so a round is its publish step and its beat. */
  const watcher = (s: FakeNtfy, store: NotifyStore, now = () => NOW) =>
    createWatcher({
      store,
      imap: { host: "localhost", port: 9, user: "watcher", password: "secret", junk: "Junk", timeoutMs: 500 },
      push: { url: s.url, token: "tk_publisher" },
      fetch,
      now,
      log: pino({ level: "silent" }),
    });

  test("every owed row is published oldest first and marked; the beat says the push worked", async () => {
    const s = await ntfy();
    const m = owing([row(7, "moderation_urgent", { count: 1, oldestAt: "2026-10-16T08:30:00.000Z" }), row(3, "contact_mail", { receivedAt: "2026-10-16T08:05:00.000Z", dueAt: "2026-10-16T09:05:00.000Z" })]);
    const w = watcher(s, m.store);
    const report = await w.round();
    expect(report).toMatchObject({ pushed: 2, pushOk: true, error: "imap_connect" });
    expect(s.published.map((p) => p.tags)).toEqual(["contact_mail", "moderation_urgent"]);
    expect(s.published.every((p) => p.token === "tk_publisher")).toBe(true);
    expect(m.owed.size).toBe(0);
    expect(m.beats).toEqual([{ mailboxOk: false, pushOk: true, error: "imap_connect" }]);
    await w.stop();
  });

  test("a refused row counts an attempt, sets push_refused and stays owed; the next row is still tried; nothing owed reads as a working push", async () => {
    const s = await ntfy();
    const m = owing([row(1, "alert_test", { at: "2026-10-16T08:00:00.000Z" }), row(2, "moderation_burst", { count: 20 })]);
    const w = watcher(s, m.store);
    s.fail({ status: 500, count: 1 });
    expect(await w.round()).toMatchObject({ pushed: 1, pushOk: false });
    expect([...m.owed.keys()]).toEqual([1]);
    expect(m.attempts.get(1)).toBe(1);
    expect(m.beats.at(-1)).toEqual({ mailboxOk: false, pushOk: false, error: "push_refused" });
    // No cap: the next round tries it again, and it goes.
    expect(await w.round()).toMatchObject({ pushed: 1, pushOk: true });
    expect(m.owed.size).toBe(0);
    expect(await w.round()).toMatchObject({ pushed: 0, pushOk: true });
    await w.stop();
  });

  test("ntfy away for four minutes and then answering: the owed rows go when it is back, without anyone touching a row", async () => {
    let clock = NOW.getTime();
    const s = await ntfy(() => clock);
    s.fail({ status: 502, until: clock + 4 * 60_000 });
    const m = owing([row(1, "contact_mail", { receivedAt: "2026-10-16T08:59:00.000Z", dueAt: "2026-10-16T09:59:00.000Z" })]);
    const w = watcher(s, m.store, () => new Date(clock));
    for (let minute = 0; minute < 4; minute++) {
      expect((await w.round()).pushOk, `minute ${minute}`).toBe(false);
      clock += 60_000;
    }
    clock += 1;
    expect(await w.round()).toMatchObject({ pushed: 1, pushOk: true });
    expect(m.attempts.get(1)).toBe(4);
    expect(s.published).toHaveLength(1);
    await w.stop();
  });

  test("3f's review: a 429 ends the round's publishing there: the rest stay owed with no attempt counted, the beat says the push works, and they go as ntfy's bucket refills", async () => {
    let clock = NOW.getTime();
    const s = await ntfy(() => clock);
    s.limit({ burst: 2, refillMs: 5_000 });
    const m = owing([1, 2, 3, 4, 5].map((id) => row(id, "alert_test", { at: "2026-10-16T08:00:00.000Z" })));
    const w = watcher(s, m.store, () => new Date(clock));
    expect(await w.round()).toMatchObject({ pushed: 2, pushOk: true, throttled: true });
    // One request past the bucket and no more: the rows behind it would only be refused too.
    expect(s.requests).toBe(3);
    expect([...m.owed.keys()]).toEqual([3, 4, 5]);
    expect(m.attempts.size).toBe(0);
    expect(m.beats.at(-1)).toEqual({ mailboxOk: false, pushOk: true, error: "imap_connect" });
    clock += 10_000;
    expect(await w.round()).toMatchObject({ pushed: 2, pushOk: true, throttled: true });
    clock += 5_000;
    expect(await w.round()).toMatchObject({ pushed: 1, pushOk: true, throttled: false });
    expect(m.owed.size).toBe(0);
    await w.stop();
  });
});

describe("the watcher's exemption from ntfy's request limit (3f's review, operations3)", () => {
  /** What follows a marker in a file, up to the end of its line. */
  const after = (text: string, marker: string) => {
    const at = text.indexOf(marker);
    return at === -1 ? null : text.slice(at + marker.length).split(String.fromCharCode(10))[0]!;
  };

  test("notify has a fixed address on the push network, inside its default subnet, and ntfy's example exempts that address alone", () => {
    const root = path.resolve(import.meta.dirname, "..", "..", "..", "..");
    const compose = readFileSync(path.join(root, "infra", "compose.yml"), "utf8");
    const example = readFileSync(path.join(root, "infra", "ntfy", "server.yml.example"), "utf8");
    // ntfy resolves a host name only when it starts, before notify exists: the exemption names an address.
    const address = after(compose, "ipv4_address: ${NOTIFY_PUSH_IP:-")?.replace("}", "") ?? null;
    const subnet = after(compose, "subnet: ${PUSH_SUBNET:-")?.replace("}", "") ?? null;
    expect([address, subnet]).toEqual(["172.16.91.254", "172.16.91.0/24"]);
    expect(address!.split(".").slice(0, 3)).toEqual(subnet!.split(".").slice(0, 3));
    expect(after(example, "visitor-request-limit-exempt-hosts: ")).toBe(`"${address}"`);
  });
});
