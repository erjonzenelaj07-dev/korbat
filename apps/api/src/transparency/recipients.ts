import { createHmac, randomBytes } from "node:crypto";
import type Redis from "ioredis";
import type { Logger } from "pino";
import { RECIPIENT_READ_ROUTES, RECIPIENT_RULES } from "@korbat/contracts";
import { clientNetwork } from "../auth";
import type { TransparencyRepo } from "./repo";

/**
 * The recipients' count (3d design, section 2 row 8 and section 7.5), method 1. It counts in sketches that hold no
 * member: a HyperLogLog in Valkey answers "about how many different values were added" and cannot give one back.
 *
 *   A, signed in: every request whose session resolved adds the account's id to `mau:in:<yyyy-mm>`, the UTC month's sketch.
 *   B, signed out (only while RECIPIENTS_SIGNED_OUT is on): a GET of one of the seven public reads of the social module
 *      without a session adds HMAC-SHA-256(the day's salt, network LF user agent) to `mau:out:<yyyy-mm-dd>`, the network
 *      being clientNetwork(address) and the agent cut at 256 bytes. The salt, `mau:salt:<yyyy-mm-dd>`, is 32 random bytes
 *      set once with SET NX and 26 hours to live, kept in memory for its UTC day and written nowhere else, so after 26
 *      hours nobody, korbat included, can compute a digest again. An agent that names itself a crawler is left out; nothing
 *      else is guessed about a reader.
 *
 * Neither call is waited for, and every failure of Valkey is swallowed: counting never fails or slows a request. Every
 * sketch dies 70 days after its first write if the month's close never took it. The close, the transparency job's step on
 * its first round after a UTC month ended, stores two numbers in recipient_months and deletes the month's keys.
 */

/** The part of the Valkey client the sketches use. */
export type SketchStore = Pick<Redis, "pfadd" | "pfcount" | "expire" | "set" | "getBuffer" | "exists" | "del">;

/** What the auth module's resolveSession calls (section 5, `auth.onSeen`); both return at once and never throw. */
export interface RecipientCounter {
  /** A request whose session resolved. */
  seen(accountId: string): void;
  /** A request without a session: counted only for a GET of one of RECIPIENT_READ_ROUTES, and only while the setting is on. */
  seenSignedOut(address: string, userAgent: string, path: string): void;
}

/** The UTC month of an instant, yyyy-mm. */
const monthOf = (at: Date) => at.toISOString().slice(0, 7);
/** The UTC day of an instant, yyyy-mm-dd. */
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/** The three kinds of key the count writes, and no other (invariant 23). */
export const sketchKeys = {
  month: (month: string) => `mau:in:${month}`,
  day: (day: string) => `mau:out:${day}`,
  salt: (day: string) => `mau:salt:${day}`,
};

/**
 * The seven reads as patterns of a GET's path: a parameter matches one segment. Built once from the contracts' list,
 * which names the routes with their method.
 */
const READ_PATHS: readonly RegExp[] = RECIPIENT_READ_ROUTES.map((route) => {
  const path = route.slice(route.indexOf(" ") + 1);
  const pattern = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : segment))
    .join("/");
  return new RegExp(`^${pattern}$`);
});

/** Whether a GET of this path is one of the seven public reads. */
export const isReadRoute = (path: string) => READ_PATHS.some((pattern) => pattern.test(path));

const LF = Buffer.from([10]);
const SKETCH_SECONDS = RECIPIENT_RULES.sketchDays * 86_400;
const SALT_SECONDS = RECIPIENT_RULES.saltHours * 3_600;

export interface RecipientsDeps {
  store: SketchStore;
  /** RECIPIENTS_SIGNED_OUT: whether signed-out readers are counted. */
  signedOut: boolean;
  log: Logger;
  now?: () => Date;
}

/** The two calls the auth module makes, over the store; each failure is logged at debug and dropped. */
export function createRecipientCounter(deps: RecipientsDeps): RecipientCounter {
  const now = deps.now ?? (() => new Date());
  // The day's salt, read or set once a UTC day and kept as a promise, so the requests of a new day's first moment share
  // one SET NX. A failure forgets it, and the next request asks again.
  let salt: { day: string; value: Promise<Buffer> } | null = null;
  const daySalt = (day: string): Promise<Buffer> => {
    if (salt?.day === day) return salt.value;
    const value = (async () => {
      const key = sketchKeys.salt(day);
      await deps.store.set(key, randomBytes(32), "EX", SALT_SECONDS, "NX");
      const stored = await deps.store.getBuffer(key);
      if (stored === null || stored.length !== 32) throw new Error("the day's salt could not be read back");
      return stored;
    })();
    salt = { day, value };
    value.catch(() => {
      if (salt?.value === value) salt = null;
    });
    return value;
  };
  /** Adds one value to a sketch and gives the sketch its days to live from its first write. */
  const add = async (key: string, value: string) => {
    await deps.store.pfadd(key, value);
    await deps.store.expire(key, SKETCH_SECONDS, "NX");
  };
  const swallow = (err: unknown) => deps.log.debug({ err }, "recipients: a count was not recorded");
  return {
    seen(accountId) {
      try {
        add(sketchKeys.month(monthOf(now())), accountId).catch(swallow);
      } catch (err) {
        swallow(err);
      }
    },
    seenSignedOut(address, userAgent, path) {
      if (!deps.signedOut || !isReadRoute(path) || RECIPIENT_RULES.crawler.test(userAgent)) return;
      try {
        const day = dayOf(now());
        const agent = Buffer.from(userAgent, "utf8").subarray(0, RECIPIENT_RULES.userAgentBytes);
        const network = Buffer.from(clientNetwork(address), "utf8");
        daySalt(day)
          .then((key) => add(sketchKeys.day(day), createHmac("sha256", key).update(Buffer.concat([network, LF, agent])).digest("hex")))
          .catch(swallow);
      } catch (err) {
        swallow(err);
      }
    },
  };
}

/** The months before the current one that a close looks at: two, since a sketch lives 70 days. */
const CLOSE_MONTHS = 2;

/** The first day of the month `back` months before the instant's own, as yyyy-mm. */
function monthBefore(at: Date, back: number): string {
  return monthOf(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - back, 1)));
}

/** Every day of a month (yyyy-mm), as yyyy-mm-dd. */
function daysOf(month: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: last }, (_, at) => `${month}-${String(at + 1).padStart(2, "0")}`);
}

/**
 * The month's close (7.5 step 3): for each of the two months before the current one whose signed-in sketch exists and
 * that recipient_months does not hold yet, the sketch's count and, while the setting is on, the sum of its days' counts
 * are stored, and then the month's keys are deleted. A month without a sketch gets no row: it reads as not recorded.
 * Answers the months it stored.
 */
export async function closeMonths(deps: { store: SketchStore; repo: Pick<TransparencyRepo, "monthStored" | "storeMonth">; signedOut: boolean }, at: Date): Promise<string[]> {
  const closed: string[] = [];
  for (let back = CLOSE_MONTHS; back >= 1; back--) {
    const month = monthBefore(at, back);
    const monthKey = sketchKeys.month(month);
    if ((await deps.store.exists(monthKey)) === 0) continue;
    const dayKeys = daysOf(month).map(sketchKeys.day);
    // A row stored by an earlier round that stopped before its delete: the keys go now, and the row stays as it was.
    if (!(await deps.repo.monthStored(month))) {
      const signedIn = await deps.store.pfcount(monthKey);
      let signedOutDays: number | null = null;
      if (deps.signedOut) {
        signedOutDays = 0;
        for (const key of dayKeys) signedOutDays += await deps.store.pfcount(key);
      }
      if (await deps.repo.storeMonth({ month, signedIn, signedOutDays, method: RECIPIENT_RULES.method })) closed.push(month);
    }
    // The row is stored: the sketches are no longer needed, and the days' salts died after their 26 hours.
    await deps.store.del(monthKey, ...dayKeys);
  }
  return closed;
}
