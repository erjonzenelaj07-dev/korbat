import { randomUUID } from "node:crypto";
import pino from "pino";
import { expect } from "vitest";
import { ErrorEnvelope, StaffStepUpOptionsResponse, type AuthenticationResponseJSON, type StaffStepUpOptionsRequest } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration, type Moderation } from "../../src/moderation";
import { createProfileStore } from "../../src/profiles/store";
import { socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { casesMedia } from "./moderation-fixtures";
import { enrolKey } from "./staff-enrolment";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

/**
 * The console's side of recovery over HTTP (3f Task 6): the real app with the staff routes, staff accounts with a key
 * enrolled through the flow and signed in from the console's browser, and the key's confirmation of any action, asked for
 * as the console asks for it. recovery-export and http-staff-restore build their world with it.
 */

export const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
export const MARKED = { "x-staff-activity": "1" };

export interface ConsoleStaff {
  id: string;
  handle: string;
  b: Browser;
  assert(challenge: string): AuthenticationResponseJSON;
}

export interface RecoveryWorld {
  config: Config;
  authDb: Db;
  apiDb: Db;
  migrateDb: Db;
  repo: AuthRepo;
  auth: Auth;
  moderation: Moderation;
  mailer: MemoryMailer;
  app: ReturnType<typeof createApp>;
  /** A staff account with a profile and one key, signed in at the console. */
  staff(role: "moderator" | "admin"): Promise<ConsoleStaff>;
  /** The key's confirmation of exactly this action, asked for as the console asks for it. */
  confirmation(s: ConsoleStaff, request: StaffStepUpOptionsRequest): Promise<AuthenticationResponseJSON>;
  /** The status and the code of a refused answer. */
  refusal(res: Response): Promise<[number, string]>;
  /** The staff profiles it made. */
  staffIds: string[];
  close(): Promise<void>;
}

export function recoveryWorld(): RecoveryWorld {
  const config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
  const logger = pino({ level: "silent" });
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
  const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  const repo = createAuthRepo(authDb);
  const mailer = new MemoryMailer();
  const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer, profiles: createProfileStore(apiDb) });
  const rateLimitStore = new MemoryStore();
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: casesMedia(apiDb), rateLimitStore, config, logger });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, staff: createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff }), moderation });
  const staffIds: string[] = [];

  async function staff(role: "moderator" | "admin"): Promise<ConsoleStaff> {
    const { user } = await newStaffAccount(authDb, repo, role);
    const handle = `r_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    staffIds.push(user.id);
    const soft = new SoftAuthenticator();
    const link = await issueEnrolment(migrateDb, user.id);
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    const assert = (challenge: string) => soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: ++counter });
    const b = new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
    const options = await b.fetch("/api/staff/signin/options", { method: "POST" });
    const { challenge } = ((await options.json()) as { options: { challenge: string } }).options;
    const signedIn = await b.fetch("/api/staff/signin/verify", { json: { response: assert(challenge) } });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    return { id: user.id, handle, b, assert };
  }

  async function confirmation(s: ConsoleStaff, request: StaffStepUpOptionsRequest): Promise<AuthenticationResponseJSON> {
    const res = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
    expect(res.status, await res.clone().text()).toBe(200);
    return s.assert(StaffStepUpOptionsResponse.parse(await res.json()).options.challenge);
  }

  const refusal = async (res: Response): Promise<[number, string]> => [res.status, ErrorEnvelope.parse(await res.json()).error.code];

  async function close(): Promise<void> {
    await moderation.settle();
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  }

  return { config, authDb, apiDb, migrateDb, repo, auth, moderation, mailer, app, staff, confirmation, refusal, staffIds, close };
}
