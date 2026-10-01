# korbat staff console (3a) — Task 5 of 9: Step-up: the 74-byte step-up challenge in the codec and the contracts, the parameter-bound action hash over STAFF_STEP_UP_ACTIONS, the step-up flow and requireStaffStepUp, DELETE /api/staff/sessions/:handle confirmed by the session's key with its assertion stored in the record, audit-verify's step-up and key checks, and the route-table tests

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 4 built the ground, the audit record, enrolment, sign-in and staff sessions. This task adds the per-action step-up: its challenge layout, the action's hash, the flow and `requireStaffStepUp`, the first confirmed action (revoking one of one's own staff sessions), `audit-verify`'s checks of every stored confirmation, and the route-table tests. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 2, 5, 7, 10 and 11).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,app): staff sign-in and sessions: a staff key signs in on the console with user verification, its flags checked after the signature and every earlier failure one staff_key_invalid answer, limited per IP first and per key only after the signature; a counter that goes backwards revokes the key and every staff session it opened and mails its owner; staff sessions are read from the database on every request, never cached, their idle end moved only by requests the console marks as its person's own and never past 12 hours, behind a staff cookie with a staff CSRF header; the console reads its session, sessions, keys and the audit log, and signs out; staff.js revoke revokes one key or all of an account's with its sessions and open links, in one transaction with its record, and mails the owner when a key went; the janitor deletes ended staff sessions after 30 days and spent links after a day; requireStaffMfa is gone and the Security screen says staff tools open only with a staff key`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/05-step-up.md 1
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/staff-step-up.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stepUpActionHash, type AuthenticationResponseJSON } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge, readChallenge, readStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { revokeStaffSession, stepUpOptions, verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, type FlowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { revokeConfirmed, revokeRequest, signedIn, stepUpAssertion } from "./staff-step-up";

const APP_ORIGIN = "http://localhost:8081";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
/** BS without BE: no authenticator may report it, and the library refuses it as malformed before the flow sees its flags. */
const BACKED_UP_ONLY: SoftFlags = { up: true, uv: true, be: false, bs: true };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** A response's signature with its last byte changed: the library's check fails, and nothing else about it does. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/** The three members of an assertion the audit row stores. */
const stored = (response: AuthenticationResponseJSON) => ({
  authenticatorData: response.response.authenticatorData,
  clientDataJSON: response.response.clientDataJSON,
  signature: response.response.signature,
});

/**
 * The staff step-up through the auth module's flows on the real database (3a design, section 7, Step-up): the console at
 * http://console.localhost:8090 with the relying party console.localhost, the software authenticator, keys enrolled
 * through the enrolment flow and sessions opened by the sign-in flow. 3a's one confirmed action revokes a staff session.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff step-up", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const ctxOf = (h: FlowHarness) => ({ ...h.ctx, requestId: `req-${randomUUID()}` });
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const sessionRow = async (handle: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.handle, handle)))[0]!;
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));
  const eventsOf = (userId: string, type: "staff_session_revoked" | "staff_key_counter_regression") =>
    migrateDb
      .select({ metadata: authEvents.metadata, ipHash: authEvents.ipHash })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), eq(authEvents.type, type)))
      .orderBy(asc(authEvents.id));

  /**
   * A live staff account holding one key enrolled through the flow, signed in twice with it: from session `a` the person
   * confirms, and `b` is the session they revoke.
   */
  async function twoSessions(h: FlowHarness) {
    const { user } = await newStaffAccount(authDb, repo);
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token);
    const a = await signedIn(h, auth, enrolled.credentialId, 1);
    const b = await signedIn(h, auth, enrolled.credentialId, 2);
    return { user, auth, keyId: enrolled.key.id, credentialId: enrolled.credentialId, a: a.session, b: b.session };
  }

  test("the options: the session's key alone, user verification required, the console's relying party, a 5-minute prompt and a step-up challenge bound to the session and the action", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const { options } = await stepUpOptions(h.deps, s.a, request);
    expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
    expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
    expect(options.userVerification).toBe("required");
    expect(options.timeout).toBe(5 * MINUTE);
    const key = challengeKey(h.deps.config.authHmacKey);
    const actionHash = await stepUpActionHash(request);
    const otherTarget = await stepUpActionHash(revokeRequest(s.a.handle));
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.a.handle, actionHash)).not.toThrow();
    // Bound to this session and this action: another session's handle or another target refuses it, as does every other ceremony.
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.b.handle, actionHash)).toThrow(AuthError);
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.a.handle, otherTarget)).toThrow(AuthError);
    expect(() => readChallenge(key, options.challenge, "staff_signin", h.clock.now())).toThrow(AuthError);
  });

  test("a confirmed revocation: the session revoked, the key's use recorded, staff_session_revoked and its audit row with the action's hash, params, key and assertion, last in one transaction; no mail", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    h.mailer.sent.length = 0;
    const before = await head();
    h.clock.advance(MINUTE);
    const now = h.clock.now();
    const { stepUp, confirmed, revoked, requestId } = await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 3);
    expect(revoked).toBe(true);

    const actionHash = await stepUpActionHash(revokeRequest(s.b.handle));
    expect(confirmed).toEqual({
      action: "staff_session_revoked",
      target: { type: "staff_session", id: s.b.handle },
      params: {},
      actionHash,
      keyId: s.keyId,
      assertion: stored(stepUp),
    });
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(s.a.handle)).revokedAt).toBeNull();
    expect(await keyRow(s.keyId)).toMatchObject({ counter: 3, lastUsedAt: now, revokedAt: null, suspectAt: null });

    // The event names the session revoked and the one that revoked it; the row the account, both sessions and the key,
    // with what audit-verify checks: the action's hash, the params and the assertion exactly as the browser sent it.
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([{ metadata: { handle: s.b.handle, by: s.a.handle }, ipHash: h.ctx.ipHash }]);
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
      ["staff_session_revoked", s.user.id, "staff_session", s.b.handle, s.a.handle, s.keyId, actionHash, stored(stepUp), { params: {} }, requestId],
    ]);
    // One transaction: the revoked session, the event and the audit row, which its last statement wrote.
    const [rows] = await migrateDb.execute<{ session: string; event: string; audit: string; sessionCmin: string; eventCmin: string; auditCmin: string }>(sql`select
      (select xmin::text from auth.staff_sessions where handle = ${s.b.handle}) as session,
      (select xmin::text from auth.auth_events where user_id = ${s.user.id} and type = 'staff_session_revoked') as event,
      (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
      (select cmin::text from auth.staff_sessions where handle = ${s.b.handle}) as "sessionCmin",
      (select cmin::text from auth.auth_events where user_id = ${s.user.id} and type = 'staff_session_revoked') as "eventCmin",
      (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
    expect(new Set([rows!.session, rows!.event, rows!.audit]).size).toBe(1);
    expect(Number(rows!.auditCmin)).toBeGreaterThan(Math.max(Number(rows!.sessionCmin), Number(rows!.eventCmin)));
    // The person did it themselves, with their key: nobody is mailed.
    expect(h.mailer.sent).toEqual([]);
  });

  test("bound to its action and target: an assertion given to revoke one session confirms no other revocation, nor the same one from another session", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const c = await signedIn(h, s.auth, s.credentialId, 3);
    const forB = await stepUpAssertion(h, s.auth, s.credentialId, s.a, revokeRequest(s.b.handle), { counter: 4 });
    for (const [label, session, handle] of [
      ["another target", s.a, c.session.handle],
      ["another session", c.session, s.b.handle],
    ] as const) {
      const err = await failure(verifyStepUp(h.deps, session, revokeRequest(handle), forB, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
    }
    expect((await sessionRow(c.session.handle)).revokedAt).toBeNull();
    expect((await keyRow(s.keyId)).counter).toBe(3);
    // Refused on its binding, before it was spent: it still confirms what it was given for, and only that.
    const confirmed = await verifyStepUp(h.deps, s.a, revokeRequest(s.b.handle), forB, ctxOf(h));
    expect(await revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h))).toBe(true);
    expect((await sessionRow(s.b.handle)).revokedAt).not.toBeNull();
    expect((await sessionRow(c.session.handle)).revokedAt).toBeNull();
  });

  test("single use: a confirmation is spent by its first use, and of two at once exactly one passes", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const once = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    await verifyStepUp(h.deps, s.a, request, once, ctxOf(h));
    const again = await failure(verifyStepUp(h.deps, s.a, request, once, ctxOf(h)));
    expect([again.code, again.status]).toEqual(["staff_step_up_invalid", 403]);

    const twice = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 4 });
    const results = await Promise.allSettled([verifyStepUp(h.deps, s.a, request, twice, ctxOf(h)), verifyStepUp(h.deps, s.a, request, twice, ctxOf(h))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.map((r) => (r.reason as AuthError).code)).toEqual(["staff_step_up_invalid"]);
  });

  test("a confirmation read with less than a minute of its ten left is challenge_expired and confirms nothing, so its row is never written after its expiry", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    for (const age of [9 * MINUTE, 10 * MINUTE]) {
      const late = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
      h.clock.advance(age);
      const err = await failure(verifyStepUp(h.deps, s.a, request, late, ctxOf(h)));
      expect([age, err.code, err.status]).toEqual([age, "challenge_expired", 400]);
    }
    expect((await keyRow(s.keyId)).counter).toBe(2);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
  });

  test("only the session's own key confirms: the person's other key, another account's key, and the right key for the app's origin or relying party are staff_step_up_invalid", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const red = await enrolKey(h, s.auth, (await issueEnrolment(migrateDb, s.user.id)).token, { name: "Red key" });
    const other = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const fresh = async () => (await stepUpOptions(h.deps, s.a, request)).options.challenge;
    const signedBy = async (auth: SoftAuthenticator, credentialId: string, counter: number) =>
      auth.get({ credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: h.deps.config.console!.origin, flags: { up: true, uv: true, be: false, bs: false }, counter });
    const cases: [string, AuthenticationResponseJSON][] = [
      ["the person's other key", await signedBy(s.auth, red.credentialId, 1)],
      ["another account's key", await signedBy(other.auth, other.credentialId, 5)],
      ["the app's origin", await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3, origin: APP_ORIGIN })],
      ["the app's relying party", await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 4, rpId: "localhost" })],
      ["a bad signature", badSignature(await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 5 }))],
    ];
    for (const [label, response] of cases) {
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
    }
    expect((await keyRow(s.keyId)).counter).toBe(2);
    expect((await keyRow(red.key.id)).counter).toBe(0);
    expect((await keyRow(other.keyId)).counter).toBe(2);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
  });

  test("whatever the codec or the library refuses is staff_step_up_invalid, never a passkey code", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const key = challengeKey(h.deps.config.authHmacKey);
    const now = h.clock.now();
    const actionHash = await stepUpActionHash(request);
    const assert = (challenge: string, counter: number) => stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter, challenge });
    const used = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    await verifyStepUp(h.deps, s.a, request, used, ctxOf(h));
    const spent = JSON.parse(Buffer.from(used.response.clientDataJSON, "base64url").toString()).challenge as string;

    const cases: [string, AuthenticationResponseJSON][] = [
      ["a spent challenge", await assert(spent, 4)],
      ["a step-up challenge for another session", await assert(issueStepUpChallenge(key, now, s.b.handle, actionHash), 5)],
      ["a step-up challenge sealed with another key", await assert(issueStepUpChallenge(challengeKey(Buffer.alloc(32, 9)), now, s.a.handle, actionHash), 6)],
      ["the app's sign-in challenge", await assert(issueChallenge(key, "signin", now), 7)],
      ["the app's re-authentication challenge for this session", await assert(issueChallenge(key, "reauth", now, s.a.handle), 8)],
      ["a staff sign-in challenge", await assert(issueChallenge(key, "staff_signin", now), 9)],
      ["a staff registration challenge", await assert(issueChallenge(key, "staff_register", now, randomUUID()), 10)],
      ["a forged challenge", await assert(randomBytes(74).toString("base64url"), 11)],
      ["not a challenge at all", await assert("x", 12)],
    ];
    for (const [label, response] of cases) {
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
      expect(err.code, label).not.toMatch(/^passkey_/);
    }
    // Only the one good confirmation moved the counter.
    expect((await keyRow(s.keyId)).counter).toBe(3);
  });

  test("after the signature, the flags: no UV is staff_key_not_user_verified, BE backed up or not staff_key_not_device_bound, and BS without BE staff_step_up_invalid; none moves the counter", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const cases: [SoftFlags, string][] = [
      [NO_UV, "staff_key_not_user_verified"],
      [SYNCABLE, "staff_key_not_device_bound"],
      [SYNCED, "staff_key_not_device_bound"],
      [BACKED_UP_ONLY, "staff_step_up_invalid"],
    ];
    for (const [flags, code] of cases) {
      const response = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 5, flags });
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), code, 403]);
    }
    expect(await keyRow(s.keyId)).toMatchObject({ counter: 2, revokedAt: null });
    // The counter the refused assertions reported is still ahead of the stored one.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 5)).revoked).toBe(true);
  });

  test("a counter that goes backwards at a step-up revokes the key and every staff session it opened, the confirming one included, records it with via step_up, mails staff_key_suspect and answers staff_key_suspended", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const red = await enrolKey(h, s.auth, (await issueEnrolment(migrateDb, s.user.id)).token, { name: "Red key" });
    const onRed = await signedIn(h, s.auth, red.credentialId, 1);
    h.mailer.sent.length = 0;
    const before = await head();
    h.clock.advance(MINUTE);
    const now = h.clock.now();
    const response = await stepUpAssertion(h, s.auth, s.credentialId, s.a, revokeRequest(s.b.handle), { counter: 2 });
    const err = await failure(verifyStepUp(h.deps, s.a, revokeRequest(s.b.handle), response, ctxOf(h)));
    expect([err.code, err.status]).toEqual(["staff_key_suspended", 403]);

    expect(await keyRow(s.keyId)).toMatchObject({ revokedAt: now, suspectAt: now, counter: 2 });
    expect(await keyRow(red.key.id)).toMatchObject({ revokedAt: null, suspectAt: null });
    expect((await sessionRow(s.a.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(onRed.session.handle)).revokedAt).toBeNull();
    expect((await eventsOf(s.user.id, "staff_key_counter_regression")).map((e) => e.metadata)).toEqual([{ keyId: s.keyId, sessionsRevoked: 2, via: "step_up" }]);
    // The regression's own row, and no revocation as asked: the action never ran.
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
      ["staff_key_counter_regression", s.user.id, "staff_key", s.keyId, { keyId: s.keyId, sessionsRevoked: 2, via: "step_up" }],
    ]);
    expect(h.mailer.sent).toEqual([{ to: s.user.email, template: "staff_key_suspect", data: { name: "Blue key" } }]);
  });

  test("a key revoked or an account demoted between the confirmation and the action ends there: staff_session_required, and nothing is revoked or written", { timeout: 60_000 }, async () => {
    const h = harness();
    const enders: [string, (s: Awaited<ReturnType<typeof twoSessions>>) => Promise<unknown>][] = [
      ["the key revoked", (s) => authDb.update(staffKeys).set({ revokedAt: h.clock.now() }).where(eq(staffKeys.id, s.keyId))],
      ["the account demoted", (s) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id))],
      ["the account deleted", (s) => authDb.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, s.user.id))],
    ];
    for (const [label, end] of enders) {
      const s = await twoSessions(h);
      const request = revokeRequest(s.b.handle);
      const confirmed = await verifyStepUp(h.deps, s.a, request, await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 }), ctxOf(h));
      await end(s);
      const before = await head();
      const err = await failure(revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_session_required", 401]);
      expect((await sessionRow(s.b.handle)).revokedAt, label).toBeNull();
      expect(await head(), label).toEqual(before);
    }
  });

  test("a session that is not the person's own and live is not theirs to revoke: false, and nothing is changed or written", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const other = await twoSessions(h);
    const before = await head();
    // A confirmation for another account's session verifies, since it names that handle, and revokes nothing.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, other.b.handle, 3)).revoked).toBe(false);
    expect((await sessionRow(other.b.handle)).revokedAt).toBeNull();
    // Nor a handle no session has.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, randomUUID(), 4)).revoked).toBe(false);
    // Nor one of the person's own that has already ended: its first end stays as it was.
    const ended = new Date(h.clock.ms() - MINUTE);
    await authDb.update(staffSessions).set({ revokedAt: ended }).where(eq(staffSessions.handle, s.b.handle));
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 5)).revoked).toBe(false);
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(ended);
    expect(await head()).toEqual(before);
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
  });
});
```

### Create `apps/api/test/integration/staff-step-up.ts`

```ts
import { randomUUID } from "node:crypto";
import type { AuthenticationResponseJSON, StaffStepUpOptionsRequest } from "@korbat/contracts";
import { resolveStaffSession, type ActiveStaffSession } from "../../src/auth/staff/sessions";
import { revokeStaffSession, stepUpOptions, verifyStepUp } from "../../src/auth/staff/step-up";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import type { StaffFlowHarness } from "./staff-enrolment";
import { DEVICE_BOUND } from "./staff-fixtures";
import { signInKey } from "./staff-sign-in";

// The staff step-up through the auth module's flows, for the suites that confirm an action without HTTP: the step-up
// suite, and the audit-verify suite, whose step-up rows come only from this flow (3a design, section 12).

/** 3a's one step-up action, revoking a staff session by its handle, as the console asks for it. */
export const revokeRequest = (handle: string): StaffStepUpOptionsRequest => ({ action: "staff_session_revoked", target: { type: "staff_session", id: handle }, params: {} });

/** A staff sign-in with the given counter, and the session it opened as requireStaff reads it. */
export async function signedIn(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, counter: number): Promise<{ token: string; session: ActiveStaffSession }> {
  const { token } = await signInKey(h, auth, credentialId, { counter });
  const session = await resolveStaffSession(h.deps, token, false);
  if (!session) throw new Error("the staff session just opened cannot be read");
  return { token, session };
}

export interface StepUpAssertOptions {
  /** The signature counter the authenticator reports. */
  counter: number;
  flags?: SoftFlags;
  /** The origin and relying party ID the browser signs for; the harness's console unless given. */
  origin?: string;
  rpId?: string;
  /** A challenge of the test's own, in place of fresh step-up options for the request. */
  challenge?: string;
}

/** The software authenticator's answer to fresh step-up options for `request` in `session`, signed by `credentialId`. */
export async function stepUpAssertion(
  h: StaffFlowHarness,
  auth: SoftAuthenticator,
  credentialId: string,
  session: ActiveStaffSession,
  request: StaffStepUpOptionsRequest,
  options: StepUpAssertOptions,
): Promise<AuthenticationResponseJSON> {
  const challenge = options.challenge ?? (await stepUpOptions(h.deps, session, request)).options.challenge;
  return auth.get({
    credentialId,
    rpId: options.rpId ?? h.deps.config.console!.rpId,
    challenge,
    origin: options.origin ?? h.deps.config.console!.origin,
    flags: options.flags ?? DEVICE_BOUND,
    counter: options.counter,
  });
}

/**
 * A whole confirmed revocation of the staff session `handle` from `session`, as the route runs it: the options, the
 * authenticator's answer, requireStaffStepUp's verification, then the revocation with its record.
 */
export async function revokeConfirmed(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, session: ActiveStaffSession, handle: string, counter: number) {
  const request = revokeRequest(handle);
  const stepUp = await stepUpAssertion(h, auth, credentialId, session, request, { counter });
  const ctx = { ...h.ctx, requestId: `req-${randomUUID()}` };
  const confirmed = await verifyStepUp(h.deps, session, request, stepUp, ctx);
  const revoked = await revokeStaffSession(h.deps, session, confirmed, ctx);
  return { stepUp, confirmed, revoked, requestId: ctx.requestId };
}
```

### Create `apps/api/test/staff/route-table.test.ts`

```ts
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { AuditEntry, AuditPage, StaffEnrollVerifyResponse, StaffKey, StaffKeysResponse, StaffMe, StaffSession, StaffSessionsResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createSocial } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const CONSOLE_ORIGIN = "http://console.localhost:8090";

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * The real app with every module and the console on (3a design, section 11). The database pools are created but never
 * connect: only the route table is read. Returns the app and the staff module's own routes, as it would mount them.
 */
function build() {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN: "http://localhost:8081",
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    CONSOLE_ORIGIN,
  });
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-route-table-"));
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: media.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  const staff = createStaff({ apiDb, auth: auth.forStaff });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, staff });
  // What the staff module mounts at /api/staff, as createApp mounts it.
  const staffOwn = staff.routes(CONSOLE_ORIGIN).routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
  return { app, staffOwn };
}

const isStaffPath = (p: string) => p === "/api/staff" || p.startsWith("/api/staff/");
const keyOf = (r: RouteEntry) => `${r.method} ${r.path}`;

/** Each method and path once, sorted: Hono lists a route once for every handler it chains. */
const distinct = (routes: RouteEntry[]) => [...new Set(routes.map(keyOf))].sort();

/**
 * A Hono path as a pattern: a parameter matches one segment, and a final wildcard the path itself and anything below it.
 * The app's paths hold only letters, digits, dashes, underscores and dots, so nothing else needs escaping.
 */
function patternOf(routePath: string): RegExp {
  const segments = routePath.split("/").map((segment) => {
    if (segment === "*") return ".*";
    if (segment.startsWith(":")) return "[^/]+";
    if (!/^[A-Za-z0-9_.-]*$/.test(segment)) throw new Error(`a path segment this check cannot read: ${segment}`);
    return segment.replaceAll(".", "[.]");
  });
  const last = segments.length - 1;
  // "/x/*" matches /x itself too, as Hono routes it.
  const body = segments[last] === ".*" ? `${segments.slice(0, last).join("/")}(/.*)?` : segments.join("/");
  return new RegExp(`^${body}$`);
}

/** Paths under /api/staff a route of another module could answer. */
const STAFF_PROBES = ["/api/staff", "/api/staff/", "/api/staff/me", "/api/staff/sessions", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", "/api/staff/step-up/options", "/api/staff/x/y"];

/**
 * The routes of the app that answer under /api/staff without being the staff module's own: every route not among those
 * the staff module mounts there (as many times as it mounts each) whose path lies under /api/staff or whose pattern
 * reaches a path there. The app's own chain,
 * registered on every path ("ALL /*"), is the one exception: request id, access log, client identity, headers and limits
 * apply to staff paths too (3a design, section 5).
 */
function foreignStaffRoutes(appRoutes: RouteEntry[], staffOwn: RouteEntry[]): string[] {
  const own = new Map<string, number>();
  for (const route of staffOwn) own.set(keyOf(route), (own.get(keyOf(route)) ?? 0) + 1);
  const foreign: string[] = [];
  for (const route of appRoutes) {
    const k = keyOf(route);
    if (k === "ALL /*") continue;
    const left = own.get(k) ?? 0;
    if (left > 0) {
      own.set(k, left - 1);
      continue;
    }
    const pattern = patternOf(route.path);
    if (isStaffPath(route.path) || STAFF_PROBES.some((probe) => pattern.test(probe))) foreign.push(k);
  }
  return foreign;
}

/** A route path naming a role, a grant or a promotion: what a route that changes a role would be called. */
const ROLE_PATH = new RegExp("(^|/)(roles?|grants?|grant-role|promote|demote|make-staff|staff-role)(/|$)", "i");

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
function sources(): { path: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(SRC_ROOT).map((full) => ({ path: path.relative(SRC_ROOT, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") }));
}

/**
 * Where an account's role may be changed: the repository's statements (changeRole for grant-role, setRole for the tests)
 * are reached only through grant-role's grantRole, which only the auth index (for the command line) and grant-role's own
 * command name. A route that changed a role would have to name one of them.
 */
const ROLE_WRITERS = /\b(changeRole|setRole|grantRole)\b/;
const ROLE_WRITER_FILES = new Set(["auth/repo.ts", "auth/admin.ts", "auth/index.ts", "cli/grant-role.ts"]);
const roleWriterViolations = (files: { path: string; source: string }[]) => files.filter((f) => !ROLE_WRITER_FILES.has(f.path) && ROLE_WRITERS.test(f.source)).map((f) => f.path);

/** A member of a staff answer that would name a person beyond their public handle: an address, a device, a phone or an account. */
const PERSONAL = /email|^ip|ipHash|address|device|phone|userId|accountId|actorId|userAgent|webauthn/i;

describe("the staff routes in the route table (3a design, section 11)", () => {
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up and the confirmed revocation", () => {
    const { app } = build();
    expect(distinct(app.routes.filter((r) => isStaffPath(r.path)))).toEqual(
      [
        "ALL /api/staff/*",
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "GET /api/staff/me",
        "GET /api/staff/sessions",
        "GET /api/staff/keys",
        "GET /api/staff/audit",
        "POST /api/staff/signout",
        "POST /api/staff/step-up/options",
        "DELETE /api/staff/sessions/:handle",
      ].sort(),
    );
  });

  test("hold no route of another module under /api/staff", () => {
    const { app, staffOwn } = build();
    expect(staffOwn.length).toBeGreaterThan(0);
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([]);
  });

  test("the check catches another module's route under /api/staff, a pattern that reaches it, and a second copy of a staff route", () => {
    const staffSub = new Hono();
    staffSub.use("*", async (_c, next) => next());
    staffSub.get("/me", (c) => c.text("staff"));
    const app = new Hono();
    app.use(async (_c, next) => next());
    app.route("/api/staff", staffSub);
    // As the social module is mounted at /api: a route of its own under /api/staff, one whose parameter reaches it, and a
    // copy of a staff route.
    const other = new Hono();
    other.get("/staff/extra", (c) => c.text("other"));
    other.get("/:section/me", (c) => c.text("other"));
    other.get("/staff/me", (c) => c.text("other"));
    other.get("/profiles/:handle", (c) => c.text("other"));
    app.route("/api", other);
    const staffOwn = staffSub.routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual(["GET /api/staff/extra", "GET /api/:section/me", "GET /api/staff/me"]);
  });

  test("no route changes a role: no path names one, and only grant-role's command line reaches the statements that do", () => {
    const { app } = build();
    expect(app.routes.filter((r) => ROLE_PATH.test(r.path)).map(keyOf)).toEqual([]);
    expect(roleWriterViolations(sources())).toEqual([]);
    // The rules catch a deliberate violation.
    expect(ROLE_PATH.test("/api/staff/users/:id/role")).toBe(true);
    expect(ROLE_PATH.test("/api/admin/grant")).toBe(true);
    expect(ROLE_PATH.test("/api/profiles/:handle")).toBe(false);
    expect(
      roleWriterViolations([
        { path: "staff/routes.ts", source: "routes.post('/x', (c) => auth.grantRole(email, 'admin'))" },
        { path: "auth/flows/x.ts", source: "await deps.repo.setRole(userId, 'admin');" },
        { path: "cli/grant-role.ts", source: "await grantRole(deps, email, role);" },
      ]),
    ).toEqual(["staff/routes.ts", "auth/flows/x.ts"]);
  });

  test("no route acts as another user or reads another user's sessions, email, IP, device or phone: no staff path names an account, and no staff answer has a member that would", () => {
    const { app } = build();
    // The one path parameter under /api/staff is a staff session's handle, which the revocation takes only from the
    // person's own sessions (the step-up suites show another account's is not found).
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual(["DELETE /api/staff/sessions/:handle"]);
    const answers = { StaffMe, StaffSession, StaffKey, AuditEntry, StaffSessionsResponse, StaffKeysResponse, AuditPage, StaffEnrollVerifyResponse };
    const members = Object.entries(answers).flatMap(([name, schema]) => Object.keys(schema.shape).map((member) => `${name}.${member}`));
    expect(members.filter((member) => PERSONAL.test(member.split(".")[1]!))).toEqual([]);
    // The browser's coarse label and the actor's public handle are what the console shows of a session and a row.
    expect(members).toContain("StaffSession.browser");
    expect(members).toContain("AuditEntry.actorHandle");
    expect(PERSONAL.test("email")).toBe(true);
    expect(PERSONAL.test("ipHash")).toBe(true);
    expect(PERSONAL.test("deviceId")).toBe(true);
  });
});
```

### Replace `apps/api/test/auth/passkey-challenge.test.ts` (whole file)

```ts
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding } from "@korbat/contracts";
import { AuthError } from "../../src/auth/context";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
  CHALLENGE_TTL_MS,
  STEP_UP_READ_MARGIN_MS,
  challengeKey,
  issueChallenge,
  issueStepUpChallenge,
  readChallenge,
  readStepUpChallenge,
  spendChallenge,
  type ChallengePurpose,
} from "../../src/auth/passkeys/challenge";

const AUTH_HMAC_KEY = Buffer.alloc(32, 3);
const KEY = challengeKey(AUTH_HMAC_KEY);
const T0 = 1_789_000_000_000;
const at = (ms: number) => new Date(T0 + ms);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const OTHER_HANDLE = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
/** A staff enrolment's id, which a staff registration challenge is bound to (3a design, section 5). */
const ENROLMENT = "5d0c8e2f-9a41-4b7e-8c3d-2f6a1e9b7c05";
const OTHER_ENROLMENT = "a83f1c62-0e5d-4f9b-b217-6d4e9c0a3b18";
const PURPOSES: ChallengePurpose[] = ["signin", "register", "reauth", "staff_signin", "staff_register"];
/** The purposes whose challenge binds nothing: the two sign-ins, which run before any session or enrolment is known. */
const UNBOUND: ChallengePurpose[] = ["signin", "staff_signin"];
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const bytesOf = (challenge: string) => Buffer.from(challenge, "base64url");
const mac = (first42: Buffer) => createHmac("sha256", KEY).update(first42).digest().subarray(0, 16);
/** Seals 42 bytes as the codec does, so a test can build a challenge whose MAC holds while a field inside it is wrong. */
const sealed = (first42: Buffer) => Buffer.concat([first42, mac(first42)]).toString("base64url");
const spentKey = (challenge: string) => `webauthn-used:${sha256Hex(challenge)}`;

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

function expectInvalid(read: () => unknown) {
  const err = refusal(read);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

describe("passkey challenges: the key", () => {
  test("is HKDF-SHA256 of AUTH_HMAC_KEY with an empty salt and the korbat-webauthn-challenge label, derived once per key", () => {
    expect(KEY.equals(Buffer.from(hkdfSync("sha256", AUTH_HMAC_KEY, "", "korbat-webauthn-challenge", 32)))).toBe(true);
    expect(KEY).toHaveLength(32);
    expect(KEY.equals(AUTH_HMAC_KEY)).toBe(false);
    // The same buffer comes back, so the flows can ask for it on every request without deriving it again.
    expect(challengeKey(AUTH_HMAC_KEY)).toBe(KEY);
    expect(challengeKey(Buffer.alloc(32, 4)).equals(KEY)).toBe(false);
  });
});

describe("passkey challenges: issuing and reading", () => {
  test("lays out 58 bytes: version, purpose, expiry, nonce, binding and an HMAC over the first 42, as unpadded base64url", () => {
    const cases: [ChallengePurpose, number, string | undefined][] = [
      ["signin", 1, undefined],
      ["register", 2, HANDLE],
      ["reauth", 3, HANDLE],
      // The staff console's two purposes share the layout, the key, the lifetime and the used-challenge markers.
      ["staff_signin", 4, undefined],
      ["staff_register", 5, ENROLMENT],
    ];
    for (const [purpose, code, bind] of cases) {
      const challenge = issueChallenge(KEY, purpose, at(0), bind);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
      const bytes = bytesOf(challenge);
      expect(bytes).toHaveLength(58);
      expect(bytes[0]).toBe(1);
      expect(bytes[1]).toBe(code);
      expect(Number(bytes.readBigUInt64BE(2))).toBe(T0 + 10 * MINUTE);
      const binding = bind === undefined ? Buffer.alloc(16) : createHash("sha256").update(bind).digest().subarray(0, 16);
      expect(bytes.subarray(26, 42).equals(binding)).toBe(true);
      expect(bytes.subarray(42).equals(mac(bytes.subarray(0, 42)))).toBe(true);
      expect(() => readChallenge(KEY, challenge, purpose, at(0), bind)).not.toThrow();
    }
    expect(CHALLENGE_TTL_MS).toBe(10 * MINUTE);
  });

  test("draws a fresh 16-byte nonce for every challenge", () => {
    const a = bytesOf(issueChallenge(KEY, "signin", at(0)));
    const b = bytesOf(issueChallenge(KEY, "signin", at(0)));
    expect(a.subarray(0, 10).equals(b.subarray(0, 10))).toBe(true);
    expect(a.subarray(10, 26).equals(b.subarray(10, 26))).toBe(false);
    expect(a.subarray(26, 42).equals(b.subarray(26, 42))).toBe(true);
  });

  test("refuses every tampered byte, the expiry and the MAC included, as passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    for (let i = 0; i < 58; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readChallenge(KEY, bytes.toString("base64url"), "reauth", at(0), HANDLE));
    }
  });

  test("refuses a challenge sealed with another key", () => {
    const foreign = issueChallenge(challengeKey(Buffer.alloc(32, 4)), "signin", at(0));
    expectInvalid(() => readChallenge(KEY, foreign, "signin", at(0)));
  });

  test("refuses anything that is not exactly 58 bytes of canonical, unpadded base64url", () => {
    const challenge = issueChallenge(KEY, "signin", at(0));
    const bytes = bytesOf(challenge);
    // Node's decoder ignores the 4 spare bits of the last character: this other string names the very same 58 bytes.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(nonCanonical).not.toBe(challenge);
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    const malformed = [
      "",
      bytes.subarray(0, 57).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}==`,
      bytes.toString("base64"),
      `+${challenge.slice(1)}`,
      ` ${challenge.slice(1)}`,
      nonCanonical,
      "A".repeat(10_000),
    ];
    for (const candidate of malformed) expectInvalid(() => readChallenge(KEY, candidate, "signin", at(0)));
  });

  test("refuses a sealed challenge of another version or with an unknown purpose byte", () => {
    const first42 = bytesOf(issueChallenge(KEY, "signin", at(0))).subarray(0, 42);
    const version2 = Buffer.from(first42);
    version2[0] = 2;
    expectInvalid(() => readChallenge(KEY, sealed(version2), "signin", at(0)));
    // 4 and 5 are the staff console's purposes, which the purpose tests below cover.
    for (const purpose of [0, 99, 255]) {
      const unknown = Buffer.from(first42);
      unknown[1] = purpose;
      expectInvalid(() => readChallenge(KEY, sealed(unknown), "signin", at(0)));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readChallenge(KEY, sealed(Buffer.from(first42)), "signin", at(0))).not.toThrow();
  });

  test("refuses a challenge issued for another purpose", () => {
    for (const issued of PURPOSES) {
      const bind = UNBOUND.includes(issued) ? undefined : HANDLE;
      const challenge = issueChallenge(KEY, issued, at(0), bind);
      for (const expected of PURPOSES.filter((p) => p !== issued)) expectInvalid(() => readChallenge(KEY, challenge, expected, at(0), bind));
    }
  });

  test("refuses a challenge bound to another session's handle, and a bound one where none is expected", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0), OTHER_HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0)));
    expect(() => readChallenge(KEY, challenge, "reauth", at(0), HANDLE)).not.toThrow();
  });

  test("refuses a sign-in challenge, whose binding is zeros, where a binding is expected", () => {
    const signin = issueChallenge(KEY, "signin", at(0));
    expectInvalid(() => readChallenge(KEY, signin, "signin", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "reauth", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "register", at(0), HANDLE));
    // An unbound challenge of the right purpose is refused on its binding alone.
    const unbound = issueChallenge(KEY, "register", at(0));
    expectInvalid(() => readChallenge(KEY, unbound, "register", at(0), HANDLE));
  });

  test("expires exactly ten minutes after it was issued, as challenge_expired", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    expect(() => readChallenge(KEY, challenge, "register", at(CHALLENGE_TTL_MS - 1), HANDLE)).not.toThrow();
    for (const when of [CHALLENGE_TTL_MS, CHALLENGE_TTL_MS + 1, HOUR]) {
      const err = refusal(() => readChallenge(KEY, challenge, "register", at(when), HANDLE));
      expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    }
  });

  test("checks the seal, the purpose and the binding before the expiry, so an expired forgery is still passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    const late = at(HOUR);
    const tampered = bytesOf(challenge);
    tampered[20] = tampered[20]! ^ 0x80;
    expectInvalid(() => readChallenge(KEY, tampered.toString("base64url"), "register", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "register", late, OTHER_HANDLE));
  });
});

describe("passkey challenges: the staff console's purposes", () => {
  test("an app sign-in challenge does not open the console's sign-in, and a console sign-in challenge does not sign into the app", () => {
    const app = issueChallenge(KEY, "signin", at(0));
    const staff = issueChallenge(KEY, "staff_signin", at(0));
    expectInvalid(() => readChallenge(KEY, app, "staff_signin", at(0)));
    expectInvalid(() => readChallenge(KEY, staff, "signin", at(0)));
    expect(() => readChallenge(KEY, app, "signin", at(0))).not.toThrow();
    expect(() => readChallenge(KEY, staff, "staff_signin", at(0))).not.toThrow();
  });

  test("a personal passkey's registration challenge does not enrol a staff key, nor the reverse, whatever they are bound to", () => {
    const personal = issueChallenge(KEY, "register", at(0), ENROLMENT);
    const staff = issueChallenge(KEY, "staff_register", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, personal, "staff_register", at(0), ENROLMENT));
    expectInvalid(() => readChallenge(KEY, staff, "register", at(0), HANDLE));
  });

  test("a staff registration challenge is bound to its enrolment's id, and refused for another enrolment or none", () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    // The binding takes any string: the first 16 bytes of the sha256 of the enrolment's id, as of a session's handle.
    expect(bytesOf(challenge).subarray(26, 42).equals(createHash("sha256").update(ENROLMENT).digest().subarray(0, 16))).toBe(true);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(0), ENROLMENT)).not.toThrow();
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0), OTHER_ENROLMENT));
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0)));
    // An unbound one of the right purpose names no enrolment.
    expectInvalid(() => readChallenge(KEY, issueChallenge(KEY, "staff_register", at(0)), "staff_register", at(0), ENROLMENT));
  });

  test("a staff sign-in challenge binds nothing, and is refused where a binding is expected", () => {
    const challenge = issueChallenge(KEY, "staff_signin", at(0));
    expect(bytesOf(challenge).subarray(26, 42).equals(Buffer.alloc(16))).toBe(true);
    expectInvalid(() => readChallenge(KEY, challenge, "staff_signin", at(0), HANDLE));
  });

  test("the staff purposes expire after ten minutes as challenge_expired, and are spent once", async () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS - 1), ENROLMENT)).not.toThrow();
    expect(refusal(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS), ENROLMENT)).code).toBe("challenge_expired");
    const kv = new MemoryKv(() => T0);
    await spendChallenge(kv, challenge, at(0));
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
  });
});

describe("passkey challenges: the step-up layout", () => {
  const LF = String.fromCharCode(10);
  /** 3a's one step-up action on a staff session, and variations of each part it binds. */
  const revoke = { action: "staff_session_revoked", target: { type: "staff_session", id: OTHER_HANDLE }, params: {} };
  const L = STAFF_STEP_UP_CHALLENGE;
  /** Seals 58 bytes as the codec does for a step-up challenge. */
  const sealedStepUp = (first58: Buffer) => Buffer.concat([first58, mac(first58)]).toString("base64url");

  test("lays out 74 bytes at the contracts' offsets: version, the step-up purpose, expiry, nonce, the full 32-byte binding and an HMAC over the first 58", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{99}$/);
    expect(challenge).toHaveLength(L.encodedLength);
    const bytes = bytesOf(challenge);
    expect(bytes).toHaveLength(74);
    expect(bytes[L.versionAt]).toBe(1);
    expect(bytes[L.purposeAt]).toBe(6);
    expect(Number(bytes.readBigUInt64BE(L.expiryAt))).toBe(T0 + 10 * MINUTE);
    // The binding is every byte of the sha256 of the session's handle, a newline and the action's hash, not a prefix.
    const binding = createHash("sha256").update(`${HANDLE}${LF}${actionHash}`).digest();
    expect(bytes.subarray(L.bindingAt, L.sealAt).equals(binding)).toBe(true);
    expect(bytes.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(HANDLE, actionHash)))).toBe(true);
    expect(bytes.subarray(L.sealAt).equals(mac(bytes.subarray(0, L.sealAt)))).toBe(true);
    expect(() => readStepUpChallenge(KEY, challenge, at(0), HANDLE, actionHash)).not.toThrow();
  });

  test("draws a fresh nonce for every challenge", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const a = bytesOf(issueStepUpChallenge(KEY, at(0), HANDLE, actionHash));
    const b = bytesOf(issueStepUpChallenge(KEY, at(0), HANDLE, actionHash));
    expect(a.subarray(L.nonceAt, L.bindingAt).equals(b.subarray(L.nonceAt, L.bindingAt))).toBe(false);
    expect(a.subarray(L.bindingAt, L.sealAt).equals(b.subarray(L.bindingAt, L.sealAt))).toBe(true);
  });

  test("is refused for another session, another action, another target or other params", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    expectInvalid(() => readStepUpChallenge(KEY, challenge, at(0), OTHER_HANDLE, actionHash));
    const others = [
      { ...revoke, action: "staff_key_revoked" },
      { ...revoke, target: { type: "staff_session", id: HANDLE } },
      { ...revoke, target: { type: "staff_key", id: OTHER_HANDLE } },
      // 3a's one action has empty params, so other params never reach the binding over HTTP: they are tested here.
      { ...revoke, params: { all: true } },
      { ...revoke, params: { reason: "R2", items: [1, 2] } },
    ];
    for (const other of others) {
      const otherHash = await stepUpActionHash(other);
      expect(otherHash).not.toBe(actionHash);
      expectInvalid(() => readStepUpChallenge(KEY, challenge, at(0), HANDLE, otherHash));
    }
  });

  test("is refused by every other ceremony, and no other ceremony's challenge is read as a step-up", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const stepUp = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    for (const purpose of PURPOSES) {
      expectInvalid(() => readChallenge(KEY, stepUp, purpose, at(0), UNBOUND.includes(purpose) ? undefined : HANDLE));
      const other = issueChallenge(KEY, purpose, at(0), UNBOUND.includes(purpose) ? undefined : HANDLE);
      expectInvalid(() => readStepUpChallenge(KEY, other, at(0), HANDLE, actionHash));
    }
  });

  test("refuses every tampered byte, a challenge sealed with another key, and one of another version or purpose", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    for (let i = 0; i < L.bytes; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readStepUpChallenge(KEY, bytes.toString("base64url"), at(0), HANDLE, actionHash));
    }
    expectInvalid(() => readStepUpChallenge(KEY, issueStepUpChallenge(challengeKey(Buffer.alloc(32, 4)), at(0), HANDLE, actionHash), at(0), HANDLE, actionHash));
    const first58 = bytesOf(challenge).subarray(0, L.sealAt);
    for (const [at_, value] of [
      [L.versionAt, 2],
      [L.purposeAt, 1],
      [L.purposeAt, 5],
      [L.purposeAt, 7],
    ] as const) {
      const changed = Buffer.from(first58);
      changed[at_] = value;
      expectInvalid(() => readStepUpChallenge(KEY, sealedStepUp(changed), at(0), HANDLE, actionHash));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readStepUpChallenge(KEY, sealedStepUp(Buffer.from(first58)), at(0), HANDLE, actionHash)).not.toThrow();
  });

  test("refuses anything that is not exactly 74 bytes of canonical, unpadded base64url", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    const bytes = bytesOf(challenge);
    // 74 bytes leave 4 spare bits in the last character, which Node's decoder ignores.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    for (const candidate of [
      "",
      bytes.subarray(0, 73).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}=`,
      bytes.toString("base64"),
      nonCanonical,
      "A".repeat(10_000),
    ]) {
      expectInvalid(() => readStepUpChallenge(KEY, candidate, at(0), HANDLE, actionHash));
    }
  });

  test("carries an expiry ten minutes after it was issued, but is read only while a minute of that is left: challenge_expired, checked after the seal and the binding", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    // The expiry it carries, which audit-verify compares with the row's time, is the full ten minutes.
    expect(Number(bytesOf(challenge).readBigUInt64BE(L.expiryAt))).toBe(T0 + CHALLENGE_TTL_MS);
    expect(STEP_UP_READ_MARGIN_MS).toBe(MINUTE);
    expect(() => readStepUpChallenge(KEY, challenge, at(CHALLENGE_TTL_MS - STEP_UP_READ_MARGIN_MS - 1), HANDLE, actionHash)).not.toThrow();
    for (const late of [CHALLENGE_TTL_MS - STEP_UP_READ_MARGIN_MS, CHALLENGE_TTL_MS - 1, CHALLENGE_TTL_MS]) {
      const err = refusal(() => readStepUpChallenge(KEY, challenge, at(late), HANDLE, actionHash));
      expect([late, err.code, err.status]).toEqual([late, "challenge_expired", 400]);
    }
    // An expired challenge for another session is still passkey_invalid: nothing tells which field failed first.
    expectInvalid(() => readStepUpChallenge(KEY, challenge, at(HOUR), OTHER_HANDLE, actionHash));
  });

  test("is spent once through the same used-challenge markers, for the rest of its life", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, await stepUpActionHash(revoke));
    await spendChallenge(kv, challenge, at(0));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)))).code).toBe("challenge_expired");
  });
});

describe("passkey challenges: single use", () => {
  test("a challenge is spent once, and its marker lives exactly as long as the challenge", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueChallenge(KEY, "signin", at(0));
    clock = T0 + MINUTE;
    await spendChallenge(kv, challenge, at(MINUTE));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    const second = await failure(spendChallenge(kv, challenge, at(MINUTE)));
    expect([second.code, second.status]).toEqual(["passkey_invalid", 401]);
    clock = T0 + CHALLENGE_TTL_MS - 1;
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS - 1)))).code).toBe("passkey_invalid");
    // Past its expiry the challenge is refused by readChallenge, so the marker has nothing left to guard.
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("two concurrent spends of the same challenge: exactly one wins", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    const results = await Promise.allSettled([spendChallenge(kv, challenge, at(0)), spendChallenge(kv, challenge, at(0))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AuthError);
    expect((rejected[0]!.reason as AuthError).code).toBe("passkey_invalid");
  });

  test("spending at or after the expiry is challenge_expired and writes no marker", async () => {
    const kv = new MemoryKv(() => T0 + CHALLENGE_TTL_MS);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const err = await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)));
    expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("a malformed or non-canonical string cannot be spent, so it can never mark a second copy of a challenge", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    for (const candidate of [nonCanonical, "", "not a challenge", challenge.slice(0, -2)]) {
      expect((await failure(spendChallenge(kv, candidate, at(0)))).code).toBe("passkey_invalid");
      expect(await kv.get(spentKey(candidate))).toBeNull();
    }
    await spendChallenge(kv, challenge, at(0));
  });

  test("spending one challenge leaves every other one spendable", async () => {
    const kv = new MemoryKv(() => T0);
    const a = issueChallenge(KEY, "signin", at(0));
    const b = issueChallenge(KEY, "signin", at(0));
    await spendChallenge(kv, a, at(0));
    await spendChallenge(kv, b, at(0));
    expect((await failure(spendChallenge(kv, a, at(0)))).code).toBe("passkey_invalid");
  });
});
```

### Replace `apps/api/test/auth/passkey-webauthn.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { AuthError } from "../../src/auth/context";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../../src/auth/passkeys/challenge";
import {
  CEREMONY_TIMEOUT_MS,
  MAX_CREDENTIAL_ID_BYTES,
  SUPPORTED_ALGORITHMS,
  authenticationOptions,
  isCounterRegression,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRecordedAssertion,
  verifyRegistration,
} from "../../src/auth/passkeys/webauthn";
import { SoftAuthenticator, type CborValue, type SoftCreateInput, type SoftFlags } from "./soft-authenticator";

// The library's two verification calls, wrapped so a test can prove when korbat never reached them. They still run the
// real code.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse),
    verifyAuthenticationResponse: vi.fn(actual.verifyAuthenticationResponse),
  };
});

const RP_ID = "localhost";
const RP_NAME = "korbat";
const ORIGIN = "http://localhost:8081";
const ORIGINS = [ORIGIN];
const KEY = challengeKey(Buffer.alloc(32, 3));
const NOW = new Date(1_789_000_000_000);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const USER_HANDLE = Buffer.alloc(32, 7);
const AAGUID = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const libraryRegistration = vi.mocked(verifyRegistrationResponse);
const libraryAuthentication = vi.mocked(verifyAuthenticationResponse);

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  libraryRegistration.mockClear();
  libraryAuthentication.mockClear();
  // Certificate-carrying formats make the library fetch revocation lists; nothing here may reach the network.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in unit tests"));
});
afterEach(() => {
  fetchSpy.mockRestore();
});

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the passkey step to be refused");
}

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the passkey step to be refused");
}

async function expectInvalid(promise: Promise<unknown>) {
  const err = await failure(promise);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

/** A registration response to a fresh registration challenge bound to HANDLE, and that challenge. */
function registrationResponse(auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}) {
  const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
  const response = auth.create({ rpId: RP_ID, challenge, origin: ORIGIN, userHandle: USER_HANDLE, flags: ALL, ...overrides });
  return { challenge, response };
}

/** A passkey korbat accepted, with the response it came from. */
async function registered(auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}) {
  const { challenge, response } = registrationResponse(auth, overrides);
  const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
  return { response, passkey };
}

/** An assertion by a registered passkey to a fresh re-authentication challenge, and that challenge. */
function assertion(auth: SoftAuthenticator, credentialId: string, flags: SoftFlags, counter: number, at: { rpId?: string; origin?: string } = {}) {
  const challenge = issueChallenge(KEY, "reauth", NOW, HANDLE);
  const response = auth.get({ credentialId, rpId: at.rpId ?? RP_ID, challenge, origin: at.origin ?? ORIGIN, flags, counter });
  return { challenge, response };
}

describe("passkey options", () => {
  test("registration options carry korbat's challenge unchanged, the user handle, the label, the pinned algorithms and discoverable credentials", async () => {
    const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
    const options = await registrationOptions({
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_HANDLE, name: "ada on the laptop", displayName: "ada on the laptop" },
      exclude: [{ id: "AAECAw", transports: ["internal", "hybrid"] }],
      challenge,
    });
    // The exact string korbat issued, so the browser signs it and readChallenge can read it back.
    expect(options.challenge).toBe(challenge);
    expect(() => readChallenge(KEY, options.challenge, "register", NOW, HANDLE)).not.toThrow();
    expect(options.rp).toEqual({ name: RP_NAME, id: RP_ID });
    expect(options.user).toEqual({ id: USER_HANDLE.toString("base64url"), name: "ada on the laptop", displayName: "ada on the laptop" });
    // Ed25519, ES256, RS256 in that order; never the runtime default, which adds ML-DSA on Node 24.
    expect(SUPPORTED_ALGORITHMS).toEqual([-8, -7, -257]);
    expect(options.pubKeyCredParams).toEqual([
      { alg: -8, type: "public-key" },
      { alg: -7, type: "public-key" },
      { alg: -257, type: "public-key" },
    ]);
    expect(CEREMONY_TIMEOUT_MS).toBe(300_000);
    expect(options.timeout).toBe(300_000);
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
    // No hint unless a caller asks for one: 1c's registration names no kind of authenticator.
    expect(options.hints).toEqual([]);
    expect(options.excludeCredentials).toEqual([{ id: "AAECAw", transports: ["internal", "hybrid"], type: "public-key" }]);
  });

  test("registration options require user verification only when asked, and carry the security-key hint only when asked", async () => {
    const input = () => ({
      rp: { id: "console.localhost", name: RP_NAME },
      user: { id: USER_HANDLE, name: "Blue key", displayName: "Blue key" },
      exclude: [],
      challenge: issueChallenge(KEY, "staff_register", NOW, HANDLE),
    });
    // What every staff ceremony asks for (3a design, section 5); 1c's callers name nothing and keep "preferred".
    const required = await registrationOptions({ ...input(), userVerification: "required" });
    expect(required.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    expect(required.hints).toEqual([]);
    expect((await registrationOptions({ ...input(), userVerification: "preferred" })).authenticatorSelection!.userVerification).toBe("preferred");
    expect((await registrationOptions(input())).authenticatorSelection!.userVerification).toBe("preferred");
    // The enrolment's "Register a security key" button: the library sends the hint only with cross-platform attachment,
    // which is why "Use Windows Hello on this computer" sends none.
    const securityKey = await registrationOptions({ ...input(), userVerification: "required", hint: "securityKey" });
    expect(securityKey.hints).toEqual(["security-key"]);
    expect(securityKey.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required", authenticatorAttachment: "cross-platform" });
    // The library writes the attachment into the object it is given: the next call without a hint has none.
    expect((await registrationOptions({ ...input(), userVerification: "required" })).authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
  });

  test("authentication options require user verification only when asked", async () => {
    const challenge = () => issueChallenge(KEY, "staff_signin", NOW);
    expect((await authenticationOptions({ rpId: "console.localhost", allow: [], challenge: challenge(), userVerification: "required" })).userVerification).toBe("required");
    expect((await authenticationOptions({ rpId: RP_ID, allow: [], challenge: challenge(), userVerification: "preferred" })).userVerification).toBe("preferred");
    expect((await authenticationOptions({ rpId: RP_ID, allow: [], challenge: challenge() })).userVerification).toBe("preferred");
  });

  test("two calls never share an authenticatorSelection object, which the library writes into", async () => {
    const input = () => ({
      rp: { id: RP_ID, name: RP_NAME },
      user: { id: USER_HANDLE, name: "ada", displayName: "ada" },
      exclude: [],
      challenge: issueChallenge(KEY, "register", NOW, HANDLE),
    });
    const first = await registrationOptions(input());
    const second = await registrationOptions(input());
    expect(first.authenticatorSelection).not.toBe(second.authenticatorSelection);
    first.authenticatorSelection!.residentKey = "discouraged";
    first.authenticatorSelection!.userVerification = "discouraged";
    expect(second.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
    expect((await registrationOptions(input())).authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });
  });

  test("sign-in options list no credentials, so they say nothing about any account", async () => {
    const challenge = issueChallenge(KEY, "signin", NOW);
    const options = await authenticationOptions({ rpId: RP_ID, allow: [], challenge });
    expect(options.challenge).toBe(challenge);
    expect(options.allowCredentials).toEqual([]);
    expect(options.rpId).toBe(RP_ID);
    expect(options.timeout).toBe(300_000);
    expect(options.userVerification).toBe("preferred");
    expect(() => readChallenge(KEY, options.challenge, "signin", NOW)).not.toThrow();
  });

  test("re-authentication options list the account's passkeys with their transports", async () => {
    const challenge = issueChallenge(KEY, "reauth", NOW, HANDLE);
    const options = await authenticationOptions({ rpId: RP_ID, allow: [{ id: "AAECAw", transports: ["usb"] }, { id: "BAUG", transports: [] }], challenge });
    expect(options.challenge).toBe(challenge);
    expect(options.allowCredentials).toEqual([
      { id: "AAECAw", transports: ["usb"], type: "public-key" },
      { id: "BAUG", transports: [], type: "public-key" },
    ]);
  });
});

describe("passkey registration", () => {
  test("verifies a registration and returns what korbat stores, with the flags", async () => {
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { counter: 4, aaguid: AAGUID });
    const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
    expect(passkey).toEqual({
      credentialId: response.id,
      publicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      counter: 4,
      transports: ["internal", "hybrid"],
      aaguid: AAGUID,
      backupEligible: true,
      backedUp: true,
      userVerified: true,
    });
    // The public key is the COSE key from the authenticator data, as base64url: an ES256 key on P-256.
    const cose = isoCBOR.decodeFirst<Map<number, unknown>>(Uint8Array.from(Buffer.from(passkey.publicKey, "base64url")));
    expect([cose.get(1), cose.get(3), cose.get(-1)]).toEqual([2, -7, 1]);
    // The library ran once, with korbat's settings: the checked challenge string, every allowed origin, the RP ID,
    // user verification not required and the algorithms pinned.
    expect(libraryRegistration).toHaveBeenCalledTimes(1);
    expect(libraryRegistration.mock.calls[0]![0]).toMatchObject({
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      supportedAlgorithmIDs: [-8, -7, -257],
    });
  });

  test("a registration without user verification still verifies, and says so", async () => {
    const { passkey } = await registered(new SoftAuthenticator(), { flags: BARE });
    expect(passkey).toMatchObject({ userVerified: false, backupEligible: false, backedUp: false, counter: 0, aaguid: "00000000-0000-0000-0000-000000000000" });
  });

  test("a registration without user presence is refused", async () => {
    const { challenge, response } = registrationResponse(new SoftAuthenticator(), { flags: { up: false, uv: true, be: false, bs: false } });
    await expectInvalid(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
  });

  test("packed without x5c passes the format check and verifies as a self attestation", async () => {
    const { passkey } = await registered(new SoftAuthenticator(), { fmt: "packed" });
    expect(passkey.userVerified).toBe(true);
    expect(libraryRegistration).toHaveBeenCalledTimes(1);
  });

  test("packed with an x5c chain, tpm, android-key, apple, fido-u2f and any other format are refused before the library runs", async () => {
    const certificate = randomBytes(300);
    const signature = randomBytes(70);
    const statements: [string, Map<string | number, CborValue>][] = [
      ["packed", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", [certificate]]])],
      // An empty chain is still a chain: the library tests x5c for truthiness, and an empty array passes that test.
      ["packed", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", []]])],
      ["tpm", new Map<string | number, CborValue>([["ver", "2.0"], ["alg", -257], ["x5c", [certificate]], ["sig", signature], ["certInfo", randomBytes(100)], ["pubArea", randomBytes(100)]])],
      ["android-key", new Map<string | number, CborValue>([["alg", -7], ["sig", signature], ["x5c", [certificate]]])],
      ["apple", new Map<string | number, CborValue>([["x5c", [certificate]]])],
      ["fido-u2f", new Map<string | number, CborValue>([["sig", signature], ["x5c", [certificate]]])],
      ["android-safetynet", new Map<string | number, CborValue>([["ver", "1"], ["response", randomBytes(100)]])],
      ["a-format-nobody-registered", new Map<string | number, CborValue>()],
    ];
    const auth = new SoftAuthenticator();
    for (const [fmt, attStmt] of statements) {
      const { challenge, response } = registrationResponse(auth, { fmt, attStmt });
      const err = await failure(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
      expect([fmt, err.code, err.status]).toEqual([fmt, "passkey_unsupported", 400]);
    }
    expect(libraryRegistration).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an attestation object that is not a CBOR map of the expected members is passkey_invalid, and the library never sees it", async () => {
    const auth = new SoftAuthenticator();
    const encode = (value: CborValue) => Buffer.from(isoCBOR.encode(value)).toString("base64url");
    const broken = [
      encode(5),
      encode("none"),
      encode(new Map<string | number, CborValue>([["fmt", "none"], ["authData", randomBytes(37)]])),
      encode(new Map<string | number, CborValue>([["fmt", 1], ["attStmt", new Map()], ["authData", randomBytes(37)]])),
      encode(new Map<string | number, CborValue>([["fmt", "none"], ["attStmt", [1, 2]], ["authData", randomBytes(37)]])),
      Buffer.from([0xff, 0x00, 0x13]).toString("base64url"),
    ];
    for (const attestationObject of broken) {
      const { challenge, response } = registrationResponse(auth);
      await expectInvalid(verifyRegistration({ response: { ...response, response: { ...response.response, attestationObject } }, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
    }
    expect(libraryRegistration).not.toHaveBeenCalled();
  });

  test("a credential id of 1024 bytes is refused; 1023 bytes are kept", async () => {
    expect(MAX_CREDENTIAL_ID_BYTES).toBe(1023);
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { credentialId: randomBytes(1024) });
    await expectInvalid(verifyRegistration({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID }));
    const longest = randomBytes(1023);
    const { passkey } = await registered(auth, { credentialId: longest });
    expect(Buffer.from(passkey.credentialId, "base64url").equals(longest)).toBe(true);
  });

  test("transports keep only the known values, without repeats, five at most", async () => {
    const auth = new SoftAuthenticator();
    const mixed = await registered(auth, { transports: ["internal", "carrier-pigeon", "hybrid", "internal", "", "usb", "INTERNAL"] });
    expect(mixed.passkey.transports).toEqual(["internal", "hybrid", "usb"]);
    const excess = await registered(auth, { transports: ["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"] });
    expect(excess.passkey.transports).toEqual(["usb", "nfc", "ble", "smart-card", "hybrid"]);
    const late = await registered(auth, { transports: ["cable", "internal"] });
    expect(late.passkey.transports).toEqual(["cable", "internal"]);
    const { challenge, response } = registrationResponse(auth);
    const { transports: _dropped, ...withoutTransports } = response.response;
    const none = await verifyRegistration({ response: { ...response, response: withoutTransports }, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID });
    expect(none.transports).toEqual([]);
  });

  test("a wrong origin, a wrong RP ID and a wrong challenge are passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const wrongOrigin = registrationResponse(auth, { origin: "https://korbat.example.net" });
    await expectInvalid(verifyRegistration({ response: wrongOrigin.response, expectedChallenge: wrongOrigin.challenge, origins: ORIGINS, rpId: RP_ID }));
    const wrongRp = registrationResponse(auth, { rpId: "example.net" });
    await expectInvalid(verifyRegistration({ response: wrongRp.response, expectedChallenge: wrongRp.challenge, origins: ORIGINS, rpId: RP_ID }));
    const { response } = registrationResponse(auth);
    await expectInvalid(verifyRegistration({ response, expectedChallenge: issueChallenge(KEY, "register", NOW, HANDLE), origins: ORIGINS, rpId: RP_ID }));
    // A sign-in response is not a registration, whatever it carries.
    const passkey = await registered(auth);
    const signin = assertion(auth, passkey.response.id, ALL, 1);
    const asRegistration = { ...passkey.response, response: { ...passkey.response.response, clientDataJSON: signin.response.response.clientDataJSON } };
    await expectInvalid(verifyRegistration({ response: asRegistration, expectedChallenge: signin.challenge, origins: ORIGINS, rpId: RP_ID }));
  });

  test("every allowed origin is accepted", async () => {
    const auth = new SoftAuthenticator();
    const { challenge, response } = registrationResponse(auth, { origin: "http://localhost:19006" });
    const passkey = await verifyRegistration({ response, expectedChallenge: challenge, origins: [ORIGIN, "http://localhost:19006"], rpId: RP_ID });
    expect(passkey.credentialId).toBe(response.id);
  });
});

describe("passkey assertions", () => {
  test("an assertion verifies against the stored key with a counter of 0 given to the library, and reports the new counter and flags", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: true, uv: true, be: true, bs: false }, 7);
    const result = await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports } });
    // BE as this assertion reported it: the staff flows refuse a key that reports it at any use (3a design, section 2).
    expect(result).toEqual({ newCounter: 7, userVerified: true, backedUp: false, backupEligible: true });
    expect(libraryAuthentication).toHaveBeenCalledTimes(1);
    const call = libraryAuthentication.mock.calls[0]![0];
    expect(call).toMatchObject({ expectedChallenge: challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: false });
    expect(call.credential.id).toBe(passkey.credentialId);
    expect(call.credential.counter).toBe(0);
    expect(Buffer.from(call.credential.publicKey).toString("base64url")).toBe(passkey.publicKey);
  });

  test("the library never decides on counters: a counter of 0, as Apple passkeys send, and any other counter verify", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { counter: 12 });
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    for (const counter of [0, 3, 12, 13]) {
      const { challenge, response } = assertion(auth, passkey.credentialId, ALL, counter);
      expect((await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential })).newCounter).toBe(counter);
    }
  });

  test("an assertion without user verification still verifies, and says so", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: BARE });
    const { challenge, response } = assertion(auth, passkey.credentialId, BARE, 1);
    const result = await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } });
    expect(result).toEqual({ newCounter: 1, userVerified: false, backedUp: false, backupEligible: false });
  });

  test("the BE and BS flags are reported as each assertion carries them, whatever the registration said", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: { up: true, uv: true, be: false, bs: false } });
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    for (const [flags, expected] of [
      [{ up: true, uv: true, be: false, bs: false }, { backupEligible: false, backedUp: false }],
      [{ up: true, uv: true, be: true, bs: false }, { backupEligible: true, backedUp: false }],
      [{ up: true, uv: true, be: true, bs: true }, { backupEligible: true, backedUp: true }],
    ] as const) {
      const { challenge, response } = assertion(auth, passkey.credentialId, flags, 1);
      expect(await verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential })).toMatchObject(expected);
    }
    // BS without BE is impossible, and the library refuses it.
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: true, uv: true, be: false, bs: true }, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential }));
  });

  test("an assertion without user presence is refused", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, { up: false, uv: true, be: true, bs: true }, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } }));
  });

  test("a signature by another passkey's key is refused", async () => {
    const auth = new SoftAuthenticator();
    const mine = await registered(auth);
    const theirs = await registered(auth);
    const { challenge, response } = assertion(auth, theirs.passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: mine.passkey.credentialId, publicKey: mine.passkey.publicKey, transports: [] } }));
  });

  test("authenticator data changed after signing is refused", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, ALL, 1);
    const authData = Buffer.from(response.response.authenticatorData, "base64url");
    // The last byte of the counter: 1 becomes 2.
    authData[36] = 2;
    const tampered = { ...response, response: { ...response.response, authenticatorData: authData.toString("base64url") } };
    await expectInvalid(verifyAuthentication({ response: tampered, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: [] } }));
  });

  test("a wrong origin, a wrong RP ID and a wrong challenge are passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const credential = { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports };
    const wrongOrigin = assertion(auth, passkey.credentialId, ALL, 1, { origin: "https://korbat.example.net" });
    await expectInvalid(verifyAuthentication({ response: wrongOrigin.response, expectedChallenge: wrongOrigin.challenge, origins: ORIGINS, rpId: RP_ID, credential }));
    const wrongRp = assertion(auth, passkey.credentialId, ALL, 1, { rpId: "example.net" });
    await expectInvalid(verifyAuthentication({ response: wrongRp.response, expectedChallenge: wrongRp.challenge, origins: ORIGINS, rpId: RP_ID, credential }));
    const { response } = assertion(auth, passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: issueChallenge(KEY, "reauth", NOW, HANDLE), origins: ORIGINS, rpId: RP_ID, credential }));
  });

  test("a stored key that is not a COSE key is passkey_invalid", async () => {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth);
    const { challenge, response } = assertion(auth, passkey.credentialId, ALL, 1);
    await expectInvalid(verifyAuthentication({ response, expectedChallenge: challenge, origins: ORIGINS, rpId: RP_ID, credential: { id: passkey.credentialId, publicKey: "AAAA", transports: [] } }));
  });
});

describe("an assertion the audit log recorded, as audit-verify checks it", () => {
  const DEVICE_BOUND: SoftFlags = { up: true, uv: true, be: false, bs: false };
  /** A registered key, and the three members an audit row stores of one of its assertions. */
  async function recorded(flags: SoftFlags = DEVICE_BOUND, at: { rpId?: string; origin?: string } = {}) {
    const auth = new SoftAuthenticator();
    const { passkey } = await registered(auth, { flags: DEVICE_BOUND });
    const { response } = assertion(auth, passkey.credentialId, flags, 3, at);
    const { authenticatorData, clientDataJSON, signature } = response.response;
    return { auth, credential: { id: passkey.credentialId, publicKey: passkey.publicKey }, stored: { authenticatorData, clientDataJSON, signature } };
  }

  test("verifies the stored members against the key's public key, the origin and relying party recorded on it, with presence and verification", async () => {
    const { credential, stored } = await recorded();
    expect(await verifyRecordedAssertion({ assertion: stored, credential, origin: ORIGIN, rpId: RP_ID })).toBe(true);
    // The library is told to require user verification, and given no challenge to compare: audit-verify, which holds no
    // sealing key, reads the challenge's binding and expiry itself.
    const call = libraryAuthentication.mock.calls.at(-1)![0];
    expect(call).toMatchObject({ expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true });
    expect(typeof call.expectedChallenge).toBe("function");
    expect(call.credential.counter).toBe(0);
  });

  test("answers false, never throws, for another origin or relying party, no verification or presence, another key, changed data and a malformed key or member", async () => {
    const { auth, credential, stored } = await recorded();
    const check = (assertion: typeof stored, against = credential, origin = ORIGIN, rpId = RP_ID) => verifyRecordedAssertion({ assertion, credential: against, origin, rpId });
    expect(await check(stored, credential, "http://console.localhost:8090")).toBe(false);
    expect(await check(stored, credential, ORIGIN, "console.localhost")).toBe(false);
    const unverified = await recorded({ up: true, uv: false, be: false, bs: false });
    expect(await check(unverified.stored, unverified.credential)).toBe(false);
    const absent = await recorded({ up: false, uv: true, be: false, bs: false });
    expect(await check(absent.stored, absent.credential)).toBe(false);
    // Signed for another relying party, or from another origin, by the right key.
    const elsewhere = assertion(auth, credential.id, DEVICE_BOUND, 4, { rpId: "example.net" }).response.response;
    expect(await check({ authenticatorData: elsewhere.authenticatorData, clientDataJSON: elsewhere.clientDataJSON, signature: elsewhere.signature })).toBe(false);
    // Another key's public key.
    expect(await check(stored, (await recorded()).credential)).toBe(false);
    // The counter changed after signing.
    const authData = Buffer.from(stored.authenticatorData, "base64url");
    authData[36] = authData[36]! ^ 0x01;
    expect(await check({ ...stored, authenticatorData: authData.toString("base64url") })).toBe(false);
    expect(await check({ ...stored, signature: "AAAA" })).toBe(false);
    expect(await check({ ...stored, clientDataJSON: "not-json" })).toBe(false);
    expect(await check(stored, { ...credential, publicKey: "AAAA" })).toBe(false);
  });
});

describe("the counter rule", () => {
  test("a counter that does not move past the stored one is a regression, unless both are 0", () => {
    expect(isCounterRegression(0, 0)).toBe(false);
    expect(isCounterRegression(5, 5)).toBe(true);
    expect(isCounterRegression(5, 6)).toBe(false);
    expect(isCounterRegression(5, 4)).toBe(true);
    expect(isCounterRegression(5, 0)).toBe(true);
    expect(isCounterRegression(0, 1)).toBe(false);
  });
});

describe("the response's challenge", () => {
  test("is read from the client data, then checked and spent before the library runs", async () => {
    const auth = new SoftAuthenticator();
    const kv = new MemoryKv(() => NOW.getTime());
    const challenge = issueChallenge(KEY, "register", NOW, HANDLE);
    const options = await registrationOptions({ rp: { id: RP_ID, name: RP_NAME }, user: { id: USER_HANDLE, name: "ada", displayName: "ada" }, exclude: [], challenge });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    const read = readResponseChallenge(response);
    expect(read).toBe(challenge);
    readChallenge(KEY, read, "register", NOW, HANDLE);
    await spendChallenge(kv, read, NOW);
    const passkey = await verifyRegistration({ response, expectedChallenge: read, origins: ORIGINS, rpId: RP_ID });
    // The same response again: its challenge is spent.
    expect((await failure(spendChallenge(kv, readResponseChallenge(response), NOW))).code).toBe("passkey_invalid");

    const signin = issueChallenge(KEY, "signin", NOW);
    const signinOptions = await authenticationOptions({ rpId: RP_ID, allow: [], challenge: signin });
    const assertionResponse = auth.get({ credentialId: passkey.credentialId, rpId: RP_ID, challenge: signinOptions.challenge, origin: ORIGIN, flags: ALL, counter: 1 });
    expect(readResponseChallenge(assertionResponse)).toBe(signin);
  });

  test("client data that is not JSON, names no string challenge, or is oversized is passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "signin", NOW);
    const encoded = (text: string) => Buffer.from(text).toString("base64url");
    const json = (value: unknown) => encoded(JSON.stringify(value));
    const cases = [
      encoded("not json"),
      json(null),
      json("a string"),
      json([challenge]),
      json({ type: "webauthn.get", origin: ORIGIN }),
      json({ type: "webauthn.get", challenge: 42, origin: ORIGIN }),
      json({ type: "webauthn.get", challenge: "A".repeat(129), origin: ORIGIN }),
      json({ type: "webauthn.get", challenge, origin: ORIGIN, padding: "x".repeat(3000) }),
      "",
    ];
    for (const clientDataJSON of cases) {
      const err = refusal(() => readResponseChallenge({ response: { clientDataJSON } }));
      expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
    }
    expect(readResponseChallenge({ response: { clientDataJSON: json({ type: "webauthn.get", challenge, origin: ORIGIN }) } })).toBe(challenge);
  });
});

describe("the library boundary", () => {
  test("webauthn.ts is the only source file that imports @simplewebauthn/server", () => {
    const root = fileURLToPath(new URL("../../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".ts") ? [full] : [];
      });
    const importers = walk(root)
      .filter((file) => /["']@simplewebauthn\/server(\/[^"']*)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split(sep).join("/"));
    expect(importers).toEqual(["auth/passkeys/webauthn.ts"]);
  });
});
```

### Replace `apps/api/test/integration/audit-verify.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stepUpActionHash } from "@korbat/contracts";
import { auditHead, auditLog, closeDb, createDb, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { auditVerify, checkAuditRecord, runStaffCommand, type AuditReport } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { CHAIN_VECTORS } from "../staff/chain-vectors";
import { flowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_ORIGIN, issueEnrolment, newStaffAccount, newStaffKey, rolledBack, withLockTimeout } from "./staff-fixtures";
import { revokeConfirmed, signedIn } from "./staff-step-up";

/**
 * audit-verify (3a design, sections 7 and 12) against the real database: the canonical text in Node against the trigger's
 * in SQL, the chain under concurrent writers, rewrites by the owner detected against kept places, and every staff key's
 * one staff_key_added row. Every test that writes a row audit-verify must refuse does it in a transaction that ends in a
 * rollback and hands that transaction to the verifier's check, so no later suite sees a broken chain.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: audit-verify", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  const actorId = "00000000-0000-0000-0000-000000000000";

  /** One ordinary row, as a writer on the API role inserts it: no id, time or chain column supplied. */
  const insertRow = (db: Db | DbTx, action = `probe-${randomUUID()}`) =>
    db.insert(auditLog).values({ actorId, action, targetType: "user", targetId: randomUUID(), metadata: { via: "test" } }).returning();

  const readHead = async (db: Db | DbTx = apiDb) => (await db.select().from(auditHead))[0]!;
  const hashAt = async (seq: number) => (await apiDb.select({ hash: auditLog.hash }).from(auditLog).where(eq(auditLog.chainSeq, seq)))[0]!.hash;

  /**
   * What the owner can do: chain every row from place `from` again with the database's own text function, as migration
   * 0012's back-fill does, and move the head, so a plain recompute of the chain passes over the changed rows.
   */
  const rechainFrom = (tx: DbTx, from: number) =>
    tx.execute(
      sql.raw(`DO $$
        DECLARE r public.audit_log; prev text;
        BEGIN
          SELECT hash INTO prev FROM public.audit_log WHERE chain_seq = ${from - 1};
          FOR r IN SELECT * FROM public.audit_log WHERE chain_seq >= ${from} ORDER BY chain_seq LOOP
            prev := encode(sha256(convert_to(prev || public.audit_chain_text(r), 'UTF8')), 'hex');
            UPDATE public.audit_log SET prev_hash = (SELECT hash FROM public.audit_log WHERE chain_seq = r.chain_seq - 1), hash = prev WHERE id = r.id;
          END LOOP;
          UPDATE public.audit_head SET hash = prev WHERE id = 1;
        END $$`),
    );

  /** The verifier's own connections, as the command line opens them: one on each role. */
  const ownConnections = () => ({ api: createDb(loadConfig().DATABASE_URL_API, { max: 1 }), auth: createDb(loadConfig().DATABASE_URL_AUTH, { max: 1 }) });

  /**
   * What the command line printed, and its exit code, for a run with the given environment changes; with `inherit` false,
   * the run sees `env` alone and nothing of the test environment.
   */
  async function cli(args: string[], env: Record<string, string> = {}, inherit = true) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, inherit ? { ...process.env, ...env } : env, { log: (line) => lines.push(line), error: (line) => lines.push(line) });
    return { code, text: lines.join("\n") };
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    // A few committed rows, so the log is never empty whatever order the suites run in.
    for (let i = 0; i < 3; i++) await withLockTimeout(apiDb, (tx) => insertRow(tx));
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  test("a whole chain passes, with the head, and every kept place it is given", async () => {
    const head = await readHead();
    const connections = ownConnections();
    try {
      const plain = await auditVerify(connections, []);
      expect(plain).toMatchObject({ ok: true, rows: head.seq, head: { seq: head.seq, hash: head.hash }, keptChecked: 0, unanchored: head.seq, problems: [], problemCount: 0 });
      const kept = await auditVerify(connections, [
        { seq: 1, hash: await hashAt(1) },
        { seq: head.seq - 1, hash: await hashAt(head.seq - 1) },
      ]);
      expect(kept).toMatchObject({ ok: true, keptChecked: 2, unanchored: 1, problems: [] });
    } finally {
      await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
    }
  });

  describe("parity: the canonical text in Node and in SQL", () => {
    test("the vectors' rows, written through the trigger from a session in another time zone and date style, recompute to their stored hashes", async () => {
      // One connection, so the session's settings hold for the transaction below.
      const odd = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
      try {
        await odd.execute(sql`set timezone = 'Asia/Kathmandu'`);
        await odd.execute(sql`set datestyle = 'SQL, DMY'`);
        // Rolled back: the step-up row carries an assertion no stored key made, which audit-verify's step-up checks refuse.
        await rolledBack(odd, async (tx) => {
          const [settings] = await tx.execute<{ tz: string; ds: string }>(sql`select current_setting('TimeZone') as tz, current_setting('DateStyle') as ds`);
          expect(settings).toEqual({ tz: "Asia/Kathmandu", ds: "SQL, DMY" });
          const before = await readHead(tx);
          const written: number[] = [];
          for (const vector of CHAIN_VECTORS) {
            const [row] = await tx.insert(auditLog).values(vector.insert).returning({ id: auditLog.id });
            written.push(row!.id);
          }
          // The stored jsonb prints as the vectors say, so the unit vectors hold chain.ts to what the database embeds.
          const texts = await tx
            .select({ id: auditLog.id, metadata: sql<string>`${auditLog.metadata}::text`, stepUp: sql<string | null>`${auditLog.stepUp}::text` })
            .from(auditLog)
            .where(inArray(auditLog.id, written))
            .orderBy(auditLog.chainSeq);
          expect(texts.map((t) => [t.metadata, t.stepUp])).toEqual(CHAIN_VECTORS.map((v) => [v.metadataText, v.stepUpText]));

          // The API role cannot read the staff keys: they come from the auth role's pool, as the command line reads them.
          // Every hash recomputes; the one problem is the step-up vector's, whose assertion no stored key made, and which
          // is the last vector.
          const report = await checkAuditRecord(tx, [], authDb);
          expect(CHAIN_VECTORS.at(-1)!.insert.stepUp).not.toBeNull();
          expect(CHAIN_VECTORS.filter((vector) => vector.insert.stepUp !== null)).toHaveLength(1);
          expect(report.problems).toEqual([{ place: before.seq + CHAIN_VECTORS.length, message: expect.stringMatching(/^its step-up/) }]);
          expect(report.rows).toBe(before.seq + CHAIN_VECTORS.length);
        });
      } finally {
        await closeDb(odd);
      }
    });
  });

  describe("concurrency", () => {
    test("several sessions insert at once, some inside transactions, while keys are enrolled: every run passes, during and after", async () => {
      const WRITERS = 6;
      const EACH = 10;
      const config = loadConfig();
      // One connection per writer, each with a lock timeout for the whole session.
      const writers = Array.from({ length: WRITERS }, () => createDb(config.DATABASE_URL_API, { max: 1 }));
      const connections = ownConnections();
      const reports: AuditReport[] = [];
      let writing = true;
      try {
        await Promise.all(writers.map((db) => db.execute(sql`set lock_timeout = '10s'`)));
        const verifying = (async () => {
          while (writing) reports.push(await auditVerify(connections, []));
        })();
        await Promise.all([
          ...writers.map(async (db, w) => {
            for (let i = 0; i < EACH; i++) {
              const action = `concurrent-verify-${w}-${i}`;
              if (i % 2 === 0) {
                await insertRow(db, action);
              } else {
                // A transaction that waits a moment before its insert, which is its last statement, as every audit write's.
                await db.transaction(async (tx) => {
                  await tx.execute(sql`select pg_sleep(${Math.random() * 0.01})`);
                  await insertRow(tx, action);
                });
              }
            }
          }),
          // Keys enrolled meanwhile: a key whose staff_key_added row lies beyond the head a run read is left to the next run.
          (async () => {
            for (let i = 0; i < 3; i++) await newStaffKey(authDb, migrateDb, repo);
          })(),
        ]);
        writing = false;
        await verifying;
        const final = await auditVerify(connections, []);
        const head = await readHead();

        expect(reports.length).toBeGreaterThan(0);
        for (const report of reports) expect(report.problems).toEqual([]);
        expect(final).toMatchObject({ ok: true, rows: head.seq, head: { seq: head.seq, hash: head.hash }, keysLeftToNextRun: 0, problems: [] });
        expect(final.keysChecked).toBe(await migrateDb.$count(staffKeys));
      } finally {
        writing = false;
        await Promise.all([...writers.map((db) => closeDb(db)), closeDb(connections.api), closeDb(connections.auth)]);
      }
    });
  });

  describe("rewrites by the owner", () => {
    test("a row changed alone fails a plain run, naming its place", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [row] = await insertRow(tx, "rewrite-alone");
        await insertRow(tx, "rewrite-alone-after");
        await tx.update(auditLog).set({ metadata: { via: "edited" } }).where(eq(auditLog.id, row!.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toEqual([{ place: row!.chainSeq, message: "its hash does not match its content" }]);
      });
      // Nothing of it outlives the rollback.
      const connections = ownConnections();
      try {
        expect((await auditVerify(connections, [])).ok).toBe(true);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("a row changed with every later hash and the head recomputed passes a plain run, and fails against a place kept before the change", async () => {
      const head = await readHead();
      const target = head.seq - 1;
      const keptBefore = { seq: target - 1, hash: await hashAt(target - 1) };
      const keptAfter = { seq: head.seq, hash: head.hash };
      await rolledBack(migrateDb, async (tx) => {
        await tx.update(auditLog).set({ action: "rewritten" }).where(eq(auditLog.chainSeq, target));
        await rechainFrom(tx, target);
        expect((await readHead(tx)).hash).not.toBe(head.hash);

        const plain = await checkAuditRecord(tx, []);
        expect(plain.problems).toEqual([]);
        // A place kept before the changed row still holds; the one kept at or after it no longer does.
        expect((await checkAuditRecord(tx, [keptBefore])).problems).toEqual([]);
        const anchored = await checkAuditRecord(tx, [keptBefore, keptAfter]);
        expect(anchored.ok).toBe(false);
        expect(anchored.problems).toEqual([{ place: head.seq, message: expect.stringMatching(new RegExp(`^the kept place ${head.seq}:${head.hash} no longer matches`)) }]);
      });
    });
  });

  describe("step-up confirmations", () => {
    const harness = () => flowHarness(repo, { console: TEST_CONSOLE });

    /**
     * A staff account with a key enrolled through the flow and three sessions; from the first it revokes the other two,
     * each confirmed with the key through the step-up flow: two genuine step-up rows, committed, as only the flow writes them.
     */
    async function confirmedRevocations() {
      const h = harness();
      const { user } = await newStaffAccount(authDb, repo);
      const soft = new SoftAuthenticator();
      const enrolled = await enrolKey(h, soft, (await issueEnrolment(migrateDb, user.id)).token);
      const [a, b, c] = [await signedIn(h, soft, enrolled.credentialId, 1), await signedIn(h, soft, enrolled.credentialId, 2), await signedIn(h, soft, enrolled.credentialId, 3)];
      expect((await revokeConfirmed(h, soft, enrolled.credentialId, a.session, b.session.handle, 4)).revoked).toBe(true);
      expect((await revokeConfirmed(h, soft, enrolled.credentialId, a.session, c.session.handle, 5)).revoked).toBe(true);
      const rowOf = async (handle: string) => (await apiDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_session_revoked"), eq(auditLog.targetId, handle))))[0]!;
      return { user, keyId: enrolled.key.id, a: a.session, b: b.session, c: c.session, first: await rowOf(b.session.handle), second: await rowOf(c.session.handle) };
    }

    /** The problems a check found, as place and message, each expected to name the step-up check. */
    const stepUpProblems = (report: AuditReport) => report.problems.map((p) => ({ place: p.place, stepUp: /step-up/.test(p.message) }));

    test("genuine confirmations pass: on the command line's own connections, with the console off, and with nothing but the database URLs", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      expect(s.first).toMatchObject({ staffSession: s.a.handle, keyId: s.keyId, actorId: s.user.id });
      expect(s.first.stepUp).not.toBeNull();
      const connections = ownConnections();
      try {
        const report = await auditVerify(connections, []);
        expect(report.problems).toEqual([]);
        expect(report.ok).toBe(true);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
      const off = await cli(["audit-verify"], { CONSOLE_ORIGIN: "", CONSOLE_RP_ID: "" });
      expect(off.code, off.text).toBe(0);
      const bare = await cli(["audit-verify"], { DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! }, false);
      expect(bare.code, bare.text).toBe(0);
    });

    test("a confirmed row changed by the owner with the chain and the head recomputed fails on its step-up alone: its params, its target, its session, its hash with its params, or its time past the challenge's expiry", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const otherParams = { params: { all: true } };
      const changes: [string, Record<string, unknown>, RegExp][] = [
        ["its params", { metadata: otherParams }, /^its step-up's action hash is not the hash of its action, target and params$/],
        ["its target", { targetId: s.c.handle }, /^its step-up's action hash is not the hash of its action, target and params$/],
        ["its session", { staffSession: s.b.handle }, /^its step-up's challenge was not issued for this action in this session$/],
        [
          "its params and its action hash together",
          { metadata: otherParams, actionHash: await stepUpActionHash({ action: "staff_session_revoked", target: { type: "staff_session", id: s.b.handle }, params: otherParams.params }) },
          /^its step-up's challenge was not issued for this action in this session$/,
        ],
        ["its time, past the challenge's expiry", { createdAt: new Date(s.first.createdAt.getTime() + 11 * 60_000) }, /^its step-up's challenge had expired when the row was written$/],
      ];
      for (const [label, change, message] of changes) {
        await rolledBack(migrateDb, async (tx) => {
          await tx.update(auditLog).set(change).where(eq(auditLog.id, s.first.id));
          await rechainFrom(tx, s.first.chainSeq);
          const report = await checkAuditRecord(tx, []);
          expect(report.problems, label).toEqual([{ place: s.first.chainSeq, message: expect.stringMatching(message) }]);
        });
      }
      // Nothing of it outlives the rollbacks.
      const connections = ownConnections();
      try {
        expect((await auditVerify(connections, [])).problems).toEqual([]);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("an assertion moved to another row fails there, on its binding and as a challenge used twice", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      await rolledBack(migrateDb, async (tx) => {
        // The first row's assertion, signed by the same key in the same session, on the second row: only the binding of
        // its target, and the challenge's second use, give it away.
        await tx.update(auditLog).set({ stepUp: s.first.stepUp }).where(eq(auditLog.id, s.second.id));
        await rechainFrom(tx, s.second.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([
          { place: s.second.chainSeq, message: "its step-up's challenge was not issued for this action in this session" },
          { place: s.second.chainSeq, message: `its step-up's challenge was already used at place ${s.first.chainSeq}` },
        ]);
      });
    });

    test("a row of a step-up action without a confirmation fails, whatever its actor: a staff account, a demoted one, the system", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const { user: demoted } = await newStaffAccount(authDb, repo);
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, demoted.id));
      await rolledBack(migrateDb, async (tx) => {
        const places: number[] = [];
        for (const actor of [s.user.id, demoted.id, actorId]) {
          const [row] = await tx
            .insert(auditLog)
            .values({ actorId: actor, action: "staff_session_revoked", targetType: "staff_session", targetId: randomUUID(), staffSession: randomUUID(), metadata: { params: {} } })
            .returning({ chainSeq: auditLog.chainSeq });
          places.push(row!.chainSeq);
        }
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual(places.map((place) => ({ place, message: "its action, staff_session_revoked, needs a step-up, and it carries none" })));
      });
    });

    test("a confirmation whose key belongs to another account than the row's actor fails, as one whose key records another origin or relying party ID", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const { user: other } = await newStaffAccount(authDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        await tx.update(auditLog).set({ actorId: other.id }).where(eq(auditLog.id, s.first.id));
        await rechainFrom(tx, s.first.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: s.first.chainSeq, message: `its step-up's key ${s.keyId} belongs to another account than its actor` }]);
      });
      // The key's recorded origin and relying party ID, which the owner can change too: the confirmation was made for
      // the ones the key was enrolled with, never checked against the console's configuration.
      for (const [label, change, message] of [
        ["origin", { origin: "http://console.example:8090" }, "its step-up's client data is not a webauthn.get from the origin recorded on its key"],
        ["relying party ID", { rpId: "console.example" }, "its step-up's authenticator data does not name the relying party ID recorded on its key"],
      ] as const) {
        await rolledBack(migrateDb, async (tx) => {
          await tx.update(staffKeys).set(change).where(eq(staffKeys.id, s.keyId));
          const report = await checkAuditRecord(tx, []);
          expect(report.problems, label).toEqual([
            { place: s.first.chainSeq, message },
            { place: s.second.chainSeq, message },
          ]);
        });
      }
    });

    test("a signature that does not verify with the key's public key fails", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      await rolledBack(migrateDb, async (tx) => {
        const stepUp = s.first.stepUp as { authenticatorData: string; clientDataJSON: string; signature: string };
        const signature = Buffer.from(stepUp.signature, "base64url");
        signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
        await tx.update(auditLog).set({ stepUp: { ...stepUp, signature: signature.toString("base64url") } }).where(eq(auditLog.id, s.first.id));
        await rechainFrom(tx, s.first.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: s.first.chainSeq, message: `its step-up's signature does not verify with the public key of key ${s.keyId}` }]);
      });
    });
  });

  describe("staff keys", () => {
    test("a key without its staff_key_added row fails, naming the key", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        // Only the owner can plant one: the auth role cannot insert a key, and add_staff_key writes the row with it.
        const [key] = await tx
          .insert(staffKeys)
          .values({ userId: user.id, credentialId: randomUUID(), publicKey: "cose-key", name: "planted", origin: TEST_CONSOLE_ORIGIN, rpId: "console.localhost" })
          .returning({ id: staffKeys.id });
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: null, message: `staff key ${key!.id} has no staff_key_added row` }]);
      });
    });

    test("a key with a second staff_key_added row fails, naming both places", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const [first] = await apiDb.select({ seq: auditLog.chainSeq }).from(auditLog).where(eq(auditLog.keyId, key.id));
      // The API role can insert any action; a second row claiming the key's addition is refused by audit-verify.
      await rolledBack(apiDb, async (tx) => {
        const [second] = await tx.insert(auditLog).values({ actorId, action: "staff_key_added", targetType: "staff_key", targetId: key.id, keyId: key.id }).returning();
        const report = await checkAuditRecord(tx, [], authDb);
        expect(report.problems).toEqual([{ place: null, message: `staff key ${key.id} has 2 staff_key_added rows (places ${first!.seq}, ${second!.chainSeq})` }]);
      });
    });
  });

  describe("the command line", () => {
    test("audit-verify passes the same with the console off and on, and needs nothing of the console's configuration", async () => {
      const head = await readHead();
      const envs: Record<string, string>[] = [{ CONSOLE_ORIGIN: "" }, { CONSOLE_ORIGIN: "", CONSOLE_RP_ID: "" }, { CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN }];
      for (const env of envs) {
        const run = await cli(["audit-verify", `${head.seq}:${head.hash}`], env);
        expect(run.code, JSON.stringify(env)).toBe(0);
        expect(run.text).toContain(`the chain holds: ${head.seq} rows, from place 1 to the head ${head.seq}:${head.hash}`);
        expect(run.text).toContain("1 kept place checked; 0 rows after the newest kept place are not yet anchored");
      }
    });

    test("audit-verify and audit-head run given the database URLs alone: no secret, no other setting, and a console setting the API refuses changes nothing", async () => {
      const head = await readHead();
      const urls = { DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! };
      const envs: Record<string, string>[] = [
        urls,
        // A final slash, which the API's configuration refuses in CONSOLE_ORIGIN.
        { ...urls, CONSOLE_ORIGIN: "https://console.example/" },
        // The console on the app's origin, which it refuses too.
        { ...urls, APP_ORIGIN: process.env.APP_ORIGIN!, CONSOLE_ORIGIN: process.env.APP_ORIGIN! },
      ];
      for (const env of envs) {
        const run = await cli(["audit-verify", `${head.seq}:${head.hash}`], env, false);
        expect(run.code, JSON.stringify(Object.keys(env))).toBe(0);
        expect(run.text).toContain(`the chain holds: ${head.seq} rows, from place 1 to the head ${head.seq}:${head.hash}`);
      }
      const headRun = await cli(["audit-head"], { DATABASE_URL_API: urls.DATABASE_URL_API }, false);
      expect(headRun.code).toBe(0);
      expect(headRun.text).toMatch(new RegExp(`^${head.seq}:${head.hash} `));
    });

    test("audit-verify exits 1 and names the place at fault when a kept place does not match", async () => {
      const head = await readHead();
      const run = await cli(["audit-verify", `1:${await hashAt(1)}`, `${head.seq}:${"f".repeat(64)}`]);
      expect(run.code).toBe(1);
      expect(run.text).toContain("audit-verify: FAILED");
      expect(run.text).toContain(`place ${head.seq}: the kept place ${head.seq}:${"f".repeat(64)} no longer matches`);
    });

    test("audit-head prints the newest place, its hash and its time, and they are what audit_head holds", async () => {
      const head = await readHead();
      const [newest] = await apiDb.select().from(auditLog).where(eq(auditLog.chainSeq, head.seq));
      const run = await cli(["audit-head"], { CONSOLE_ORIGIN: "" });
      expect(run.code).toBe(0);
      expect(run.text).toBe(`${head.seq}:${head.hash} ${newest!.createdAt.toISOString()}`);
    });
  });
});
```

### Replace `apps/api/test/integration/http-staff-sessions.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AuditPage,
  ErrorEnvelope,
  STAFF_STEP_UP_CHALLENGE,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffStepUpOptionsResponse,
  stepUpActionHash,
  stepUpBinding,
  type AuthenticationResponseJSON,
} from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, revokeStaffKeys, type Auth } from "../../src/auth";
import { decodeKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runGrantRole } from "../../src/cli/grant-role";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { fakeClock } from "./auth-fixtures";
import { Browser, randomIp } from "./http-client";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { revokeRequest } from "./staff-step-up";

const CONSOLE_HOST = new URL(TEST_CONSOLE_ORIGIN).host;
const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/** The Set-Cookie lines of an answer, by cookie name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));
}

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

/** A response's signature with its last byte changed. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * Staff sessions over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090 signs
 * in with a staff key, and every staff request after it passes the staff gate and requireStaff, which reads the session
 * from the database each time. The auth module runs on a clock the tests move, so the idle and absolute ends are reached
 * without waiting.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sessions over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  const mailer = new MemoryMailer();
  const clock = fakeClock();

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock.ms), mailer, profiles: createProfileStore(apiDb), now: clock.now });
    const staff = createStaff({ apiDb, auth: auth.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  /** A request to the console's host with exactly these headers, for what the browser above never sends. */
  const raw = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    app.request(`${TEST_CONSOLE_ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: CONSOLE_HOST, "cf-connecting-ip": randomIp(), ...init.headers } });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionRow = async (token: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.id, sha256Hex(token))))[0]!;
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;

  /** The 401 that ends a staff session in the console: staff_session_required, with both staff cookies cleared. */
  async function expectEnded(res: Response, label: string) {
    expect(res.status, label).toBe(401);
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
    for (const line of cookies.values()) {
      expect(line, label).toContain("Max-Age=0");
      expect(line, label).toContain("Path=/");
      expect(line, label).toContain("Secure");
    }
    expect((await error(res)).code, label).toBe("staff_session_required");
  }

  /**
   * A live staff account with a handle and one key enrolled through the flow, signed in from the console's browser with
   * Firefox's user agent. `signIn` signs in again, from any browser, with the next counter unless told one.
   */
  async function staffBrowser(role: "moderator" | "admin" = "moderator") {
    const { user, device } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    // The flows run on the moved clock: the link is valid 30 minutes from it, which is never earlier than the database's.
    const link = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) });
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    async function signIn(browser: Browser, options: { counter?: number; headers?: Record<string, string> } = {}) {
      const answer = await browser.fetch("/api/staff/signin/options", { method: "POST" });
      expect(answer.status, await answer.clone().text()).toBe(200);
      const { options: request } = StaffSignInOptionsResponse.parse(await answer.json());
      counter = options.counter ?? counter + 1;
      const response = soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: request.challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const res = await browser.fetch("/api/staff/signin/verify", { json: { response }, headers: options.headers });
      return { res, response };
    }
    const b = consoleBrowser();
    const first = await signIn(b, { headers: { "user-agent": FIREFOX_LINUX } });
    expect(first.res.status, await first.res.clone().text()).toBe(200);
    return { user, device, handle, soft, keyId: enrolled.key.id, credentialId: enrolled.credentialId, b, token: b.cookie(STAFF_COOKIE)!, signIn, first };
  }

  /**
   * The key's answer to step-up options for revoking the staff session `handle`, asked for from `s`'s browser as the
   * console asks for them, or over a challenge of the test's own.
   */
  async function confirmation(s: Awaited<ReturnType<typeof staffBrowser>>, handle: string, options: { counter: number; challenge?: string }) {
    let challenge = options.challenge;
    if (challenge === undefined) {
      const res = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(handle), headers: MARKED });
      expect(res.status, await res.clone().text()).toBe(200);
      challenge = StaffStepUpOptionsResponse.parse(await res.json()).options.challenge;
    }
    return s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: options.counter });
  }
  const revokeSession = (b: Browser, handle: string, stepUp?: AuthenticationResponseJSON) =>
    b.fetch(`/api/staff/sessions/${handle}`, { method: "DELETE", ...(stepUp ? { json: { stepUp } } : {}), headers: MARKED });

  describe("signing in", () => {
    test("sets both staff cookies, __Host-, Secure, Path=/, SameSite=Strict and 12 hours long, the session's HttpOnly; answers /me's body with no CORS header and no-store", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const res = s.first.res;
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      const session = cookies.get(STAFF_COOKIE)!;
      const csrf = cookies.get(STAFF_CSRF_COOKIE)!;
      expect(session).toMatch(/^__Host-korbat_staff=[A-Za-z0-9_-]{43};/);
      expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
      for (const line of [session, csrf]) {
        for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
        expect(line).not.toContain("Domain=");
      }
      expect(session).toContain("HttpOnly");
      expect(csrf).not.toContain("HttpOnly");
      // No app cookie is set on the console.
      expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") || line.startsWith("__Host-korbat_csrf="))).toBe(false);
      expect(accessControlHeaders(res)).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const me = StaffSignInVerifyResponse.parse(await res.json());
      const row = await sessionRow(s.token);
      expect(me).toMatchObject({ handle: s.handle, role: "moderator", sessionHandle: row.handle, idleSecondsLeft: 900, absoluteSecondsLeft: 43_200 });
      // The coarse label of the browser that signed in, never its user agent, as the session list and the mail show it.
      expect(row.browser).toBe("Firefox on Linux");
      expect(mailer.sent.filter((m) => m.to === s.user.email).map((m) => [m.template, m.data.browser])).toEqual([
        ["staff_key_added", undefined],
        ["staff_session_started", "Firefox on Linux"],
      ]);
    });

    test("one answer before the signature: a spent challenge, one of another purpose, one with another binding and a bad signature are staff_key_invalid, never a passkey code, and a bad signature on a live key reads as an unknown key", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const b = consoleBrowser();
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const fresh = async () => StaffSignInOptionsResponse.parse(await (await b.fetch("/api/staff/signin/options", { method: "POST" })).json()).options.challenge;
      const assert = (challenge: string, counter: number) =>
        s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const spentChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });

      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", assert(spentChallenge, 20)],
        ["the app's sign-in challenge", assert(issueChallenge(key, "signin", clock.now()), 21)],
        ["a staff registration challenge", assert(issueChallenge(key, "staff_register", clock.now(), randomUUID()), 22)],
        ["a staff sign-in challenge with a binding", assert(issueChallenge(key, "staff_signin", clock.now(), randomUUID()), 23)],
        ["a bad signature on a live key", badSignature(assert(await fresh(), 24))],
        ["an unknown key", stranger.get({ credentialId: unknown.id, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 })],
      ];
      const answers: Record<string, { status: number; code: string; message: string }> = {};
      for (const [label, response] of cases) {
        const res = await b.fetch("/api/staff/signin/verify", { json: { response } });
        const { code, message } = await error(res);
        answers[label] = { status: res.status, code, message };
        expect([label, res.status, code]).toEqual([label, 401, "staff_key_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(answers["a bad signature on a live key"]).toEqual(answers["an unknown key"]);
      expect((await migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, s.user.id))).length).toBe(1);
    });
  });

  describe("the person's own reads", () => {
    test("/me with the seconds left, /sessions with every live session and this one marked, /keys with the live keys and never a public key; no answer sets a cookie", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      // Another account's session is never listed, nor a key the account no longer holds.
      await staffBrowser();
      const red = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Red key" });
      const old = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Old key" });
      await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, old.key.id));
      clock.advance(MINUTE);

      for (const headers of [{}, MARKED]) {
        const me = await s.b.fetch("/api/staff/me", { headers });
        expect(me.status).toBe(200);
        expect(me.headers.getSetCookie()).toEqual([]);
        const body = StaffMe.parse(await me.json());
        expect(body.sessionHandle).toBe((await sessionRow(s.token)).handle);
        expect(body.absoluteSecondsLeft).toBe(12 * 60 * 60 - 60);
      }

      const sessions = await s.b.fetch("/api/staff/sessions");
      expect(sessions.headers.getSetCookie()).toEqual([]);
      const listed = StaffSessionsResponse.parse(await sessions.json()).sessions;
      const mine = await sessionRow(s.token);
      const theirs = await sessionRow(other.cookie(STAFF_COOKIE)!);
      expect(listed.map((x) => [x.handle, x.current, x.browser]).sort()).toEqual(
        [
          [mine.handle, true, "Firefox on Linux"],
          [theirs.handle, false, "Browser on unknown OS"],
        ].sort(),
      );
      // The other browser sees the same two, with its own marked.
      const fromOther = StaffSessionsResponse.parse(await (await other.fetch("/api/staff/sessions")).json()).sessions;
      expect(fromOther.find((x) => x.current)!.handle).toBe(theirs.handle);

      const keys = await s.b.fetch("/api/staff/keys");
      const text = await keys.clone().text();
      expect(StaffKeysResponse.parse(await keys.json()).keys.map((k) => [k.id, k.name])).toEqual([
        [s.keyId, "Blue key"],
        [red.key.id, "Red key"],
      ]);
      // The key that signed in shows when it was last used; nothing of any key's credential leaves the server.
      const [blue] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, s.keyId));
      expect(text).toContain(blue!.lastUsedAt!.toISOString());
      for (const secret of [blue!.publicKey, blue!.credentialId]) expect(text).not.toContain(secret);
    });
  });

  describe("the idle and absolute limits", () => {
    test("only marked requests count: unmarked reads neither slide the idle end nor move last_used_at, so the session ends 15 minutes after the last marked one", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t0 = (await sessionRow(s.token)).createdAt.getTime();
      clock.advance(10 * MINUTE);
      const unmarked = await s.b.fetch("/api/staff/me");
      expect(StaffMe.parse(await unmarked.json()).idleSecondsLeft).toBe(5 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0), idleExpiresAt: new Date(t0 + 15 * MINUTE) });

      clock.advance(4 * MINUTE);
      const marked = await s.b.fetch("/api/staff/me", { headers: MARKED });
      expect(StaffMe.parse(await marked.json()).idleSecondsLeft).toBe(15 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // Any other value of the header marks nothing.
      clock.advance(MINUTE);
      expect((await s.b.fetch("/api/staff/sessions", { headers: { "x-staff-activity": "true" } })).status).toBe(200);
      clock.advance(13 * MINUTE);
      expect((await s.b.fetch("/api/staff/keys")).status).toBe(200);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // At the idle end, the next request is refused and the cookies cleared; a marked one revives nothing.
      clock.advance(MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me"), "at the idle end");
      expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), "marked, after the idle end");
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE), revokedAt: null });
    });

    test("a marked request slides the idle end, never past the absolute end, which ends the session after 12 hours whatever its person does", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const t0 = row.createdAt.getTime();
      expect(row.absoluteExpiresAt).toEqual(new Date(t0 + 12 * HOUR));
      // A marked request every 14 minutes for 11 hours and 54 minutes.
      for (let i = 0; i < 51; i++) {
        clock.advance(14 * MINUTE);
        expect((await s.b.fetch("/api/staff/me", { headers: MARKED })).status, `request ${i}`).toBe(200);
      }
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 714 * MINUTE), idleExpiresAt: new Date(t0 + 12 * HOUR) });
      const me = StaffMe.parse(await (await s.b.fetch("/api/staff/me", { headers: MARKED })).json());
      expect([me.idleSecondsLeft, me.absoluteSecondsLeft]).toEqual([6 * 60, 6 * 60]);
      expect(me.idleExpiresAt).toBe(me.absoluteExpiresAt);
      clock.advance(6 * MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), "at the absolute end");
    });
  });

  describe("every way a session ends, refused at its next request", () => {
    type Ender = [string, (s: Awaited<ReturnType<typeof staffBrowser>>) => Promise<void>];
    const enders: Ender[] = [
      ["a revocation by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, s.keyId))],
      ["a revocation of every key by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, "all"))],
      [
        "a counter that went backwards in another browser",
        async (s) => {
          const { res } = await s.signIn(consoleBrowser(), { counter: 1 });
          expect((await error(res)).code).toBe("staff_key_suspended");
        },
      ],
      ["a demotion by grant-role", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "user"))],
      ["a change from moderator to admin", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "admin"))],
      ["the account's take-down", async (s) => void (await repo.takeDown(s.user.id, clock.now(), null))],
      // Changes that revoke nothing: the session is read with its key and its account at every request, so no tombstone is needed.
      ["its key revoked in the database alone", async (s) => void (await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId)))],
      ["the account's role set to user in the database alone", async (s) => void (await authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id)))],
      ["the account marked deleted in the database alone", async (s) => void (await authDb.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, s.user.id)))],
      ["the session revoked in the database", async (s) => void (await authDb.update(staffSessions).set({ revokedAt: clock.now() }).where(eq(staffSessions.id, sha256Hex(s.token))))],
      [
        "a revocation confirmed with the key in another browser",
        async (s) => {
          const other = consoleBrowser();
          expect((await s.signIn(other)).res.status).toBe(200);
          const handle = (await sessionRow(s.token)).handle;
          const stepUp = await confirmation({ ...s, b: other }, handle, { counter: 3 });
          expect((await revokeSession(other, handle, stepUp)).status).toBe(204);
        },
      ],
      [
        "a counter that went backwards at a step-up",
        async (s) => {
          const handle = (await sessionRow(s.token)).handle;
          const res = await revokeSession(s.b, handle, await confirmation(s, handle, { counter: 1 }));
          expect([res.status, (await error(res)).code]).toEqual([403, "staff_key_suspended"]);
        },
      ],
    ];
    for (const [label, end] of enders) {
      test(label, { timeout: 30_000 }, async () => {
        const s = await staffBrowser();
        expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
        await end(s);
        await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), label);
        expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE)).toBeUndefined();
      });
    }

    test("signing out: 204, both cookies cleared, the session revoked with staff_signed_out and its audit row, and no mail", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const sent = mailer.sent.length;
      const before = await head();
      clock.advance(MINUTE);
      const res = await s.b.fetch("/api/staff/signout", { method: "POST" });
      expect(res.status).toBe(204);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      for (const line of cookies.values()) expect(line).toContain("Max-Age=0");
      expect((await sessionRow(s.token)).revokedAt).toEqual(clock.now());

      const [event] = await migrateDb
        .select({ metadata: authEvents.metadata })
        .from(authEvents)
        .where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_signed_out")));
      expect(event!.metadata).toEqual({ handle: row.handle });
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.requestId, r.metadata])).toEqual([
        ["staff_signed_out", s.user.id, "staff_session", row.handle, row.handle, s.keyId, res.headers.get("x-request-id"), {}],
      ]);
      expect(mailer.sent.length).toBe(sent);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "after signing out");
      // Signing out again is a session that has ended.
      await expectEnded(await raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=x`, "x-staff-csrf": "x" } }), "signing out twice");
    });
  });

  describe("revoking a session, confirmed with the staff key", () => {
    test("the options name the session's key alone over a challenge the console can check; DELETE with the confirmation answers 204, the session ends at its next request, and the row carries the request's id and the confirmation", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const request = revokeRequest(target.handle);

      const optionsRes = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
      expect(optionsRes.status).toBe(200);
      expect(accessControlHeaders(optionsRes)).toEqual([]);
      expect(optionsRes.headers.getSetCookie()).toEqual([]);
      const { options } = StaffStepUpOptionsResponse.parse(await optionsRes.json());
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
      expect(options.userVerification).toBe("required");
      // What the console checks before it asks for the key: the layout, the purpose, and the binding of its own session's
      // handle and the hash of what it sent.
      const actionHash = await stepUpActionHash(request);
      const challenge = Buffer.from(options.challenge, "base64url");
      const L = STAFF_STEP_UP_CHALLENGE;
      expect(challenge).toHaveLength(L.bytes);
      expect(challenge[L.purposeAt]).toBe(L.purpose);
      expect(challenge.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(mine.handle, actionHash)))).toBe(true);

      const stepUp = await confirmation(s, target.handle, { counter: 3, challenge: options.challenge });
      const before = await head();
      clock.advance(MINUTE);
      const res = await revokeSession(s.b, target.handle, stepUp);
      expect(res.status, await res.clone().text()).toBe(204);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(accessControlHeaders(res)).toEqual([]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toEqual(clock.now());
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
        [
          "staff_session_revoked",
          s.user.id,
          "staff_session",
          target.handle,
          mine.handle,
          s.keyId,
          actionHash,
          { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
          { params: {} },
          res.headers.get("x-request-id"),
        ],
      ]);
      await expectEnded(await other.fetch("/api/staff/me"), "the revoked session");
      expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
      // The person may end the session they ask from as well; it ends at its next request.
      expect((await revokeSession(s.b, mine.handle, await confirmation(s, mine.handle, { counter: 4 }))).status).toBe(204);
      await expectEnded(await s.b.fetch("/api/staff/me"), "the session that revoked itself");
    });

    test("without a confirmation the answer is staff_step_up_required; a body, target or options request the schemas refuse is invalid_request; without the staff CSRF header, csrf_failed; nothing changes", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const before = await head();
      for (const [label, init] of [
        ["no body", { method: "DELETE" }],
        ["an empty body", { method: "DELETE", json: {} }],
      ] as const) {
        const res = await s.b.fetch(`/api/staff/sessions/${target.handle}`, init);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "staff_step_up_required"]);
      }
      // Any assertion's shape will do for the schemas: the sign-in's is one.
      const shaped = s.first.response;
      for (const [label, path, body] of [
        ["a member the action's params do not take", `/api/staff/sessions/${target.handle}`, { all: true, stepUp: shaped }],
        ["a stepUp that is not an assertion", `/api/staff/sessions/${target.handle}`, { stepUp: { id: "x" } }],
        ["a handle that is not a uuid", "/api/staff/sessions/not-a-handle", { stepUp: shaped }],
      ] as const) {
        const res = await s.b.fetch(path, { method: "DELETE", json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      for (const [label, body] of [
        ["an action no step-up confirms", { ...revokeRequest(target.handle), action: "role_granted" }],
        ["another target type", { ...revokeRequest(target.handle), target: { type: "user", id: target.handle } }],
        ["params the action does not take", { ...revokeRequest(target.handle), params: { all: true } }],
        ["a target that is not a uuid", revokeRequest("not-a-handle")],
      ] as const) {
        const res = await s.b.fetch("/api/staff/step-up/options", { json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      // A write without the staff CSRF header is refused before the session is read, the options included.
      const stepUp = await confirmation(s, target.handle, { counter: 3 });
      expect((await s.b.fetch(`/api/staff/sessions/${target.handle}`, { method: "DELETE", json: { stepUp }, csrf: false })).status).toBe(403);
      expect((await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), csrf: false })).status).toBe(403);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The confirmation the refused write carried was never read, so it still confirms what it was given for.
      expect((await revokeSession(s.b, target.handle, stepUp)).status).toBe(204);
    });

    test("a spent challenge, one of another purpose, one with another binding and a bad signature are staff_step_up_invalid, never a passkey code; an expired one is challenge_expired", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const actionHash = await stepUpActionHash(revokeRequest(target.handle));
      const fresh = await confirmation(s, target.handle, { counter: 3 });
      const freshChallenge = JSON.parse(Buffer.from(fresh.response.clientDataJSON, "base64url").toString()).challenge as string;
      const signInChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const cases: [string, () => Promise<AuthenticationResponseJSON>][] = [
        // The library refuses it, after the challenge was spent: the same challenge signed well is then a spent one.
        ["a bad signature", async () => badSignature(fresh)],
        ["a spent step-up challenge", () => confirmation(s, target.handle, { counter: 4, challenge: freshChallenge })],
        ["the sign-in's challenge", () => confirmation(s, target.handle, { counter: 5, challenge: signInChallenge })],
        ["a staff sign-in challenge", () => confirmation(s, target.handle, { counter: 6, challenge: issueChallenge(key, "staff_signin", clock.now()) })],
        ["a re-authentication challenge for this session", () => confirmation(s, target.handle, { counter: 7, challenge: issueChallenge(key, "reauth", clock.now(), mine.handle) })],
        ["a step-up challenge for another session", () => confirmation(s, target.handle, { counter: 8, challenge: issueStepUpChallenge(key, clock.now(), target.handle, actionHash) })],
        [
          "a step-up challenge for another target",
          async () => confirmation(s, target.handle, { counter: 9, challenge: issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(mine.handle))) }),
        ],
      ];
      for (const [label, make] of cases) {
        const res = await revokeSession(s.b, target.handle, await make());
        const { code } = await error(res);
        expect([label, res.status, code]).toEqual([label, 403, "staff_step_up_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
      }
      const late = await confirmation(s, target.handle, { counter: 10 });
      clock.advance(10 * MINUTE);
      const expired = await revokeSession(s.b, target.handle, late);
      expect([expired.status, (await error(expired)).code]).toEqual([400, "challenge_expired"]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
    });

    test("another account's session is no session of the person's: 404, it lives on, and the confirmation is spent", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t = await staffBrowser();
      const theirs = await sessionRow(t.token);
      const before = await head();
      const stepUp = await confirmation(s, theirs.handle, { counter: 3 });
      const res = await revokeSession(s.b, theirs.handle, stepUp);
      expect([res.status, (await error(res)).code]).toEqual([404, "not_found"]);
      expect((await sessionRow(t.token)).revokedAt).toBeNull();
      expect((await t.b.fetch("/api/staff/me")).status).toBe(200);
      expect(await head()).toEqual(before);
      const again = await revokeSession(s.b, theirs.handle, stepUp);
      expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
    });

    test("a handle in upper case is invalid_request, for the options and for the revocation even with a confirmation bound to that spelling: the id is hashed as sent but recorded as the database writes it, so only that spelling is taken", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const upper = target.handle.toUpperCase();
      expect(upper).not.toBe(target.handle);
      const before = await head();
      const options = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(upper), headers: MARKED });
      expect(options.status, await options.clone().text()).toBe(400);
      expect((await error(options)).code).toBe("invalid_request");
      // The challenge such options would have carried, bound to the upper-case spelling and signed by the session's key.
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const bound = issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(upper)));
      const res = await revokeSession(s.b, upper, await confirmation(s, upper, { counter: 3, challenge: bound }));
      expect(res.status, await res.clone().text()).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The spelling the console reads from /sessions revokes it.
      expect((await revokeSession(s.b, target.handle, await confirmation(s, target.handle, { counter: 4 }))).status).toBe(204);
    });

    test("a session that ends inside the step-up is answered as requireStaff answers it, staff_session_required with both cookies cleared: its key revoked just before the options, or its key revoked or its account demoted between the confirmation and the action", { timeout: 60_000 }, async () => {
      type Staff = Awaited<ReturnType<typeof staffBrowser>>;
      const revokeKey = (s: Staff) => authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId));
      const demote = (s: Staff) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id));
      // Each change is made inside the request, after requireStaff read the session live: just before the options read
      // the session's key, or just before the revocation's transaction.
      const cases: [string, "findStaffKeyCredential" | "revokeConfirmedStaffSession", (s: Staff) => Promise<unknown>][] = [
        ["the key revoked before the options", "findStaffKeyCredential", revokeKey],
        ["the key revoked after the confirmation", "revokeConfirmedStaffSession", revokeKey],
        ["the account demoted after the confirmation", "revokeConfirmedStaffSession", demote],
      ];
      for (const [label, method, end] of cases) {
        const s = await staffBrowser();
        const other = consoleBrowser();
        expect((await s.signIn(other)).res.status, label).toBe(200);
        const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
        const stepUp = method === "revokeConfirmedStaffSession" ? await confirmation(s, target.handle, { counter: 3 }) : undefined;
        const flows = auth.deps.repo;
        const original = flows[method].bind(flows) as (...args: unknown[]) => Promise<unknown>;
        const spy = vi.spyOn(flows, method).mockImplementationOnce((async (...args: unknown[]) => {
          await end(s);
          return original(...args);
        }) as never);
        try {
          const res = stepUp
            ? await revokeSession(s.b, target.handle, stepUp)
            : await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), headers: MARKED });
          expect(spy, label).toHaveBeenCalledOnce();
          await expectEnded(res, label);
        } finally {
          spy.mockRestore();
        }
        expect(s.b.cookie(STAFF_COOKIE), label).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE), label).toBeUndefined();
        expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt, label).toBeNull();
      }
    });
  });

  describe("what opens a staff route", () => {
    test("the staff cookie only: the app's session cookie and a bearer token are refused, a staff cookie opens no app route, and a session created after now is refused", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `__Host-korbat_session=${app_.token}` } }), "the app's session cookie");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${app_.token}` } }), "a bearer token");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${s.token}` } }), "the staff token as a bearer token");
      // The staff cookie under the app's name, and on the app's host, opens nothing there.
      const onApp = await app.request("/api/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(onApp.status).toBe(401);
      expect((await error(onApp)).code).toBe("unauthenticated");
      const asApp = await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(asApp.status).toBe(401);

      // A row written behind the flows' back that starts in the future, within the database's 12 hours.
      const token = randomToken();
      const start = new Date(clock.ms() + HOUR);
      await authDb.insert(staffSessions).values({
        id: sha256Hex(token),
        userId: s.user.id,
        keyId: s.keyId,
        createdAt: start,
        lastUsedAt: start,
        idleExpiresAt: new Date(start.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(start.getTime() + 12 * HOUR),
        browser: "Firefox on Linux",
      });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${token}` } }), "a session created after now");
    });

    test("CSRF: a write needs x-staff-csrf equal to the staff CSRF cookie; the app's CSRF cookie and header do not count, and a refused write touches nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const before = await sessionRow(s.token);
      clock.advance(MINUTE);
      const post = (headers: Record<string, string>) => raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, ...MARKED, ...headers } });
      const cases: [string, Record<string, string>][] = [
        ["no header", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}` }],
        ["another value", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`, "x-staff-csrf": `${csrf.slice(1)}A` }],
        ["the header without its cookie", { cookie: `${STAFF_COOKIE}=${s.token}`, "x-staff-csrf": csrf }],
        ["the app's CSRF cookie and header", { cookie: `${STAFF_COOKIE}=${s.token}; __Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf }],
      ];
      for (const [label, headers] of cases) {
        const res = await post(headers);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect((await s.b.fetch("/api/staff/signout", { method: "POST", csrf: false })).status).toBe(403);
      expect(await sessionRow(s.token)).toEqual(before);
      expect((await s.b.fetch("/api/staff/signout", { method: "POST" })).status).toBe(204);
    });
  });

  describe("the staff gate over HTTP", () => {
    test("a console POST sent with the app's session and CSRF cookies present reaches its route and is not csrf_failed", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const res = await raw("/api/staff/signout", {
        method: "POST",
        headers: {
          origin: TEST_CONSOLE_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: `__Host-korbat_session=${app_.token}; __Host-korbat_csrf=app-csrf; ${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`,
          "x-csrf-token": "app-csrf",
          "x-staff-csrf": csrf,
        },
      });
      expect(res.status, await res.clone().text()).toBe(204);
      expect((await sessionRow(s.token)).revokedAt).not.toBeNull();
      // The app's session was neither read nor ended.
      expect(await repo.findActiveSession(app_.session.sessionId, clock.now())).toBeDefined();
    });

    test("no answer under /api/staff/ carries an Access-Control-* header, even to an Origin the app trusts", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const trusted = config.TRUSTED_ORIGINS[0]!;
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, path, init] of [
        ["a read with the trusted Origin", "/api/staff/me", { headers: { cookie, origin: trusted } }],
        ["a preflight from the trusted Origin", "/api/staff/signout", { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
        ["a read of the audit log", "/api/staff/audit", { headers: { cookie } }],
        ["a read with the console's Origin", "/api/staff/sessions", { headers: { cookie, origin: TEST_CONSOLE_ORIGIN } }],
        ["the sign-in options", "/api/staff/signin/options", { method: "POST", headers: { origin: trusted } }],
      ] as const) {
        const res = await raw(path, init);
        expect(accessControlHeaders(res), label).toEqual([]);
      }
      expect(accessControlHeaders(s.first.res)).toEqual([]);
    });

    test("Sec-Fetch-Site other than same-origin, or another Origin, is refused and leaves the idle end and the last use unchanged; another Host is the unknown route", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const before = await sessionRow(s.token);
      clock.advance(5 * MINUTE);
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, headers] of [
        ["same-site", { "sec-fetch-site": "same-site" }],
        ["cross-site", { "sec-fetch-site": "cross-site" }],
        ["the app's Origin", { origin: "http://localhost:8081" }],
        ["another localhost port", { origin: "http://localhost:8090" }],
      ] as const) {
        const res = await raw("/api/staff/me", { headers: { cookie, ...MARKED, ...headers } });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
      // Another Host, the console's cookie and mark notwithstanding: the 404 of an unknown route, the session untouched.
      for (const host of ["localhost:8080", "console.localhost", "localhost:8090"]) {
        const res = await app.request(`http://${host}/api/staff/me`, { headers: { host, cookie, ...MARKED, "cf-connecting-ip": randomIp() } });
        expect([host, res.status, (await error(res)).code]).toEqual([host, 404, "not_found"]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
    });
  });

  describe("the audit log", () => {
    test("newest first by place, the sign-in's row naming its actor by handle; the staff_sign_in filter, cursor pages and ?at=; reading writes nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const [signInRow] = await migrateDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "staff_sign_in"), eq(auditLog.actorId, s.user.id)));
      const before = await head();

      const page = AuditPage.parse(await (await s.b.fetch("/api/staff/audit")).json());
      expect(page.entries[0]!.seq).toBe(before.seq);
      expect(page.entries.map((e) => e.seq)).toEqual([...page.entries.map((e) => e.seq)].sort((a, b) => b - a));
      const mine = page.entries.find((e) => e.seq === signInRow!.chainSeq)!;
      expect(mine).toEqual({
        seq: signInRow!.chainSeq,
        hash: signInRow!.hash,
        createdAt: signInRow!.createdAt.toISOString(),
        actorHandle: s.handle,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: signInRow!.targetId,
        actionHash: null,
      });

      const signIns = AuditPage.parse(await (await s.b.fetch("/api/staff/audit?action=staff_sign_in")).json());
      expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
      expect(signIns.entries[0]!.seq).toBe(signInRow!.chainSeq);

      const at = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?at=${signInRow!.chainSeq}`)).json());
      expect(at.entries[0]!.seq).toBe(signInRow!.chainSeq);
      const older = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?cursor=${signInRow!.chainSeq}`)).json());
      expect(older.entries.every((e) => e.seq < signInRow!.chainSeq)).toBe(true);

      for (const query of ["?at=0", "?cursor=2&at=2", "?action=role_granted", "?cursor=abc"]) {
        const res = await s.b.fetch(`/api/staff/audit${query}`);
        expect([query, res.status, (await error(res)).code]).toEqual([query, 400, "invalid_request"]);
      }
      expect(await head()).toEqual(before);
      await expectEnded(await raw("/api/staff/audit"), "without a session");
    });
  });
});
```

### Replace `apps/api/test/staff/app-mount.test.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { createDb } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const APP_ORIGIN = "http://localhost:8081";
const TRUSTED = "http://localhost:8080";
const CONSOLE_ORIGIN = "http://console.localhost:8090";
const CONSOLE_HOST = "console.localhost:8090";
/** The staff prefix itself, with and without its final slash (distinct paths to Hono's router), and a path under it. */
const PROBE_PATHS = ["/api/staff", "/api/staff/", "/api/staff/probe"];

/**
 * createApp with the staff module (3a design, section 5), the console on or off. The pools are created but never connect:
 * nothing here reaches a flow. `probe` adds a stub route at each of PROBE_PATHS before the first request builds the router,
 * standing in for a route that needs no session, so a request that passes the gate can be told from one that does not: without a route
 * there, a wrong Host and a missing route both end in the same unknown-route 404, gate or no gate.
 */
function build(consoleOrigin: string | undefined, probe = false) {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN,
    TRUSTED_ORIGINS: TRUSTED,
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    ...(consoleOrigin === undefined ? {} : { CONSOLE_ORIGIN: consoleOrigin }),
  });
  const logger = pino({ level: "silent" });
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const staff = createStaff({ apiDb: createDb(config.DATABASE_URL_API, { max: 1 }), auth: auth.forStaff });
  const app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  const seen: { session: unknown; method: string; path: string }[] = [];
  if (probe) {
    app.on(["GET", "POST"], PROBE_PATHS, (c) => {
      seen.push({ session: c.get("session"), method: c.req.method, path: c.req.path });
      return c.json({ ok: true });
    });
  }
  return { app, seen, auth };
}

type ErrorBody = { error: { code: string; message: string; requestId?: string } };

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

describe("the staff module in createApp", () => {
  test("with CONSOLE_ORIGIN unset, every path under /api/staff is the unknown route, whatever the request carries", async () => {
    const { app } = build(undefined);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    for (const [method, path, headers] of [
      ["GET", "/api/staff", { host: CONSOLE_HOST }],
      ["GET", "/api/staff/me", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
      // A write from a foreign origin would meet resolveSession's csrf_failed on any other path.
      ["POST", "/api/staff/signout", { host: CONSOLE_HOST, origin: "https://evil.example" }],
      // A preflight from an origin the app trusts would meet the app's CORS on any other path.
      ["OPTIONS", "/api/staff/me", { origin: TRUSTED, "access-control-request-method": "POST" }],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(accessControlHeaders(res), `${method} ${path}`).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
    }
  });

  test("with CONSOLE_ORIGIN set, the staff gate stands before every staff path, the prefix itself included", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const unknown = (await (await app.request("/api/nope")).json()) as ErrorBody;
    // Another Host: the same 404 as an unknown route, so the console cannot tell a wrong address from a console that is off.
    // Each of these paths has a route, so the 404 is the gate's: for another host, the console's host without its port, and
    // no Host at all.
    for (const path of PROBE_PATHS) {
      for (const headers of [{ host: "localhost:8080" }, { host: "console.localhost" }, {}]) {
        const res = await app.request(path, { headers });
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(404);
        expect(((await res.json()) as ErrorBody).error).toEqual({ ...unknown.error, requestId: res.headers.get("x-request-id") });
      }
    }
    // The console's Host with another Origin: refused by the gate before any route runs.
    const foreign = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST, origin: APP_ORIGIN } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "csrf_failed" } });
    expect(seen).toEqual([]);
    // Through the gate, a path no route answers is still the unknown route.
    expect((await app.request("/api/staff/nothing-here", { headers: { host: CONSOLE_HOST } })).status).toBe(404);
    // The console's Host reaches the route at every one of them, the prefix itself included.
    for (const path of PROBE_PATHS) expect((await app.request(path, { headers: { host: CONSOLE_HOST } })).status, path).toBe(200);
    expect(seen.map((request) => request.path)).toEqual(PROBE_PATHS);
  });

  test("a console write carrying the app's session and CSRF cookies reaches the staff route: the app's session is never resolved there", async () => {
    const { app, seen } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: {
        host: CONSOLE_HOST,
        origin: CONSOLE_ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: "__Host-korbat_session=not-a-session; __Host-korbat_csrf=abc",
        authorization: "Bearer not-a-token",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ session: undefined, method: "POST", path: "/api/staff/probe" }]);
  });

  test("no staff answer carries CORS headers, even to an origin the app trusts; the app's other paths keep them", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    for (const [method, headers] of [
      ["GET", { host: CONSOLE_HOST, origin: TRUSTED }],
      ["OPTIONS", { host: CONSOLE_HOST, origin: TRUSTED, "access-control-request-method": "POST" }],
      ["GET", { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }],
    ] as const) {
      const res = await app.request("/api/staff/probe", { method, headers });
      expect(accessControlHeaders(res), `${method} ${headers.origin}`).toEqual([]);
    }
    // The one path test: /api/staff and what begins with /api/staff/, never a path that merely starts with the letters.
    const neighbour = await app.request("/api/staffing", { headers: { origin: TRUSTED } });
    expect(neighbour.status).toBe(404);
    expect(neighbour.headers.get("access-control-allow-origin")).toBe(TRUSTED);
    const health = await app.request("/api/health", { headers: { origin: TRUSTED } });
    expect(health.headers.get("access-control-allow-origin")).toBe(TRUSTED);
  });

  test("the enrolment routes stand behind the gate and validate their bodies before any flow runs", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const path of ["/api/staff/enroll/options", "/api/staff/enroll/verify"]) {
      const post = (headers: Record<string, string>, body: unknown) =>
        app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      // Another Host is the unknown route, another Origin the gate's refusal, a write without an Origin too.
      expect((await post({ host: "localhost:8080", origin: CONSOLE_ORIGIN }, {})).status, path).toBe(404);
      const foreign = await post({ host: CONSOLE_HOST, origin: APP_ORIGIN }, {});
      expect([path, foreign.status, ((await foreign.json()) as ErrorBody).error.code]).toEqual([path, 403, "csrf_failed"]);
      expect((await post({ host: CONSOLE_HOST }, {})).status, path).toBe(403);
      // Through the gate, a body the contracts refuse is invalid_request; the pools behind the flows are never reached.
      const invalid = await post({ host: CONSOLE_HOST, origin: CONSOLE_ORIGIN }, { token: "short", name: "", kind: "phone" });
      expect([path, invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([path, 400, "invalid_request"]);
    }
  });

  test("the session routes stand behind the gate and requireStaff: without a staff cookie each is staff_session_required with both staff cookies cleared, before any database read", async () => {
    // The pools point at a port nothing listens on: a route that read the database would fail with another answer.
    const { app } = build(CONSOLE_ORIGIN);
    const routes = [
      ["GET", "/api/staff/me"],
      ["GET", "/api/staff/sessions"],
      ["GET", "/api/staff/keys"],
      ["GET", "/api/staff/audit"],
      ["POST", "/api/staff/signout"],
      // Step-up and the revocation it confirms: no session, no confirmation is even read.
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const;
    for (const [method, path] of routes) {
      // Another Host is still the unknown route, before any session is looked for.
      expect((await app.request(path, { method, headers: { host: "localhost:8080", origin: CONSOLE_ORIGIN } })).status, path).toBe(404);
      // The app's session cookie and a bearer token are not staff sessions.
      const res = await app.request(path, {
        method,
        headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_session=kb1_x; __Host-korbat_csrf=c", "x-csrf-token": "c", authorization: `Bearer kb1_${"A".repeat(43)}` },
      });
      expect([path, res.status, ((await res.json()) as ErrorBody).error.code]).toEqual([path, 401, "staff_session_required"]);
      const cleared = res.headers.getSetCookie();
      expect(cleared.map((line) => line.slice(0, line.indexOf("="))).sort(), path).toEqual(["__Host-korbat_staff", "__Host-korbat_staff_csrf"]);
      for (const line of cleared) expect(line, path).toContain("Max-Age=0");
      expect(accessControlHeaders(res), path).toEqual([]);
    }
  });

  test("a staff write with the staff cookie but without the staff CSRF header is csrf_failed, before any database read", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    for (const [method, path] of [
      ["POST", "/api/staff/signout"],
      ["POST", "/api/staff/step-up/options"],
      ["DELETE", "/api/staff/sessions/3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"],
    ] as const) {
      const res = await app.request(path, { method, headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, cookie: "__Host-korbat_staff=x; __Host-korbat_staff_csrf=y" } });
      expect([path, res.status]).toEqual([path, 403]);
      expect(((await res.json()) as ErrorBody).error.code).toBe("csrf_failed");
      // A refused write ends nothing: the cookies stay.
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  test("the sign-in options need no session and read no database: a staff sign-in challenge for discoverable, user-verified credentials of the console", async () => {
    const { app } = build(CONSOLE_ORIGIN);
    const res = await app.request("/api/staff/signin/options", { method: "POST", headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN } });
    expect(res.status).toBe(200);
    const { options } = (await res.json()) as { options: { rpId: string; challenge: string; allowCredentials?: unknown[]; userVerification: string } };
    expect(options.rpId).toBe("console.localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(Buffer.from(options.challenge, "base64url")).toHaveLength(58);
    expect(res.headers.getSetCookie()).toEqual([]);
    // The verification validates its body before any flow runs.
    const invalid = await app.request("/api/staff/signin/verify", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ response: { id: "x" } }),
    });
    expect([invalid.status, ((await invalid.json()) as ErrorBody).error.code]).toEqual([400, "invalid_request"]);
  });

  test("no staff power remains in the app: the auth module offers no requireStaffMfa, and no source names it", () => {
    const { auth } = build(CONSOLE_ORIGIN);
    expect(Object.keys(auth)).not.toContain("requireStaffMfa");
    expect(Object.keys(auth)).toContain("requireStaff");
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const mentions = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && readFileSync(join(src, file), "utf8").includes("requireStaffMfa"));
    expect(mentions).toEqual([]);
  });

  test("staff paths keep the JSON body limit and the API's headers", async () => {
    const { app } = build(CONSOLE_ORIGIN, true);
    const res = await app.request("/api/staff/probe", {
      method: "POST",
      headers: { host: CONSOLE_HOST, origin: CONSOLE_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ x: "x".repeat(70_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const ok = await app.request("/api/staff/probe", { headers: { host: CONSOLE_HOST } });
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

### Replace `packages/contracts/test/staff.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AuditEntry,
  AuditPage,
  AuditPageQuery,
  AuthenticationResponseJSON,
  DisplayName,
  PasskeyOptionsResponse,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_ACTIONS,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffErrorCode,
  StaffKey,
  StaffKeyKind,
  StaffKeyName,
  StaffKeysResponse,
  StaffMe,
  StaffRole,
  StaffSession,
  StaffSessionRevokeRequest,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyRequest,
  StaffSignInVerifyResponse,
  StaffStepUpActionName,
  StaffStepUpOptionsRequest,
  StaffStepUpOptionsResponse,
  StaffStoredAssertion,
  stepUpActionHash,
  stepUpActionText,
  stepUpBinding,
  stepUpBindingText,
} from "../src/index";

const BELL = String.fromCharCode(7);
/** U+202E, the right-to-left override: invisible, and refused by the display-name rules. */
const RLO = String.fromCharCode(0x202e);

/** A base64url string of exactly n characters. */
const b64 = (n: number) => "A".repeat(n);

const at = "2026-09-30T10:00:00.000Z";
const later = "2026-09-30T22:00:00.000Z";
const token = "a".repeat(43);
const uuid = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const hex = "ab".repeat(32);

/** What @simplewebauthn/browser's startRegistration returns for a security key. */
const registration = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), attestationObject: b64(400), transports: ["usb", "nfc"] },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

/** What startAuthentication returns for a discoverable staff key: the user handle is there. */
const assertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), authenticatorData: b64(50), signature: b64(96), userHandle: b64(43) },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

const options = { challenge: b64(78), rpId: "console.korbat.example", allowCredentials: [], userVerification: "required", timeout: 300000 };

/** Every key of an object removed in turn must make the schema refuse it. */
function everyFieldRequired(schema: { safeParse: (value: unknown) => { success: boolean } }, value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    const partial: Record<string, unknown> = { ...value };
    delete partial[key];
    expect(schema.safeParse(partial).success, key).toBe(false);
  }
}

describe("staff error codes", () => {
  test("are exactly the ten codes of the staff flows", () => {
    expect(StaffErrorCode.options).toEqual([
      "staff_session_required",
      "staff_key_invalid",
      "staff_key_suspended",
      "staff_key_limit",
      "staff_key_not_device_bound",
      "staff_key_not_user_verified",
      "staff_key_refused",
      "staff_enrollment_invalid",
      "staff_step_up_required",
      "staff_step_up_invalid",
    ]);
    expect(StaffErrorCode.safeParse("passkey_invalid").success).toBe(false);
  });
});

describe("staff roles, key names and kinds", () => {
  test("a staff role is moderator or admin, never user", () => {
    expect(StaffRole.options).toEqual(["moderator", "admin"]);
    expect(StaffRole.safeParse("user").success).toBe(false);
  });

  test("a key's name follows the display-name rules", () => {
    expect(StaffKeyName).toBe(DisplayName);
    expect(StaffKeyName.parse("  Blue key ")).toBe("Blue key");
    expect(StaffKeyName.safeParse("x".repeat(51)).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${BELL}key`).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${RLO}key`).success).toBe(false);
  });

  test("a key is a security key or this device", () => {
    expect(StaffKeyKind.options).toEqual(["security_key", "this_device"]);
    expect(StaffKeyKind.safeParse("platform").success).toBe(false);
  });
});

describe("enrolment", () => {
  test("options are asked for with the link's token, the key's name and its kind", () => {
    const request = { token, name: " Blue key ", kind: "security_key" };
    expect(StaffEnrollOptionsRequest.parse(request)).toEqual({ token, name: "Blue key", kind: "security_key" });
    expect(StaffEnrollOptionsRequest.parse({ ...request, kind: "this_device" }).kind).toBe("this_device");
    everyFieldRequired(StaffEnrollOptionsRequest, request);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: "a".repeat(42) }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: `${"a".repeat(42)}=` }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, name: "" }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, kind: "passkey" }).success).toBe(false);
  });

  test("the options answer says whether the console's relying party ID is the app's", () => {
    const answer = { options: { ...options, rp: { id: "localhost", name: "korbat" } }, rpShared: true };
    expect(StaffEnrollOptionsResponse.parse(answer)).toEqual(answer);
    expect(StaffEnrollOptionsResponse.parse({ ...answer, rpShared: false }).rpShared).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ options: answer.options }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, rpShared: "no" }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, options: { challenge: "abc+/" } }).success).toBe(false);
  });

  test("verify takes the token, the name and a registration response, never an assertion", () => {
    const request = { token, name: "Blue key", response: registration };
    expect(StaffEnrollVerifyRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffEnrollVerifyRequest, request);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, response: assertion }).success).toBe(false);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, name: "x".repeat(51) }).success).toBe(false);
  });

  test("verify answers with the key it stored", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: null };
    expect(StaffEnrollVerifyResponse.parse({ key })).toEqual({ key });
    expect(StaffEnrollVerifyResponse.safeParse({}).success).toBe(false);
  });
});

describe("sign-in", () => {
  test("the options answer is the library's options with a base64url challenge", () => {
    expect(StaffSignInOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffSignInOptionsResponse.parse({ options })).toEqual({ options });
  });

  test("verify takes an assertion, never a registration", () => {
    expect(StaffSignInVerifyRequest.parse({ response: assertion })).toEqual({ response: assertion });
    expect(StaffSignInVerifyRequest.safeParse({ response: registration }).success).toBe(false);
    expect(StaffSignInVerifyRequest.safeParse({}).success).toBe(false);
  });

  test("verify answers with the new session, as /me describes it", () => {
    expect(StaffSignInVerifyResponse).toBe(StaffMe);
  });
});

describe("the staff account and its session", () => {
  const me = {
    handle: "mod_ada",
    role: "moderator",
    sessionHandle: uuid,
    idleExpiresAt: at,
    idleSecondsLeft: 900,
    absoluteExpiresAt: later,
    absoluteSecondsLeft: 43_200,
  };

  test("/me carries the handle, the role, the session's handle and both expiries with the seconds left", () => {
    expect(StaffMe.parse(me)).toEqual(me);
    expect(StaffMe.parse({ ...me, role: "admin", idleSecondsLeft: 0, absoluteSecondsLeft: 0 }).role).toBe("admin");
    everyFieldRequired(StaffMe, me);
  });

  test("/me refuses a user's role, a session handle that is not a uuid, and seconds that are negative or fractional", () => {
    expect(StaffMe.safeParse({ ...me, role: "user" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, sessionHandle: "nope" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: -1 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, absoluteSecondsLeft: 1.5 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleExpiresAt: "tonight" }).success).toBe(false);
  });

  test("the idle end never lies beyond the absolute end", () => {
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_201 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_200 }).success).toBe(true);
  });

  test("a staff session is listed with its handle, browser, dates and whether it is this one", () => {
    const session = { handle: uuid, browser: "Firefox on Linux", createdAt: at, lastUsedAt: at, current: true };
    expect(StaffSession.parse(session)).toEqual(session);
    everyFieldRequired(StaffSession, session);
    expect(StaffSession.safeParse({ ...session, handle: "abc" }).success).toBe(false);
    expect(StaffSessionsResponse.parse({ sessions: [session] })).toEqual({ sessions: [session] });
    expect(StaffSessionsResponse.parse({ sessions: [] })).toEqual({ sessions: [] });
    expect(StaffSessionsResponse.safeParse({}).success).toBe(false);
  });

  test("a staff key is listed with its id, name and dates, never its public key", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: at };
    expect(StaffKey.parse(key)).toEqual(key);
    expect(StaffKey.parse({ ...key, lastUsedAt: null }).lastUsedAt).toBeNull();
    // A member the reader never sends is dropped, not passed on to the page.
    expect(StaffKey.parse({ ...key, publicKey: b64(100) })).toEqual(key);
    everyFieldRequired(StaffKey, key);
    expect(StaffKeysResponse.parse({ keys: [key] })).toEqual({ keys: [key] });
    expect(StaffKeysResponse.safeParse({ keys: [{ ...key, id: 7 }] }).success).toBe(false);
  });
});

describe("step-up actions", () => {
  test("3a has one: revoking a staff session, whose target is a staff session and whose params are empty", () => {
    expect(Object.keys(STAFF_STEP_UP_ACTIONS)).toEqual(["staff_session_revoked"]);
    expect(StaffStepUpActionName.options).toEqual(Object.keys(STAFF_STEP_UP_ACTIONS));
    const spec = STAFF_STEP_UP_ACTIONS.staff_session_revoked;
    expect(spec.targetType).toBe("staff_session");
    expect(spec.targetId.safeParse(uuid).success).toBe(true);
    expect(spec.targetId.safeParse("abc").success).toBe(false);
    // Only the lower-case spelling PostgreSQL writes: the id is hashed as sent, and the audit row records the database's.
    expect(spec.targetId.safeParse(uuid.toUpperCase()).success).toBe(false);
    expect(spec.targetId.safeParse(uuid.slice(0, 9) + uuid.slice(9).toUpperCase()).success).toBe(false);
    expect(spec.params.parse({})).toEqual({});
    // Params are hashed as they are sent, so a member the schema does not know is refused, never dropped.
    expect(spec.params.safeParse({ all: true }).success).toBe(false);
  });

  test("the options request names the action, its target and its params, each checked by that action's own schema", () => {
    const request = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
    expect(StaffStepUpOptionsRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffStepUpOptionsRequest, request);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, action: "role_granted" }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_key", id: uuid } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: "abc" } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid.toUpperCase() } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid, extra: 1 } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, params: { all: true } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, stepUp: assertion }).success).toBe(false);
  });

  test("the options answer is the library's options", () => {
    expect(StaffStepUpOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffStepUpOptionsResponse.parse({ options: { ...options, allowCredentials: [{ id: b64(22), type: "public-key" }] } }).options.challenge).toBe(options.challenge);
  });

  test("revoking a session takes its params with the step-up assertion added", () => {
    expect(StaffSessionRevokeRequest.parse({ stepUp: assertion })).toEqual({ stepUp: assertion });
    expect(StaffSessionRevokeRequest.safeParse({}).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: registration }).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: assertion, all: true }).success).toBe(false);
  });

  test("the stored assertion is the authenticator data, client data and signature, bounded as the browser's answer is", () => {
    const stored = { authenticatorData: b64(50), clientDataJSON: b64(200), signature: b64(96) };
    expect(StaffStoredAssertion.parse(stored)).toEqual(stored);
    everyFieldRequired(StaffStoredAssertion, stored);
    expect(StaffStoredAssertion.shape.signature).toBe(AuthenticationResponseJSON.shape.response.shape.signature);
    expect(StaffStoredAssertion.safeParse({ ...stored, signature: b64(1025) }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, clientDataJSON: "ab/cd" }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, userHandle: b64(43) }).success).toBe(false);
  });
});

describe("the step-up action's hash and binding", () => {
  const BS = String.fromCharCode(92);
  const LF = String.fromCharCode(10);
  const revoke = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
  // The 3a action's sorted JSON, and the sha256 values below, were checked with Python's hashlib when they were written.
  const REVOKE_TEXT = `{"action":"staff_session_revoked","params":{},"target":{"id":"${uuid}","type":"staff_session"}}`;
  const REVOKE_HASH = "dad06ce5248ff75b3aa9b1faec9bab38bfa70f6dd2568d231b02e282207385c5";
  const SESSION = "8a3c7f0e-1111-4222-8333-944445555666";
  const BINDING = "9b70fa1ab475e7958d1265150cd04c7953483fe6145f52b12b2fd89d0c598dca";
  const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  test("the action's text is the sorted JSON of its action, target and params: object keys sorted, no whitespace", () => {
    expect(stepUpActionText(revoke)).toBe(REVOKE_TEXT);
    // The order the members were written in changes nothing.
    expect(stepUpActionText({ params: {}, target: { id: uuid, type: "staff_session" }, action: "staff_session_revoked" })).toBe(REVOKE_TEXT);
    // The options request is hashed as it was sent: its schemas change nothing in it.
    expect(stepUpActionText(StaffStepUpOptionsRequest.parse(revoke))).toBe(REVOKE_TEXT);
  });

  test("params are sorted at every depth, arrays keep their order, and strings and numbers are written as JSON.stringify writes them", () => {
    const params = { b: [3, { z: 1, a: null }, "x"], a: `q"${BS}`, c: true, d: 0.5, e: -0, "": -1, B: { y: [], x: {} } };
    expect(stepUpActionText({ action: "case_decided", target: { type: "post", id: "p1" }, params })).toBe(
      `{"action":"case_decided","params":{"":-1,"B":{"x":{},"y":[]},"a":"q${BS}"${BS}${BS}","b":[3,{"a":null,"z":1},"x"],"c":true,"d":0.5,"e":0},"target":{"id":"p1","type":"post"}}`,
    );
  });

  test("keys are sorted by UTF-16 code units, as Array.prototype.sort sorts them in the API, audit-verify and the console alike", () => {
    const eAcute = String.fromCharCode(0xe9);
    const fullwidthA = String.fromCharCode(0xff21);
    // An astral character's first code unit (0xd83d) sorts before 0xff21, though its code point (0x1f600) is higher.
    const grinning = String.fromCodePoint(0x1f600);
    const params = { [fullwidthA]: 1, [grinning]: 2, [eAcute]: 3, z: 4 };
    expect(stepUpActionText({ action: "a", target: { type: "t", id: "i" }, params })).toBe(
      `{"action":"a","params":{"z":4,"${eAcute}":3,"${grinning}":2,"${fullwidthA}":1},"target":{"id":"i","type":"t"}}`,
    );
  });

  test("a value that is not JSON is refused rather than hashed", () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 1, BigInt(1), new Date(0), [undefined], Symbol("x")]) {
      expect(() => stepUpActionText({ action: "a", target: { type: "t", id: "i" }, params: { value } }), String(typeof value)).toThrow(TypeError);
    }
  });

  test("the action's hash is the lower-case hex sha256 of the text's UTF-8 bytes", async () => {
    expect(await stepUpActionHash(revoke)).toBe(REVOKE_HASH);
    const reason = String.fromCharCode(0xe9, 0x4e2d) + String.fromCodePoint(0x1f600);
    expect(await stepUpActionHash({ action: "case_decided", target: { type: "post", id: "p1" }, params: { reason } })).toBe(
      "8f41483850c87296607ff1c3fd5e501574bcc3f564a09d935a7063efab414720",
    );
  });

  test("another action, target or params gives another hash: params are bound too, though 3a's one action has none", async () => {
    const hashes = await Promise.all([
      stepUpActionHash(revoke),
      stepUpActionHash({ ...revoke, action: "staff_key_revoked" }),
      stepUpActionHash({ ...revoke, target: { type: "staff_session", id: "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a" } }),
      stepUpActionHash({ ...revoke, target: { type: "staff_key", id: uuid } }),
      stepUpActionHash({ ...revoke, params: { all: true } }),
      stepUpActionHash({ ...revoke, params: { all: false } }),
      stepUpActionHash({ ...revoke, params: { items: [1, 2] } }),
      stepUpActionHash({ ...revoke, params: { items: [2, 1] } }),
    ]);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("the binding is the full 32-byte sha256 of the session's handle, a newline and the action's hash", async () => {
    expect(stepUpBindingText(SESSION, REVOKE_HASH)).toBe(`${SESSION}${LF}${REVOKE_HASH}`);
    const binding = await stepUpBinding(SESSION, REVOKE_HASH);
    expect(binding).toBeInstanceOf(Uint8Array);
    expect(binding).toHaveLength(32);
    expect(hexOf(binding)).toBe(BINDING);
    // Another session, or another action, binds something else.
    expect(hexOf(await stepUpBinding("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", REVOKE_HASH))).not.toBe(BINDING);
    expect(hexOf(await stepUpBinding(SESSION, "0".repeat(64)))).not.toBe(BINDING);
  });

  test("the step-up challenge's layout: 74 bytes of version, purpose, expiry, nonce, the full binding and the seal", () => {
    expect(STAFF_STEP_UP_CHALLENGE).toEqual({
      bytes: 74,
      encodedLength: 99,
      version: 1,
      purpose: 6,
      versionAt: 0,
      purposeAt: 1,
      expiryAt: 2,
      expiryBytes: 8,
      nonceAt: 10,
      nonceBytes: 16,
      bindingAt: 26,
      bindingBytes: 32,
      sealAt: 58,
      sealBytes: 16,
    });
    // The fields follow one another with no gap, and the encoded length is the bytes' unpadded base64url length.
    const c = STAFF_STEP_UP_CHALLENGE;
    expect([c.purposeAt + 1, c.expiryAt + c.expiryBytes, c.nonceAt + c.nonceBytes, c.bindingAt + c.bindingBytes, c.sealAt + c.sealBytes]).toEqual([
      c.expiryAt,
      c.nonceAt,
      c.bindingAt,
      c.sealAt,
      c.bytes,
    ]);
    expect(c.encodedLength).toBe(Math.ceil((c.bytes * 8) / 6));
  });
});

describe("the audit log", () => {
  const entry = {
    seq: 42,
    hash: hex,
    createdAt: at,
    actorHandle: "mod_ada",
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: uuid,
    actionHash: "cd".repeat(32),
  };

  test("an entry carries its place and hash, time, actor handle, action, target and the action's hash", () => {
    expect(AuditEntry.parse(entry)).toEqual(entry);
    // The system actor has no handle; most rows have no step-up, some no target.
    const bare = { ...entry, actorHandle: null, targetType: null, targetId: null, actionHash: null };
    expect(AuditEntry.parse(bare)).toEqual(bare);
    everyFieldRequired(AuditEntry, entry);
  });

  test("an entry never carries metadata, and its place and hashes have their exact forms", () => {
    expect(AuditEntry.parse({ ...entry, metadata: { email: "a@b.c" } })).toEqual(entry);
    for (const seq of [0, -1, 1.5, "42"]) expect(AuditEntry.safeParse({ ...entry, seq }).success, String(seq)).toBe(false);
    for (const hash of ["AB".repeat(32), "ab".repeat(31), `${"ab".repeat(31)}zz`]) {
      expect(AuditEntry.safeParse({ ...entry, hash }).success, hash).toBe(false);
      expect(AuditEntry.safeParse({ ...entry, actionHash: hash }).success, hash).toBe(false);
    }
  });

  test("a page holds at most 50 entries and the cursor of the next one, null at the end", () => {
    expect(STAFF_AUDIT_PAGE_SIZE).toBe(50);
    expect(AuditPage.parse({ entries: [entry], nextCursor: 42 })).toEqual({ entries: [entry], nextCursor: 42 });
    expect(AuditPage.parse({ entries: [], nextCursor: null })).toEqual({ entries: [], nextCursor: null });
    expect(AuditPage.safeParse({ entries: Array(51).fill(entry), nextCursor: null }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: Array(50).fill(entry), nextCursor: 1 }).success).toBe(true);
    expect(AuditPage.safeParse({ entries: [entry] }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: [entry], nextCursor: 0 }).success).toBe(false);
  });

  test("a page is asked for by cursor, by place (at) or from the newest, with sign-ins as the one filter", () => {
    expect(AuditPageQuery.parse({})).toEqual({});
    expect(AuditPageQuery.parse({ cursor: "42" })).toEqual({ cursor: 42 });
    expect(AuditPageQuery.parse({ at: "7", action: "staff_sign_in" })).toEqual({ at: 7, action: "staff_sign_in" });
    expect(AuditPageQuery.parse({ cursor: "999999999999999" }).cursor).toBe(999_999_999_999_999);
    for (const value of ["0", "-1", "1.5", "01", "1e3", "", " 4", "abc", "1000000000000000"]) {
      expect(AuditPageQuery.safeParse({ cursor: value }).success, value).toBe(false);
      expect(AuditPageQuery.safeParse({ at: value }).success, value).toBe(false);
    }
    expect(AuditPageQuery.safeParse({ action: "role_granted" }).success).toBe(false);
    // A cursor reads older rows and at reads from a place: both at once name no page.
    expect(AuditPageQuery.safeParse({ cursor: "4", at: "7" }).success).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:  ❯ test/staff.test.ts (33 tests | 9 failed) 121ms
packages/contracts test:  Test Files  1 failed | 7 passed (8)
packages/contracts test:       Tests  9 failed | 130 passed (139)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/05-step-up.md 3
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/staff/step-up.ts`

```ts
import {
  AuthenticationResponseJSON,
  STAFF_STEP_UP_ACTIONS,
  stepUpActionHash,
  type StaffStepUpAction,
  type StaffStepUpOptionsRequest,
  type StaffStoredAssertion,
} from "@korbat/contracts";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { errorBody } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { challengeKey, issueStepUpChallenge, readStepUpChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import type { ActiveStaffSession } from "./sessions";

/**
 * The staff step-up (3a design, section 7, Step-up): a route that changes something asks for a fresh assertion from the
 * session's own staff key, made over a challenge bound to the session's handle and to the action's hash, so it confirms
 * that one action, with those params, in that session, once. The routes live in the staff module; the credential work is
 * here, and every refusal the codec or the wrapper raises is answered staff_step_up_invalid, never a passkey_* code.
 */

/** An action a step-up confirms, as the route will execute it: one of the contracts' step-up actions, its target and params. */
export interface StaffStepUpRequest {
  action: StaffStepUpAction;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * What a verified step-up hands the route that executes the action: the action as confirmed, its hash, the key that
 * signed, and the assertion's three members, which the action's audit row stores for audit-verify.
 */
export interface StaffStepUpConfirmed extends StaffStepUpRequest {
  actionHash: string;
  keyId: string;
  assertion: StaffStoredAssertion;
}

/** Every refusal of a confirmation before or at its signature, a confirmation made for anything else included. */
const stepUpInvalid = () => new AuthError("staff_step_up_invalid", 403);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_step_up_invalid; challenge_expired stays, and the console asks again. */
async function invalidAsStepUp<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw stepUpInvalid();
    throw err;
  }
}

/**
 * Options for confirming one action: a step-up challenge bound to the session's handle and the hash of exactly the
 * `{ action, target, params }` the console sent, user verification required, the console's relying party, and an allow
 * list holding only the session's key. The console checks the binding before it asks for the key. Handing them out
 * stores nothing.
 */
export async function stepUpOptions(deps: AuthDeps, session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const key = await deps.repo.findStaffKeyCredential(session.keyId);
  // requireStaff read the session with its key live; a key revoked since then ends the session as requireStaff would, and
  // requireStaff clears both cookies on this answer as on its own.
  if (!key || key.revokedAt !== null) throw new AuthError("staff_session_required", 401);
  const actionHash = await stepUpActionHash(request);
  const challenge = issueStepUpChallenge(challengeKey(deps.config.authHmacKey), deps.now(), session.handle, actionHash);
  const options = await authenticationOptions({
    rpId: staffConsole.rpId,
    allow: [{ id: key.credentialId, transports: key.transports }],
    challenge,
    userVerification: "required",
  });
  return { options };
}

/**
 * Verifies a confirmation of `request` in `session`. The action's hash is recomputed from what the route is about to do,
 * and the challenge read from the assertion is checked against the session's handle and that hash, then spent, before
 * anything else runs. The assertion must come from the session's own key, verified against CONSOLE_ORIGIN and
 * CONSOLE_RP_ID alone. A challenge the codec refuses (forged, of another purpose, bound to another session, action,
 * target or params, or spent), an assertion from another key and one the library refuses are all staff_step_up_invalid.
 * Only after the signature are the flags read, each refusal with its own code, as at sign-in; then 1c's counter rule, where
 * a regression revokes the key and every staff session it opened.
 */
export async function verifyStepUp(
  deps: AuthDeps,
  session: ActiveStaffSession,
  request: StaffStepUpRequest,
  stepUp: AuthenticationResponseJSON,
  ctx: StaffRequestContext,
): Promise<StaffStepUpConfirmed> {
  const staffConsole = consoleOf(deps);
  const now = deps.now();
  const actionHash = await stepUpActionHash(request);
  const challenge = await invalidAsStepUp(() => readResponseChallenge(stepUp));
  // Read with a minute of its life to spare, so the audit row written after the steps below is never later than its expiry.
  await invalidAsStepUp(() => readStepUpChallenge(challengeKey(deps.config.authHmacKey), challenge, now, session.handle, actionHash));
  await invalidAsStepUp(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyCredential(session.keyId);
  // Only the session's own key confirms, as the options' allow list said; a key revoked since requireStaff read the
  // session confirms nothing either.
  if (!key || key.revokedAt !== null || key.userId !== session.userId || stepUp.id !== key.credentialId) throw stepUpInvalid();
  const verified = await invalidAsStepUp(() =>
    verifyAuthentication({
      response: stepUp,
      expectedChallenge: challenge,
      origins: [staffConsole.origin],
      rpId: staffConsole.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed (3a design, section 2).
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  // False when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!(await deps.repo.recordStaffKeyUse({ keyId: key.id, userId: key.userId, newCounter: verified.newCounter, now }))) {
    return revokeForCounterRegression(deps, key, ctx, "step_up");
  }
  return {
    action: request.action,
    target: { type: request.target.type, id: request.target.id },
    params: request.params,
    actionHash,
    keyId: key.id,
    // Exactly as the browser sent them: audit-verify checks the signature over these bytes.
    assertion: { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
  };
}

/**
 * Stands before every staff route that changes something, behind requireStaff (3a design, section 7, Step-up). The route
 * takes its own body with the assertion added as `stepUp`; the rest of the body is the action's params, validated by the
 * action's own strict schema, and `target` reads the action's target from the request itself (for DELETE
 * /api/staff/sessions/:handle, the path's handle). The action's hash is recomputed from exactly that, so the route executes
 * only what the key confirmed. Without `stepUp` the answer is staff_step_up_required; a malformed body is invalid_request,
 * as the shared validator answers it. The confirmed step-up is left in `staffStepUp` for the route to record.
 */
export function requireStaffStepUp(deps: AuthDeps, action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  const body = spec.params.extend({ stepUp: AuthenticationResponseJSON.optional() });
  const readBody = validate("json", body);
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("staffSession");
    if (!session) throw new Error("requireStaffStepUp runs behind requireStaff");
    const targetId = spec.targetId.safeParse(target(c));
    if (!targetId.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(targetId.error)), 400);
    }
    // The shared validator answers a body its schema refuses; on success it leaves the parsed body on the request.
    const refused = await readBody(c as Parameters<typeof readBody>[0], async () => {});
    if (refused) return refused;
    const { stepUp, ...params } = body.parse((c.req as unknown as { valid(target: "json"): unknown }).valid("json"));
    if (stepUp === undefined) throw new AuthError("staff_step_up_required", 403);
    const ctx: StaffRequestContext = { ipHash: c.get("clientIpHash") ?? "direct", userAgent: c.req.header("user-agent"), requestId: c.get("requestId") };
    c.set("staffStepUp", await verifyStepUp(deps, session, { action, target: { type: spec.targetType, id: targetId.data }, params }, stepUp, ctx));
    await next();
  });
}

/**
 * DELETE /api/staff/sessions/:handle, once its step-up verified: revokes one of the person's own live staff sessions with
 * its staff_session_revoked event and its audit row, which carries the confirmation, in one transaction. False when the
 * handle names no live session of the person's, which writes nothing. When the confirming key or the account no longer
 * opens anything by then, the session that confirmed has ended: staff_session_required, and nothing is revoked. No mail:
 * the person did it themselves, with their key.
 */
export async function revokeStaffSession(deps: AuthDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean> {
  // A confirmation of anything else never revokes a session: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "staff_session_revoked" || confirmed.target.type !== "staff_session" || confirmed.keyId !== session.keyId) {
    throw new Error("a staff session's revocation needs a step-up that confirmed it");
  }
  const outcome = await deps.repo.revokeConfirmedStaffSession({
    userId: session.userId,
    staffSession: session.handle,
    keyId: confirmed.keyId,
    handle: confirmed.target.id,
    actionHash: confirmed.actionHash,
    params: confirmed.params,
    stepUp: confirmed.assertion,
    now: deps.now(),
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
  });
  // requireStaff clears both cookies on this answer, as on its own.
  if (outcome === "ended") throw new AuthError("staff_session_required", 401);
  return outcome === "revoked";
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type {
  DeleteConfirmRequest,
  DeleteStartResponse,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInVerifyRequest,
  StaffStepUpAction,
  StaffStepUpOptionsRequest,
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Context, MiddlewareHandler } from "hono";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext, type StaffRequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import type { PublicKeyCredentialRequestOptionsJSON } from "./passkeys/webauthn";
import { enrollOptions, enrollVerify, type StaffEnrollOptions } from "./staff/enroll";
import { requireStaff } from "./staff/middleware";
import { listStaffKeys, listStaffSessions, signOutStaff, staffMe, type ActiveStaffSession } from "./staff/sessions";
import { signInOptions, signInVerify, type StaffSignedIn } from "./staff/signin";
import { requireStaffStepUp, revokeStaffSession, stepUpOptions, type StaffStepUpConfirmed } from "./staff/step-up";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext, StaffRequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { ActiveStaffSession } from "./staff/sessions";
export type { StaffSignedIn } from "./staff/signin";
export type { StaffStepUpConfirmed } from "./staff/step-up";
export type { StaffKeysRevokedReport } from "./staff/revoke";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
/**
 * The staff module's sign-in and sign-out routes set and clear the staff cookies (3a design, section 5); their names and
 * attributes stay this module's, and requireStaff is their only reader.
 */
export { clearStaffCookies, setStaffCookies } from "./staff/cookies";
/** `staff.js revoke`, from the server's command line only, as grant-role's grantRole is. */
export { revokeStaffKeys } from "./staff/revoke";
/**
 * audit-verify's check of a step-up assertion an audit row stored, against the public key, origin and relying party ID
 * recorded on its key (3a design, section 7, Command line): the WebAuthn library stays behind the wrapper, and the check
 * needs no server secret.
 */
export { verifyRecordedAssertion, type RecordedAssertion } from "./passkeys/webauthn";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
  /** The account's facts, its passkeys (without their keys), its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * What the staff module needs from this one (3a design, section 5): the credential side of the staff routes, which the
 * staff module mounts behind its gate. Staff keys, staff sessions and enrolments are credentials, so their flows and
 * tables stay here, and the staff module reaches them only through this interface.
 */
export interface AuthForStaff {
  /** Registration options for the key an enrolment link's holder is about to create. */
  enrollOptions(input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions>;
  /** Checks the browser's answer and stores the staff key, spending the link; the owner is mailed. */
  enrollVerify(input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse>;
  /** Discoverable-credential options for a staff sign-in. */
  signInOptions(): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /** Checks a staff key's assertion and opens a staff session; the route sets its cookies with setStaffCookies. */
  signInVerify(input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn>;
  /** Stands before every staff route that needs a session: reads it and sets `staffSession` on the context. */
  requireStaff: MiddlewareHandler<AppEnv>;
  /** The session's account and both its ends, with the seconds left. */
  me(session: ActiveStaffSession): Promise<StaffMe>;
  /** The person's own live staff sessions. */
  sessions(session: ActiveStaffSession): Promise<StaffSessionsResponse>;
  /** The person's own live staff keys. */
  keys(session: ActiveStaffSession): Promise<StaffKeysResponse>;
  /** Ends the session, on the record; the route clears its cookies with clearStaffCookies. */
  signOut(session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void>;
  /** Options for confirming one action with the session's key: a challenge bound to the session and to exactly that action. */
  stepUpOptions(session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /**
   * Stands before every staff route that changes something, behind requireStaff: verifies the body's `stepUp` against the
   * action, the target `target` reads from the request and the body's params, and sets `staffStepUp` on the context.
   */
  requireStaffStepUp(action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined): MiddlewareHandler<AppEnv>;
  /** Revokes one of the person's own live staff sessions, on the record with its confirmation; false when the handle names none. */
  revokeSession(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean>;
}

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  const staffGuard = requireStaff(deps);
  const forStaff: AuthForStaff = {
    enrollOptions: (input) => enrollOptions(deps, input),
    enrollVerify: (input, ctx) => enrollVerify(deps, input, ctx),
    signInOptions: () => signInOptions(deps),
    signInVerify: (input, ctx) => signInVerify(deps, input, ctx),
    requireStaff: staffGuard,
    me: (session) => staffMe(deps, session),
    sessions: (session) => listStaffSessions(deps, session),
    keys: (session) => listStaffKeys(deps, session),
    signOut: (session, ctx) => signOutStaff(deps, session, ctx),
    stepUpOptions: (session, request) => stepUpOptions(deps, session, request),
    requireStaffStepUp: (action, target) => requireStaffStepUp(deps, action, target),
    revokeSession: (session, confirmed, ctx) => revokeStaffSession(deps, session, confirmed, ctx),
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the staff module uses. */
    forStaff,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    /** A staff session from the staff cookie, read from the database at every request (3a design, section 7). */
    requireStaff: staffGuard,
    /** A fresh confirmation by the staff session's key, bound to the action a route is about to execute (3a design, section 7). */
    requireStaffStepUp: forStaff.requireStaffStepUp,
    /** Starts the retention pass (dead codes, old sessions and staff sessions, spent enrolment links, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/passkeys/challenge.ts` (whole file)

```ts
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { STAFF_STEP_UP_CHALLENGE, stepUpBindingText } from "@korbat/contracts";
import { AuthError } from "../context";
import { sha256Hex } from "../crypto";
import type { KeyValueStore } from "../kv";
import { MINUTE } from "../limits";

/**
 * Which ceremony a challenge was issued for; a challenge answers only the ceremony it names. The staff console's two
 * (3a design, section 5) share the layout, the key, the lifetime and the used-challenge markers, so an app sign-in
 * challenge never opens the console's sign-in and a personal passkey's registration challenge never enrols a staff key.
 * The staff step-up has a layout of its own (issueStepUpChallenge below), with the same key, lifetime and markers.
 */
export type ChallengePurpose = "signin" | "register" | "reauth" | "staff_signin" | "staff_register";

/** How long a challenge is valid: the top of WebAuthn L3's recommended range for a ceremony. */
export const CHALLENGE_TTL_MS = 10 * MINUTE;

/**
 * A step-up challenge is read only while at least this much of its life is left. Its action's audit row is stamped by the
 * database after the WebAuthn check, the counter update and the waits for the account's row and the audit head, and
 * audit-verify refuses a row written at or after the challenge's expiry; such a row can never be repaired. A minute is
 * harmless under the browser's 5-minute prompt, and the expiry the challenge carries stays the full ten minutes.
 */
export const STEP_UP_READ_MARGIN_MS = MINUTE;

const VERSION = 1;
const PURPOSE_CODES: Record<ChallengePurpose, number> = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5 };

// The layout: version (1 byte), purpose (1), expiry in epoch milliseconds (8, big-endian), nonce (16), binding (16), then
// the first 16 bytes of HMAC-SHA256 over the 42 before them.
const PURPOSE_AT = 1;
const EXPIRY_AT = 2;
const NONCE_AT = 10;
const BINDING_AT = 26;
const MAC_AT = 42;
const NONCE_BYTES = 16;
const BINDING_BYTES = 16;
const MAC_BYTES = 16;
const CHALLENGE_BYTES = 58;
/** 58 bytes as unpadded base64url. */
const ENCODED_LENGTH = 78;
// The step-up layout, at the contracts' offsets, which audit-verify and the console read too: version (1 byte), purpose
// (1), expiry (8), nonce (16), the full 32-byte binding, then the first 16 bytes of HMAC-SHA256 over the 58 before them.
const STEP_UP = STAFF_STEP_UP_CHALLENGE;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The used-challenge markers in the key-value store, keyed by the challenge's hash rather than the challenge itself. */
const USED_PREFIX = "webauthn-used:";

const derivedKeys = new WeakMap<Buffer, Buffer>();

/**
 * The key challenges are sealed with: HKDF-SHA256 of AUTH_HMAC_KEY under its own label, so no other use of that key can
 * produce a valid seal. It is derived once per key buffer; the flows can ask for it on every request.
 */
export function challengeKey(authHmacKey: Buffer): Buffer {
  let key = derivedKeys.get(authHmacKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", authHmacKey, "", "korbat-webauthn-challenge", 32));
    derivedKeys.set(authHmacKey, key);
  }
  return key;
}

const invalid = () => new AuthError("passkey_invalid", 401);
const expired = () => new AuthError("challenge_expired", 400);

/**
 * The first 16 bytes of sha256 of what the challenge is bound to (a session's handle, or a staff enrolment's id), zeros
 * for one bound to nothing (the two sign-ins).
 */
function binding(boundTo: string | undefined): Buffer {
  if (boundTo === undefined) return Buffer.alloc(BINDING_BYTES);
  return createHash("sha256").update(boundTo).digest().subarray(0, BINDING_BYTES);
}

function seal(key: Buffer, signed: Buffer): Buffer {
  return createHmac("sha256", key).update(signed).digest().subarray(0, MAC_BYTES);
}

/**
 * The challenge's bytes in one layout (58 bytes for the ceremonies' challenges, 74 for a step-up's), or null for anything
 * else. Only the canonical encoding is accepted: Node's decoder ignores the spare bits of the last character, so without
 * this check several strings would name the same challenge, and each would get its own used-challenge marker.
 */
function decodeAs(challenge: string, length: number, encodedLength: number): Buffer | null {
  if (typeof challenge !== "string" || challenge.length !== encodedLength || !BASE64URL.test(challenge)) return null;
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== challenge) return null;
  return bytes;
}

const decode = (challenge: string) => decodeAs(challenge, CHALLENGE_BYTES, ENCODED_LENGTH);

/** A challenge of either layout, for spending: both keep their expiry at the same offset. */
const decodeAny = (challenge: string) => decode(challenge) ?? decodeAs(challenge, STEP_UP.bytes, STEP_UP.encodedLength);

/**
 * A stateless WebAuthn challenge: its purpose, its expiry (10 minutes from now), a random nonce and a binding, sealed with
 * an HMAC. Registration and re-authentication bind it to the session's handle, a staff registration to its enrolment's id,
 * and the two sign-ins to nothing. Handing one out stores nothing, so the unauthenticated sign-in options cannot fill the
 * key-value store.
 */
export function issueChallenge(key: Buffer, purpose: ChallengePurpose, now: Date, boundTo?: string): string {
  const bytes = Buffer.alloc(CHALLENGE_BYTES);
  bytes[0] = VERSION;
  bytes[PURPOSE_AT] = PURPOSE_CODES[purpose];
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), EXPIRY_AT);
  randomBytes(NONCE_BYTES).copy(bytes, NONCE_AT);
  binding(boundTo).copy(bytes, BINDING_AT);
  seal(key, bytes.subarray(0, MAC_AT)).copy(bytes, MAC_AT);
  return bytes.toString("base64url");
}

/**
 * Checks a challenge a ceremony's client data names before any WebAuthn verification runs: the seal first, in constant
 * time, so a forged challenge says nothing about which field failed; then the version, the purpose and the binding
 * (`passkey_invalid`), and only then the expiry (`challenge_expired`), which the app answers by starting over. Pass what
 * the challenge was issued bound to: the session's handle for registration and re-authentication, the enrolment's id for
 * a staff registration, nothing for the sign-ins. The staff flows answer this function's passkey_invalid with a staff code.
 */
export function readChallenge(key: Buffer, challenge: string, purpose: ChallengePurpose, now: Date, boundTo?: string): void {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(MAC_AT), seal(key, bytes.subarray(0, MAC_AT)))) throw invalid();
  if (bytes[0] !== VERSION || bytes[PURPOSE_AT] !== PURPOSE_CODES[purpose]) throw invalid();
  if (!bytes.subarray(BINDING_AT, MAC_AT).equals(binding(boundTo))) throw invalid();
  if (now.getTime() >= Number(bytes.readBigUInt64BE(EXPIRY_AT))) throw expired();
}

/**
 * The binding of a step-up challenge (3a design, section 7, Step-up): all 32 bytes of the sha256 of the staff session's
 * handle, a newline and the action's hash, so audit-verify and the console can recompute it from what they hold, without
 * the sealing key.
 */
function stepUpBinding(sessionHandle: string, actionHash: string): Buffer {
  return createHash("sha256").update(stepUpBindingText(sessionHandle, actionHash)).digest();
}

/**
 * A staff step-up challenge: the step-up purpose, its expiry (10 minutes from now, as every other ceremony's), a random
 * nonce and the binding of the session and the action, sealed with the same key as the other challenges. An assertion
 * made over it confirms that one action in that one session and nothing else. Handing one out stores nothing.
 */
export function issueStepUpChallenge(key: Buffer, now: Date, sessionHandle: string, actionHash: string): string {
  const bytes = Buffer.alloc(STEP_UP.bytes);
  bytes[STEP_UP.versionAt] = STEP_UP.version;
  bytes[STEP_UP.purposeAt] = STEP_UP.purpose;
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), STEP_UP.expiryAt);
  randomBytes(STEP_UP.nonceBytes).copy(bytes, STEP_UP.nonceAt);
  stepUpBinding(sessionHandle, actionHash).copy(bytes, STEP_UP.bindingAt);
  seal(key, bytes.subarray(0, STEP_UP.sealAt)).copy(bytes, STEP_UP.sealAt);
  return bytes.toString("base64url");
}

/**
 * Checks a step-up challenge as readChallenge checks the others: the seal first, in constant time; then the version, the
 * purpose and the binding of this session and this action (`passkey_invalid`); and only then the expiry
 * (`challenge_expired`), which here comes a minute early (STEP_UP_READ_MARGIN_MS), so the action's row is written before
 * it. A challenge of the other layout is refused by its length. The step-up flow answers this function's passkey_invalid
 * with staff_step_up_invalid.
 */
export function readStepUpChallenge(key: Buffer, challenge: string, now: Date, sessionHandle: string, actionHash: string): void {
  const bytes = decodeAs(challenge, STEP_UP.bytes, STEP_UP.encodedLength);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(STEP_UP.sealAt), seal(key, bytes.subarray(0, STEP_UP.sealAt)))) throw invalid();
  if (bytes[STEP_UP.versionAt] !== STEP_UP.version || bytes[STEP_UP.purposeAt] !== STEP_UP.purpose) throw invalid();
  if (!bytes.subarray(STEP_UP.bindingAt, STEP_UP.sealAt).equals(stepUpBinding(sessionHandle, actionHash))) throw invalid();
  if (now.getTime() + STEP_UP_READ_MARGIN_MS >= Number(bytes.readBigUInt64BE(STEP_UP.expiryAt))) throw expired();
}

/**
 * Makes a challenge single-use, a step-up's included; call it right after readChallenge or readStepUpChallenge, before the
 * WebAuthn verification, so a challenge stays spent whatever happens next. The marker lives for the rest of the
 * challenge's lifetime: after that the read refuses the challenge anyway. A second spend is `passkey_invalid`.
 */
export async function spendChallenge(kv: KeyValueStore, challenge: string, now: Date): Promise<void> {
  const bytes = decodeAny(challenge);
  if (!bytes) throw invalid();
  const remaining = Number(bytes.readBigUInt64BE(EXPIRY_AT)) - now.getTime();
  // Refused as readChallenge refuses it, which also keeps the store from being handed a TTL of zero or less (Redis refuses one).
  if (remaining <= 0) throw expired();
  if (!(await kv.setIfAbsent(USED_PREFIX + sha256Hex(challenge), "1", remaining))) throw invalid();
}
```

### Replace `apps/api/src/auth/passkeys/webauthn.ts` (whole file)

```ts
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { AuthError } from "../context";
import { MINUTE } from "../limits";

// This is the only file that imports @simplewebauthn/server: everything the library decides passes through here, with
// korbat's settings pinned, and every library failure leaves as passkey_invalid.

export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

/**
 * How long the browser's prompt may stay open: half the challenge's lifetime, so a modal prompt ends before its challenge
 * expires. Conditional mediation (autofill) ignores it; the app restarts that request itself.
 */
export const CEREMONY_TIMEOUT_MS = 5 * MINUTE;

/**
 * Ed25519, ES256 and RS256, pinned on the options and on the verification alike. The library's runtime default adds
 * ML-DSA (-48) on Node 24, which Node still marks experimental.
 */
export const SUPPORTED_ALGORITHMS: readonly number[] = [-8, -7, -257];

/** WebAuthn L3 caps credential ids at this many bytes and has the relying party refuse a longer one at registration; the library does not. */
export const MAX_CREDENTIAL_ID_BYTES = 1023;

/** The transports WebAuthn L3 defines, plus "cable", the older name of hybrid that some browsers still report. */
const KNOWN_TRANSPORTS = new Set(["usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"]);
const MAX_TRANSPORTS = 5;

/** The contracts' bound on clientDataJSON, applied again here for callers that did not come through them. */
const MAX_CLIENT_DATA_CHARS = 4 * 1024;
/** Well above the 78 characters of a korbat challenge and the 99 of a staff step-up's; anything longer is not one, and is not worth hashing. */
const MAX_CHALLENGE_CHARS = 128;

const invalid = () => new AuthError("passkey_invalid", 401);

/** A credential in an options list: its id as base64url and the transports it was registered with. */
export interface CredentialDescriptor {
  id: string;
  transports: string[];
}

/**
 * What a ceremony asks of user verification: "preferred" for 1c's passkeys, so security keys without a PIN still work,
 * and "required" for every staff ceremony (3a design, section 5). Verification itself never requires it: the flows read
 * the UV flag the authenticator reported, and the staff flows refuse a key without it with a code of its own.
 */
export type UserVerification = "preferred" | "required";

/** Only these two members reach the options JSON, whatever else the caller's objects carry. */
const descriptor = ({ id, transports }: CredentialDescriptor) => ({ id, transports });

/**
 * The challenge's own bytes. Given a string, the library would encode its UTF-8 text again, and the options (and so the
 * browser's client data) would carry a different string from the one korbat issued and checks.
 */
function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(Buffer.from(challenge, "base64url"));
  if (Buffer.from(bytes).toString("base64url") !== challenge) throw new Error("a WebAuthn challenge must be canonical base64url, as issueChallenge writes it");
  return bytes;
}

/**
 * Options for navigator.credentials.create: a discoverable credential (the passkey signs in without an email), user
 * verification as the caller asks (preferred unless told otherwise), no attestation, the pinned algorithms, and the
 * account's credentials listed so an authenticator that already holds one of them does not add another.
 */
export async function registrationOptions(input: {
  rp: { id: string; name: string };
  /** The account's WebAuthn user handle (never its account id), and the label the password manager shows. */
  user: { id: Uint8Array; name: string; displayName: string };
  exclude: CredentialDescriptor[];
  challenge: string;
  userVerification?: UserVerification;
  /**
   * The security-key hint, for the enrolment's "Register a security key" button only. 14.0.2 sends a hint only through
   * preferredAuthenticatorType, which also sets cross-platform attachment and so hides Windows Hello: without it, no hint.
   */
  hint?: "securityKey";
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: input.rp.name,
    rpID: input.rp.id,
    userName: input.user.name,
    userDisplayName: input.user.displayName,
    // 14.0.2 takes the user handle as bytes only; it refuses a string.
    userID: Uint8Array.from(input.user.id),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: input.exclude.map(descriptor),
    // A new object on every call: the library writes requireResidentKey, and with a hint the attachment, into the object it is given.
    authenticatorSelection: { residentKey: "required", userVerification: input.userVerification ?? "preferred" },
    supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    ...(input.hint ? { preferredAuthenticatorType: input.hint } : {}),
  });
}

/**
 * Options for navigator.credentials.get. Sign-in passes an empty allow list, so the options say nothing about any account
 * and the browser offers every passkey it holds for the RP; re-authentication lists the account's usable passkeys.
 */
export async function authenticationOptions(input: {
  rpId: string;
  allow: CredentialDescriptor[];
  challenge: string;
  userVerification?: UserVerification;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpId,
    allowCredentials: input.allow.map(descriptor),
    challenge: challengeBytes(input.challenge),
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: input.userVerification ?? "preferred",
  });
}

/** The format and statement of an attestation object, or null when it is not a CBOR map holding a text format and a statement map. */
function attestationFormat(attestationObject: string): { fmt: string; attStmt: Map<unknown, unknown> } | null {
  try {
    const decoded: unknown = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
    if (!(decoded instanceof Map)) return null;
    const fmt: unknown = decoded.get("fmt");
    const attStmt: unknown = decoded.get("attStmt");
    return typeof fmt === "string" && attStmt instanceof Map ? { fmt, attStmt } : null;
  } catch {
    return null;
  }
}

/** Known values only, each once, five at most: the library hands back whatever the client sent. */
function knownTransports(reported: unknown): string[] {
  if (!Array.isArray(reported)) return [];
  const kept: string[] = [];
  for (const transport of reported) {
    if (kept.length === MAX_TRANSPORTS) break;
    if (typeof transport === "string" && KNOWN_TRANSPORTS.has(transport) && !kept.includes(transport)) kept.push(transport);
  }
  return kept;
}

/** What korbat stores of a verified registration. */
export interface VerifiedRegistration {
  /** From the authenticator data, base64url; the library never compares it with the response's id, so the response's id is not used. */
  credentialId: string;
  /** The COSE public key as base64url, as auth.passkeys.public_key holds it. */
  publicKey: string;
  counter: number;
  transports: string[];
  aaguid: string;
  /** The BE flag: the key may be synced to the owner's other devices. */
  backupEligible: boolean;
  /** The BS flag: the key is backed up now. */
  backedUp: boolean;
  /** The UV flag. Only a passkey registered with it counts as two factors when a later sign-in is verified too. */
  userVerified: boolean;
}

/**
 * Verifies a registration response whose challenge the caller has already read and spent. The attestation format is
 * checked before the library sees the response: only `none`, or `packed` with no x5c chain (a self attestation), pass;
 * anything else is passkey_unsupported. The format comes from the client whatever the options asked for, and the library
 * fetches revocation lists, with no timeout or size limit, for the formats that carry certificates.
 */
export async function verifyRegistration(input: { response: RegistrationResponseJSON; expectedChallenge: string; origins: string[]; rpId: string }): Promise<VerifiedRegistration> {
  const format = attestationFormat(input.response.response.attestationObject);
  if (!format) throw invalid();
  if (!(format.fmt === "none" || (format.fmt === "packed" && !format.attStmt.has("x5c")))) throw new AuthError("passkey_unsupported", 400);

  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      // User verification is never required here, so security keys without a PIN still work for passkeys; the flows read
      // the UV flag instead to decide what the passkey proves, and the staff flows refuse a key without it by its own code.
      requireUserVerification: false,
      supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const { credential, aaguid, credentialDeviceType, credentialBackedUp, userVerified } = result.registrationInfo;
  if (Buffer.from(credential.id, "base64url").length > MAX_CREDENTIAL_ID_BYTES) throw invalid();
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: knownTransports(credential.transports),
    aaguid,
    backupEligible: credentialDeviceType === "multiDevice",
    backedUp: credentialBackedUp,
    userVerified,
  };
}

/** What an assertion proved: the counter to compare with the stored one, and the flags. */
export interface VerifiedAuthentication {
  newCounter: number;
  userVerified: boolean;
  backedUp: boolean;
  /** The BE flag as this assertion reported it: the staff flows refuse a key that reports it at any use (3a design, section 2). */
  backupEligible: boolean;
}

/**
 * Verifies an assertion against a stored passkey, whose challenge the caller has already read and spent. The library is
 * given a stored counter of 0, so it never refuses on a counter: it would do that before checking the signature, and an
 * unsigned response could then pass for a clone. The caller applies isCounterRegression once the signature has checked.
 */
export async function verifyAuthentication(input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  origins: string[];
  rpId: string;
  /** The stored passkey: its credential id and COSE public key as base64url, and its transports. */
  credential: { id: string; publicKey: string; transports: string[] };
}): Promise<VerifiedAuthentication> {
  let result: VerifiedAuthenticationResponse;
  try {
    result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.origins,
      expectedRPID: input.rpId,
      credential: { id: input.credential.id, publicKey: isoBase64URL.toBuffer(input.credential.publicKey), counter: 0, transports: input.credential.transports },
      requireUserVerification: false,
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const info = result.authenticationInfo;
  return { newCounter: info.newCounter, userVerified: info.userVerified, backedUp: info.credentialBackedUp, backupEligible: info.credentialDeviceType === "multiDevice" };
}

/** The three members of an assertion an audit row stores in `step_up`, base64url exactly as the browser sent them. */
export interface RecordedAssertion {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

/**
 * Checks a step-up assertion the audit log recorded (3a design, section 7, Command line), for audit-verify, which holds no
 * server secret: the client data is a webauthn.get from `origin`, the authenticator data names `rpId` with user presence
 * and verification, and the signature verifies with the key's public key. The challenge is not compared here: without the
 * sealing key, audit-verify reads its binding and expiry from the step-up layout itself. The counter is never judged (0 is
 * given to the library, as above). True when the library verifies it; false for anything else, a malformed member included.
 */
export async function verifyRecordedAssertion(input: { assertion: RecordedAssertion; credential: { id: string; publicKey: string }; origin: string; rpId: string }): Promise<boolean> {
  try {
    const result = await verifyAuthenticationResponse({
      // The response's id is the key's own: the row names its key, and the library only checks that id and rawId agree.
      response: {
        id: input.credential.id,
        rawId: input.credential.id,
        type: "public-key",
        response: { authenticatorData: input.assertion.authenticatorData, clientDataJSON: input.assertion.clientDataJSON, signature: input.assertion.signature },
        clientExtensionResults: {},
      },
      expectedChallenge: () => true,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      credential: { id: input.credential.id, publicKey: isoBase64URL.toBuffer(input.credential.publicKey), counter: 0 },
      requireUserVerification: true,
    });
    return result.verified;
  } catch {
    return false;
  }
}

/**
 * WebAuthn L3, section 6.1.1: a signature counter that did not move past the stored one suggests a copy of the key.
 * Two zeros are not a regression: Apple passkeys, like other synced ones, always report 0.
 */
export function isCounterRegression(stored: number, next: number): boolean {
  return (next > 0 || stored > 0) && next <= stored;
}

/**
 * The challenge a ceremony's client data names. The flows run readChallenge and spendChallenge on it before any
 * verification, so a response to a forged, foreign or spent challenge never reaches the library.
 */
export function readResponseChallenge(response: { response: { clientDataJSON: string } }): string {
  const { clientDataJSON } = response.response;
  if (typeof clientDataJSON !== "string" || clientDataJSON.length > MAX_CLIENT_DATA_CHARS) throw invalid();
  let challenge: unknown;
  try {
    const clientData: unknown = decodeClientDataJSON(clientDataJSON);
    challenge = typeof clientData === "object" && clientData !== null ? (clientData as { challenge?: unknown }).challenge : undefined;
  } catch {
    throw invalid();
  }
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.length > MAX_CHALLENGE_CHARS) throw invalid();
  return challenge;
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  authEventType,
  authEvents,
  devices,
  emailCodePurpose,
  emailCodes,
  passkeys,
  sessions,
  staffEnrollments,
  staffKeys,
  staffSessions,
  userRole,
  users,
  type Db,
} from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "./admin";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

/** What the lockdown's transaction is told (1c design, sections 2 and 7.6); the flow works it out from the caller's anchor. */
export interface LockDownInput {
  /** The flows' clock, for the revocations and the password's change time. */
  now: Date;
  /** How far back the lockdown reaches: passkeys created at or after this go, and two-factor enabled at or after it is turned off. */
  since: Date;
  /** Passkeys to remove whatever their age: the one that signed in, or the one a link is about. */
  passkeyIds: readonly string[];
  /** The caller's event, recorded in the same transaction with what the lockdown did added to its metadata. */
  event: { type: AuthEventType; deviceId: string | null; ipHash: string | null; metadata: Record<string, unknown> };
}

/** What a lockdown did: the ids of the sessions it revoked, for the cache tombstones, the passkeys it removed, and whether it turned two-factor off. */
export interface LockDownOutcome {
  sessionIds: string[];
  passkeysRemoved: string[];
  totpCleared: boolean;
}

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

/** A staff enrolment found by its token, with what the enrolment flow checks of its account (3a design, section 7). */
export interface StaffEnrollmentRow {
  id: string;
  userId: string;
  origin: string;
  rpId: string;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  onboardedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What the enrolment flow stores of a verified staff key; auth.add_staff_key copies the origin and relying party ID from the enrolment. */
export interface NewStaffKey {
  userId: string;
  enrollmentId: string;
  /** The link's token itself: the function hashes it, so a hash read from the table spends nothing. */
  token: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  aaguid: string;
  requestId: string;
}

/** What addStaffKey answers: the new key's id, or which of auth.add_staff_key's re-checks refused it. */
export type AddStaffKeyOutcome = { ok: true; keyId: string } | { ok: false; reason: "enrollment_invalid" | "limit" };

/** A staff key as the console's sign-in finds it by its credential id, with what the flow checks of its account. */
export interface StaffKeyForSignIn {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What a staff sign-in's transaction writes (3a design, section 7, Sign-in): the key's use, the session, its event and its audit row. */
export interface NewStaffSession {
  /** sha256 of the token; the token itself is never stored. */
  id: string;
  userId: string;
  keyId: string;
  /** The counter the verified assertion reported, which the key's row takes only if it moved forward. */
  newCounter: number;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
  ipHash: string | null;
  requestId: string;
}

/** A live staff session as requireStaff reads it, with its account's role, in one statement joined to its key and its account. */
export interface StaffSessionRow {
  id: string;
  handle: string;
  userId: string;
  keyId: string;
  role: UserRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
}

/**
 * A revocation of staff keys in one auth transaction (3a design, section 7): `staff.js revoke` with one key or `all`, and the
 * counter rule's revocation of the key that went backwards, which also marks it suspect and records its own event. The
 * account is named by its id (the counter rule knows it) or by its address (the command line).
 */
export interface StaffKeyRevocation {
  account: { id: string } | { email: string };
  key: string | "all";
  suspect: boolean;
  /**
   * Where it came from, as the events and audit rows record it: the command line, or the counter rule at a sign-in or a
   * step-up. The command line also waits at most 10 seconds for a lock.
   */
  via: "cli" | "sign_in" | "step_up";
  actorId: string;
  now: Date;
  requestId?: string | null;
}

/** What a revocation did, for the command line's report and the mail; or why it found nothing to act on. */
export type StaffKeysRevoked =
  | {
      ok: true;
      userId: string;
      /** The account's address as stored, which the mail goes to. */
      email: string;
      /** The keys revoked now, oldest first, each with how many of its staff sessions were revoked now. */
      keys: { id: string; name: string; sessionsRevoked: number }[];
      staffSessionsRevoked: number;
      enrollmentsCancelled: number;
      /** For one key named by the command line: when it was revoked before, in which case nothing changed. */
      alreadyRevokedAt: Date | null;
    }
  | { ok: false; reason: "no_account" | "no_key" };

/** The staff key a staff session was opened with, as its step-up reads it: the credential to verify against and its name for a suspect key's mail. */
export interface StaffKeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
}

/**
 * A staff session's revocation confirmed by a step-up (3a design, section 7, Sessions and keys): who confirms it (the
 * account, its session and the key that signed) and what the audit row stores of the confirmation.
 */
export interface ConfirmedStaffSessionRevocation {
  userId: string;
  /** The confirming session's handle, which the step-up's challenge was bound to. */
  staffSession: string;
  keyId: string;
  /** The handle of the session to revoke. */
  handle: string;
  actionHash: string;
  params: Record<string, unknown>;
  stepUp: { authenticatorData: string; clientDataJSON: string; signature: string };
  now: Date;
  ipHash: string | null;
  requestId: string;
}

/** A role change as it committed: what it revoked and deleted, for the cache tombstones, the command's report and the mail. */
export interface RoleChange {
  userId: string;
  /** The account's address as stored, which the staff_keys_revoked mail goes to. */
  email: string;
  previousRole: UserRole;
  /** The revoked app sessions' ids, for the cache tombstones. */
  sessionIds: string[];
  staffSessionsRevoked: number;
  enrollmentsDeleted: number;
  /** The staff keys revoked by a change to user, oldest first. */
  keysRevoked: { id: string; name: string }[];
}

export interface SessionListRow {
  /** The hash of the session's token, which its cached copy is keyed by; it changes when the token rotates and is never shown to a client. */
  id: string;
  /** The session's id for life: what the list shows, and what the targeted revoke takes. */
  handle: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    /**
     * A role change (3a design, section 7) in one transaction: the account's row is locked first, FOR NO KEY UPDATE (the
     * lock the role's update would take, and the one every writer of staff rows takes first, so none of them can wait on
     * another in a circle); the role is set, every session and every staff session revoked and every unused enrolment link
     * deleted, so the new role applies at once and no link issued before enrols anything. A change to user also revokes
     * every staff key, with a staff_key_revoked event each: a person made staff again enrols new keys. Last, through
     * auth.append_audit, each revocation's audit row and then the role_granted row, which hold the audit chain's head until
     * the commit, so the change and its record commit together or not at all. Only the command line calls this, and it
     * waits at most 10 seconds for a lock: an API that holds the head or the row open cannot stall it for longer, and one
     * that times out has changed nothing. The cache tombstones and the mail are not the database's to write, so the caller
     * does them after the commit with what this answers; undefined when no live account has the address.
     */
    async changeRole(email: string, role: UserRole, audit: { actorId: string; now: Date }): Promise<RoleChange | undefined> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return undefined;
        await tx.update(users).set({ role }).where(eq(users.id, account.id));
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: audit.now })
          .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        const staff = await revokeStaffAccess(tx, account.id, audit.now, { keys: role === "user", enrollments: "unused", via: "role_change" });
        await appendKeyRevocations(tx, audit.actorId, staff, "role_change");
        await appendAudit(tx, {
          actorId: audit.actorId,
          action: "role_granted",
          targetType: "user",
          targetId: account.id,
          // A role change deletes open links only, so every link it deleted was one it cancelled.
          metadata: { from: account.role, to: role, via: "cli", staffSessionsRevoked: staff.staffSessionsRevoked, enrollmentsDeleted: staff.enrollmentsCancelled },
        });
        return {
          userId: account.id,
          email: account.email,
          previousRole: account.role,
          sessionIds: revoked.map((row) => row.id),
          staffSessionsRevoked: staff.staffSessionsRevoked,
          enrollmentsDeleted: staff.enrollmentsCancelled,
          keysRevoked: staff.keys.map(({ id, name }) => ({ id, name })),
        };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, the account's staff
     * keys and staff sessions revoked, its enrolment links deleted and its keys blanked (3a design, section 7), and the
     * account_deleted event appended; last, the audit rows of the staff side, with the account as their actor, since its
     * owner asked for the deletion. Either all of it lands or none of it does, so a failure leaves a live account with its
     * sessions, never a deleted one with sessions, devices, passkeys or staff keys that nothing would remove. Answers the
     * ids of the sessions it revoked, for the cache tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const taken = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        await appendTakeDownAudit(tx, userId, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, the WebAuthn user handle and the staff rows), for
     * a row marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The account_deleted event is not appended
     * again: the confirmation that recorded it is the only one there was. The staff side's audit rows are written, last,
     * for what this run revoked, with the server as their actor: the purge job finishes the take-down, no person.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        // The account's row first, as every writer of staff rows takes it (3a design, section 7).
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)))
          .for("no key update");
        if (!row) return [];
        const taken = await takeDownRows(tx, userId, now);
        await appendTakeDownAudit(tx, SYSTEM_ACTOR_ID, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ lockdown

    /**
     * The lockdown (1c design, sections 2 and 7.6) in one transaction, as takeDown is one: every live session
     * revoked, every device revoked (so the next sign-in on any of them counts as a new device), the password
     * cleared as setPasswordHash clears it, the passkeys in reach removed, two-factor turned off as disableTotp
     * does when it was enabled at or after `since`, and the caller's event appended with what was done. Either
     * all of it lands or none of it does: the link that started it is spent by then, so a lockdown that stopped
     * halfway could not be asked for again, and would be on no record. The user row is locked first, as takeDown
     * and a registration take it first, so none of the three can wait on another in a circle, and two-factor is
     * read from the locked row. Answers the ids of the sessions it revoked, for the cache tombstones, which are
     * not the database's to write.
     */
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      return db.transaction(async (tx) => {
        // An account that is gone has no two-factor to clear; its rows, if any are left, are still locked down below.
        const [locked] = await tx
          .select({ totpEnabledAt: users.totpEnabledAt })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for("update");
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.update(devices).set({ revokedAt: input.now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        // The user's passkeys from `since` on, plus any of theirs the caller names; a named passkey of another account is not the caller's to remove and stays.
        const reach = input.passkeyIds.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.passkeyIds])) : gte(passkeys.createdAt, input.since);
        const removed = await tx
          .delete(passkeys)
          .where(and(eq(passkeys.userId, userId), reach))
          .returning({ id: passkeys.id });
        const totpCleared = locked !== undefined && locked.totpEnabledAt !== null && locked.totpEnabledAt.getTime() >= input.since.getTime();
        await tx
          .update(users)
          .set({
            passwordHash: null,
            passwordChangedAt: input.now,
            failedLogins: 0,
            lockedUntil: null,
            ...(totpCleared ? { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] } : {}),
          })
          .where(eq(users.id, userId));
        const passkeysRemoved = removed.map((row) => row.id);
        await tx.insert(authEvents).values({
          userId,
          type: input.event.type,
          deviceId: input.event.deviceId,
          ipHash: input.event.ipHash,
          metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true },
        });
        return { sessionIds: revoked.map((row) => row.id), passkeysRemoved, totpCleared };
      });
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /**
     * Revokes one session of this user, named by its handle: the id a rotation keeps, so a session listed before its
     * token rotated is still found. Answers the row's id as it is now, which its cached copy is keyed by; undefined
     * when the session does not belong to the user or is already revoked.
     */
    async revokeSession(handle: string, userId: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.handle, handle), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return row?.id;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          handle: sessions.handle,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    // ------------------------------------------------------------ staff keys and enrolments (3a design, section 7)

    /**
     * The enrolment whose token hashes to `tokenHash`, used or not, expired or not, with what the enrolment flow checks of
     * its account: whether it is live, staff and has a handle, and its WebAuthn user handle. Undefined for an unknown
     * token. The flow decides; auth.add_staff_key decides again under the account's lock.
     */
    async findStaffEnrollment(tokenHash: string): Promise<StaffEnrollmentRow | undefined> {
      const [row] = await db
        .select({
          id: staffEnrollments.id,
          userId: staffEnrollments.userId,
          origin: staffEnrollments.origin,
          rpId: staffEnrollments.rpId,
          expiresAt: staffEnrollments.expiresAt,
          usedAt: staffEnrollments.usedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          onboardedAt: users.onboardedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffEnrollments)
        .innerJoin(users, eq(users.id, staffEnrollments.userId))
        .where(eq(staffEnrollments.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    /**
     * The account's live staff keys as an options list excludes them: an authenticator keeps one discoverable credential
     * per relying party and user handle, so a revoked key is left out and the same security key can be enrolled again.
     */
    async listLiveStaffKeys(userId: string): Promise<{ credentialId: string; transports: string[] }[]> {
      return db
        .select({ credentialId: staffKeys.credentialId, transports: staffKeys.transports })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(staffKeys.createdAt, staffKeys.id);
    },

    /** One staff key as the console shows it: never its public key, credential id or AAGUID. */
    async findStaffKey(id: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null } | undefined> {
      const [row] = await db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The enrolment's write, in one transaction on the auth role (3a design, section 7): the account's row locked first,
     * FOR NO KEY UPDATE, so a role change or take-down that holds it either committed before (and deleted the link, which
     * the function then does not find) or waits until this commits; the staff_key_added event; and last
     * auth.add_staff_key, which re-checks under that lock that the link is unused and unexpired and the account live,
     * staff, with a handle and fewer than five live keys, then spends the link, stores the key with the origin and relying
     * party ID the link recorded and writes its audit row, which holds the chain's head until the commit. A refusal by the
     * function rolls the event back with it. A credential id already held raises the driver's unique violation, which the
     * flow reports.
     */
    async addStaffKey(input: NewStaffKey): Promise<AddStaffKeyOutcome> {
      try {
        return await db.transaction(async (tx) => {
          await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("no key update");
          await tx.insert(authEvents).values({ userId: input.userId, type: "staff_key_added", metadata: { enrollmentId: input.enrollmentId } });
          // Each transport as its own parameter: an empty list is an empty array.
          const transports = sql`array[${sql.join(input.transports.map((t) => sql`${t}`), sql`, `)}]::text[]`;
          const [row] = await tx.execute<{ id: string }>(
            sql`select auth.add_staff_key(${input.token}::text, ${input.credentialId}::text, ${input.publicKey}::text, ${input.counter}::bigint,
              ${transports}, ${input.name}::text, ${input.aaguid}::uuid, ${input.requestId}::text) as id`,
          );
          return { ok: true as const, keyId: row!.id };
        });
      } catch (err) {
        // The function raises its refusal's staff code as the message.
        const refusal = raisedMessage(err);
        if (refusal === "staff_enrollment_invalid") return { ok: false, reason: "enrollment_invalid" };
        if (refusal === "staff_key_limit") return { ok: false, reason: "limit" };
        throw err;
      }
    },

    // ------------------------------------------------------------ staff sessions

    /** A staff key by its credential id, revoked or not, with its account's address, role, deletion and user handle; the sign-in decides. */
    async findStaffKeyForSignIn(credentialId: string): Promise<StaffKeyForSignIn | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffKeys)
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(eq(staffKeys.credentialId, credentialId))
        .limit(1);
      return row;
    },

    /**
     * A staff sign-in's write, in one transaction (3a design, section 7): first 1c's counter rule as one conditional update
     * of the key, which records its use only while it is live and its counter moved forward (two zeros pass, as some
     * authenticators always report 0); then the session, its staff_sign_in event and last its audit row, which holds the
     * chain's head until the commit. Null when the update matched no row: a counter that went backwards, or a key revoked
     * since the flow read it, which the caller tells apart. The update holds the key's row until the commit, so a
     * revocation waiting for it then also finds the session this opened.
     */
    async openStaffSession(input: NewStaffSession): Promise<{ handle: string } | null> {
      return db.transaction(async (tx) => {
        if (!(await recordStaffKeyUse(tx, input))) return null;
        const [session] = await tx
          .insert(staffSessions)
          .values({
            id: input.id,
            userId: input.userId,
            keyId: input.keyId,
            createdAt: input.now,
            lastUsedAt: input.now,
            idleExpiresAt: input.idleExpiresAt,
            absoluteExpiresAt: input.absoluteExpiresAt,
            browser: input.browser,
          })
          .returning({ handle: staffSessions.handle });
        const handle = session!.handle;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_sign_in", ipHash: input.ipHash, metadata: { keyId: input.keyId, handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_sign_in",
          targetType: "staff_session",
          targetId: handle,
          staffSession: handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return { handle };
      });
    },

    /**
     * A staff session by its token's hash, read from the database on every request, never cached (3a design, section 7):
     * one indexed read joined to its key and its account. It counts only while it is unrevoked, has started (a created_at
     * later than now is a row written behind the flows' back) and is before both its ends, its key unrevoked and its account
     * live and still staff, so a revocation, a demotion, a deletion or a suspect key ends it at its next request with no
     * tombstone. With `slideTo` (a request its person's action started) the same statement moves last_used_at to now and the
     * idle end to `slideTo`, never past the absolute end; without, nothing moves.
     */
    async resolveStaffSession(id: string, now: Date, slideTo: Date | null): Promise<StaffSessionRow | undefined> {
      const live = and(
        eq(staffSessions.id, id),
        isNull(staffSessions.revokedAt),
        lte(staffSessions.createdAt, now),
        gt(staffSessions.idleExpiresAt, now),
        gt(staffSessions.absoluteExpiresAt, now),
        isNull(staffKeys.revokedAt),
        isNull(users.deletedAt),
        ne(users.role, "user"),
      );
      const columns = {
        id: staffSessions.id,
        handle: staffSessions.handle,
        userId: staffSessions.userId,
        keyId: staffSessions.keyId,
        role: users.role,
        createdAt: staffSessions.createdAt,
        lastUsedAt: staffSessions.lastUsedAt,
        idleExpiresAt: staffSessions.idleExpiresAt,
        absoluteExpiresAt: staffSessions.absoluteExpiresAt,
        browser: staffSessions.browser,
      };
      if (slideTo === null) {
        const [row] = await db
          .select(columns)
          .from(staffSessions)
          .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
          .innerJoin(users, eq(users.id, staffSessions.userId))
          .where(live)
          .limit(1);
        return row;
      }
      const [row] = await db
        .update(staffSessions)
        // least() on the row's own absolute end, so the idle end never passes it, as the table's check also requires.
        .set({ lastUsedAt: now, idleExpiresAt: sql`least(${slideTo.toISOString()}::timestamptz, ${staffSessions.absoluteExpiresAt})` })
        .from(staffKeys)
        // A join in UPDATE ... FROM cannot name the updated table, so the account is reached through the key, whose owner
        // the sessions' foreign key on (key_id, user_id) makes the session's account.
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(and(eq(staffKeys.id, staffSessions.keyId), live))
        .returning(columns);
      return row;
    },

    /** The account's live staff sessions, the same tests as resolveStaffSession's, most recently used first. */
    async listStaffSessions(userId: string, now: Date): Promise<{ handle: string; browser: string; createdAt: Date; lastUsedAt: Date }[]> {
      return db
        .select({ handle: staffSessions.handle, browser: staffSessions.browser, createdAt: staffSessions.createdAt, lastUsedAt: staffSessions.lastUsedAt })
        .from(staffSessions)
        .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
        .where(
          and(
            eq(staffSessions.userId, userId),
            isNull(staffSessions.revokedAt),
            lte(staffSessions.createdAt, now),
            gt(staffSessions.idleExpiresAt, now),
            gt(staffSessions.absoluteExpiresAt, now),
            isNull(staffKeys.revokedAt),
          ),
        )
        .orderBy(desc(staffSessions.lastUsedAt), desc(staffSessions.createdAt));
    },

    /** The account's live staff keys as the console lists them, oldest first: never a public key, a credential id or an AAGUID. */
    async listStaffKeyViews(userId: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]> {
      return db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    },

    /**
     * A sign-out (3a design, section 7) in one transaction: the session revoked, if it still is live, then its
     * staff_signed_out event and last its audit row. False when another request ended it first, which writes nothing.
     */
    async endStaffSession(input: { id: string; userId: string; keyId: string; now: Date; ipHash: string | null; requestId: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [ended] = await tx
          .update(staffSessions)
          .set({ revokedAt: input.now })
          .where(and(eq(staffSessions.id, input.id), eq(staffSessions.userId, input.userId), isNull(staffSessions.revokedAt)))
          .returning({ handle: staffSessions.handle });
        if (!ended) return false;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_signed_out", ipHash: input.ipHash, metadata: { handle: ended.handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_signed_out",
          targetType: "staff_session",
          targetId: ended.handle,
          staffSession: ended.handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return true;
      });
    },

    /** The staff key a step-up confirms with, revoked or not, by its id; the step-up decides. */
    async findStaffKeyCredential(id: string): Promise<StaffKeyCredential | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
        })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The counter rule at a step-up (3a design, section 7), as at sign-in: the key's use is recorded only while it is live
     * and its counter moved forward. False when the update matched no row: a counter that went backwards, or a key
     * revoked since the step-up read it, which the caller hands to the counter rule's revocation.
     */
    async recordStaffKeyUse(input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
      return recordStaffKeyUse(db, input);
    },

    /**
     * Revokes one of the account's own live staff sessions, confirmed by a step-up, in one transaction on the auth role
     * (3a design, section 7). The account's row is locked first, FOR NO KEY UPDATE, as every revocation takes it, so a
     * revocation of the confirming key, a demotion or a take-down either committed before (and this refuses: the session
     * that confirmed has ended) or waits until this commits. Then the session, only where revoked_at is still null and
     * before both its ends, and only if it is the account's own; its staff_session_revoked event; and last its audit row,
     * through auth.append_audit, with the action's hash, its params in the metadata, the key and the assertion, which
     * audit-verify checks. "ended" when the confirming key or account no longer opens anything, "not_found" when the
     * handle names no live session of the account; neither writes anything.
     */
    async revokeConfirmedStaffSession(input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found"> {
      return db.transaction(async (tx) => {
        const [account] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt), ne(users.role, "user")))
          .limit(1)
          .for("no key update");
        if (!account) return "ended";
        const [key] = await tx
          .select({ id: staffKeys.id })
          .from(staffKeys)
          .where(and(eq(staffKeys.id, input.keyId), eq(staffKeys.userId, input.userId), isNull(staffKeys.revokedAt)));
        if (!key) return "ended";
        const [revoked] = await tx
          .update(staffSessions)
          .set({ revokedAt: input.now })
          .where(
            and(
              eq(staffSessions.handle, input.handle),
              eq(staffSessions.userId, input.userId),
              isNull(staffSessions.revokedAt),
              gt(staffSessions.idleExpiresAt, input.now),
              gt(staffSessions.absoluteExpiresAt, input.now),
            ),
          )
          .returning({ handle: staffSessions.handle });
        if (!revoked) return "not_found";
        // The account's own log names the session that ended and the one that ended it.
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_session_revoked", ipHash: input.ipHash, metadata: { handle: revoked.handle, by: input.staffSession } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_session_revoked",
          targetType: "staff_session",
          targetId: revoked.handle,
          staffSession: input.staffSession,
          keyId: input.keyId,
          actionHash: input.actionHash,
          stepUp: input.stepUp,
          metadata: { params: input.params },
          requestId: input.requestId,
        });
        return "revoked";
      });
    },

    /**
     * Revokes staff keys in one transaction on the auth role (3a design, section 7): `staff.js revoke <email> <key id>` and
     * `revoke <email> all`, and the counter rule's revocation, which is the same routine with suspect_at set as well and the
     * regression's own event. The account's row is locked first, FOR NO KEY UPDATE, as every writer of staff rows takes it.
     * Then the keys (one, or every live one), each only where revoked_at is still null, since a set one is never changed;
     * then every staff session they opened (for `all`, every staff session of the account), after the keys, so a session a
     * sign-in opened while this waited for a key's row is found too; for `all`, the unused enrolment links; an event per key;
     * and last the audit rows, a key's revocation each and, when a link went, one staff_enrollments_cancelled row, so it
     * never changes the database without a row. The command line waits at most 10 seconds for a lock.
     */
    async revokeStaffKeys(input: StaffKeyRevocation): Promise<StaffKeysRevoked> {
      return db.transaction(async (tx): Promise<StaffKeysRevoked> => {
        if (input.via === "cli") await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and("id" in input.account ? eq(users.id, input.account.id) : sql`lower(${users.email}) = lower(${input.account.email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return { ok: false, reason: "no_account" };
        let alreadyRevokedAt: Date | null = null;
        if (input.key !== "all") {
          // Another account's key and an unknown one are alike: neither is this account's to revoke.
          const [key] = await tx
            .select({ revokedAt: staffKeys.revokedAt })
            .from(staffKeys)
            .where(and(eq(staffKeys.id, input.key), eq(staffKeys.userId, account.id)));
          if (!key) return { ok: false, reason: "no_key" };
          alreadyRevokedAt = key.revokedAt;
        }
        const revoked = await tx
          .update(staffKeys)
          .set(input.suspect ? { revokedAt: input.now, suspectAt: input.now } : { revokedAt: input.now })
          .where(and(eq(staffKeys.userId, account.id), input.key === "all" ? undefined : eq(staffKeys.id, input.key), isNull(staffKeys.revokedAt)))
          .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
        // An update answers in no set order; the events, rows and mail list the keys oldest first.
        revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
        const keyIds = revoked.map((key) => key.id);
        const sessionsOf = input.key === "all" ? eq(staffSessions.userId, account.id) : keyIds.length > 0 ? inArray(staffSessions.keyId, keyIds) : null;
        const ended =
          sessionsOf === null
            ? []
            : await tx
                .update(staffSessions)
                .set({ revokedAt: input.now })
                .where(and(sessionsOf, isNull(staffSessions.revokedAt)))
                .returning({ keyId: staffSessions.keyId });
        const enrollmentsCancelled =
          input.key === "all"
            ? (
                await tx
                  .delete(staffEnrollments)
                  .where(and(eq(staffEnrollments.userId, account.id), isNull(staffEnrollments.usedAt)))
                  .returning({ id: staffEnrollments.id })
              ).length
            : 0;
        const action = input.suspect ? "staff_key_counter_regression" : "staff_key_revoked";
        const keys = revoked.map((key) => ({ id: key.id, name: key.name, sessionsRevoked: ended.filter((session) => session.keyId === key.id).length }));
        for (const key of keys) {
          // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
          await tx.insert(authEvents).values({ userId: account.id, type: action, metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via } });
        }
        for (const key of keys) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action,
            targetType: "staff_key",
            targetId: key.id,
            metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        if (enrollmentsCancelled > 0) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action: "staff_enrollments_cancelled",
            targetType: "user",
            targetId: account.id,
            metadata: { count: enrollmentsCancelled, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        return { ok: true, userId: account.id, email: account.email, keys, staffSessionsRevoked: ended.length, enrollmentsCancelled, alreadyRevokedAt };
      });
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /**
     * Staff sessions revoked or expired before `before` (3a design, section 7). A live one is never touched: both its ends
     * lie ahead. The audit rows that name a session keep its handle, which needs no row.
     */
    async purgeStaffSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(staffSessions)
        .where(
          or(
            and(isNotNull(staffSessions.revokedAt), lt(staffSessions.revokedAt, before)),
            lt(staffSessions.idleExpiresAt, before),
            lt(staffSessions.absoluteExpiresAt, before),
          ),
        )
        .returning({ id: staffSessions.id });
      return rows.length;
    },

    /** Enrolment links used or expired before `before`, which can enrol nothing more; one that still can is cancelled only by name. */
    async purgeStaffEnrollments(before: Date): Promise<number> {
      const rows = await db
        .delete(staffEnrollments)
        .where(or(and(isNotNull(staffEnrollments.usedAt), lt(staffEnrollments.usedAt, before)), lt(staffEnrollments.expiresAt, before)))
        .returning({ id: staffEnrollments.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/** The auth side's actions in the audit log: the only ones auth.append_audit writes (migration 0012). */
type AuthAuditAction =
  | "staff_key_revoked"
  | "staff_key_counter_regression"
  | "staff_sign_in"
  | "staff_signed_out"
  | "staff_session_revoked"
  | "staff_enrollments_cancelled"
  | "role_granted";

/** One auth-side row of the audit log. The trigger sets its id, time, place and hashes. */
interface AuthAuditRow {
  actorId: string;
  action: AuthAuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  staffSession?: string | null;
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  requestId?: string | null;
}

/**
 * Writes an auth-side row of the audit log in the caller's transaction, through auth.append_audit: the auth role holds
 * nothing in the public schema, and the function, which the migrator owns, writes only the auth side's actions (3a design,
 * section 6). It must be the transaction's last statement: the row holds the chain's head until the commit, so nothing that
 * can wait may run after it. Answers the row's place in the chain.
 */
async function appendAudit(tx: Tx, row: AuthAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so postgres.js sends them exactly as serialised here.
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  const [written] = await tx.execute<{ place: string }>(
    sql`select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
      ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
      ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text)::text as place`,
  );
  return Number(written!.place);
}

/**
 * 1c's counter rule as one conditional update of a staff key (3a design, section 7), at a sign-in in the session's
 * transaction and at a step-up on its own: the key's use and counter are recorded only while it is the account's, live, and
 * its counter moved forward (two zeros pass, as some authenticators always report 0). False when no row matched. The
 * update holds the key's row until the commit, so a revocation waiting for it then also finds what this transaction did.
 */
async function recordStaffKeyUse(q: Pick<Db, "update">, input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
  const claimed = await q
    .update(staffKeys)
    .set({ counter: input.newCounter, lastUsedAt: input.now })
    .where(
      and(
        eq(staffKeys.id, input.keyId),
        eq(staffKeys.userId, input.userId),
        isNull(staffKeys.revokedAt),
        sql`((${input.newCounter} = 0 and ${staffKeys.counter} = 0) or ${input.newCounter} > ${staffKeys.counter})`,
      ),
    )
    .returning({ id: staffKeys.id });
  return claimed.length > 0;
}

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/** The message of an exception a PL/pgSQL function raised (SQLSTATE P0001), however deeply the driver wrapped it; null for anything else. */
function raisedMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** What revoking an account's staff access did, for the auth events already written, the audit rows and the mail. */
interface StaffRevocation {
  /** Each key revoked now, oldest first, with how many of its staff sessions were revoked now. */
  keys: { id: string; name: string; sessionsRevoked: number }[];
  staffSessionsRevoked: number;
  /**
   * The open enrolment links (never used) deleted now: the deletions that end something, and the count the record carries.
   * A spent link deleted with them at a take-down is not counted, since it could enrol nothing more and nothing was cancelled.
   */
  enrollmentsCancelled: number;
}

/**
 * Ends an account's staff access inside the caller's transaction, which has locked the account's row first (3a design,
 * section 7): every staff session not yet revoked is revoked, the enrolment links deleted (the unused ones, or every one
 * at a take-down), and when `keys` is set every live staff key revoked, with a staff_key_revoked event each. A revocation
 * sets revoked_at only where it is still null, since a set one is never changed. Writes no audit row: the caller writes
 * those last, after its own statements.
 */
async function revokeStaffAccess(
  tx: Tx,
  userId: string,
  now: Date,
  options: { keys: boolean; enrollments: "unused" | "all"; via: "role_change" | "take_down" },
): Promise<StaffRevocation> {
  const ended = await tx
    .update(staffSessions)
    .set({ revokedAt: now })
    .where(and(eq(staffSessions.userId, userId), isNull(staffSessions.revokedAt)))
    .returning({ keyId: staffSessions.keyId });
  const deleted = await tx
    .delete(staffEnrollments)
    .where(and(eq(staffEnrollments.userId, userId), options.enrollments === "unused" ? isNull(staffEnrollments.usedAt) : undefined))
    .returning({ usedAt: staffEnrollments.usedAt });
  const keys: StaffRevocation["keys"] = [];
  if (options.keys) {
    const revoked = await tx
      .update(staffKeys)
      .set({ revokedAt: now })
      .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
      .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
    // An update answers in no set order; the events, rows and mail list the keys oldest first.
    revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const key of revoked) {
      const sessionsRevoked = ended.filter((session) => session.keyId === key.id).length;
      keys.push({ id: key.id, name: key.name, sessionsRevoked });
      // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
      await tx.insert(authEvents).values({ userId, type: "staff_key_revoked", metadata: { keyId: key.id, sessionsRevoked, via: options.via } });
    }
  }
  return { keys, staffSessionsRevoked: ended.length, enrollmentsCancelled: deleted.filter((link) => link.usedAt === null).length };
}

/** The audit row of each staff key a revocation revoked, in the order of its events; among the caller's last statements. */
async function appendKeyRevocations(tx: Tx, actorId: string, revocation: StaffRevocation, via: "role_change" | "take_down"): Promise<void> {
  for (const key of revocation.keys) {
    await appendAudit(tx, {
      actorId,
      action: "staff_key_revoked",
      targetType: "staff_key",
      targetId: key.id,
      metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via },
    });
  }
}

/**
 * A take-down's audit rows, its transaction's last statements (3a design, section 7): each staff key's revocation and,
 * when an open enrolment link went, one staff_enrollments_cancelled row with their count, so the take-down never ends
 * any staff access without a row on the record. The spent links it deletes too are no cancellation, and like the
 * janitor's deletions of them they get no row. Nothing when the account had no staff access left to take.
 */
async function appendTakeDownAudit(tx: Tx, actorId: string, userId: string, revocation: StaffRevocation): Promise<void> {
  await appendKeyRevocations(tx, actorId, revocation, "take_down");
  if (revocation.enrollmentsCancelled > 0) {
    await appendAudit(tx, {
      actorId,
      action: "staff_enrollments_cancelled",
      targetType: "user",
      targetId: userId,
      metadata: { count: revocation.enrollmentsCancelled, via: "take_down" },
    });
  }
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Its staff access ends too (3a design,
 * section 7): its live staff keys and staff sessions are revoked, with a staff_key_revoked event per key, and its
 * enrolment links deleted. The keys themselves are never deleted, since audit-verify checks old confirmations against
 * them, so auth.forget_staff_keys blanks their names, AAGUIDs and transports and keeps what audit-verify needs. It writes
 * no audit row: the caller writes those last, from what this answers. Run again by finishTakeDown, each statement finds
 * nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<{ sessionIds: string[]; staff: StaffRevocation }> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys and staff keys; cleared here rather than by finishPurge, so the
  // take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  const staff = await revokeStaffAccess(tx, userId, now, { keys: true, enrollments: "all", via: "take_down" });
  // The account is marked deleted by now, which the function checks: for a live account it would change nothing.
  await tx.execute(sql`select auth.forget_staff_keys(${userId}::uuid)`);
  return { sessionIds: revoked.map((row) => row.id), staff };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/staff/middleware.ts` (whole file)

```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../../env";
import { errorBody } from "../../lib/errors";
import { AuthError, authErrorMessage, type AuthDeps } from "../context";
import { checkStaffCsrf, clearStaffCookies, readStaffCookie } from "./cookies";
import { resolveStaffSession } from "./sessions";

/**
 * The mark the console sends on a request its person's action started (a click, a submitted form, opening a screen), and
 * on no other: only such a request moves the idle end. It governs the console's own requests; it is no defence against a
 * script in the page, which the console's policy and the step-up answer.
 */
export const STAFF_ACTIVITY_HEADER = "x-staff-activity";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Every staff route that needs a session stands behind this, after the staff gate (3a design, section 7, Every staff
 * request). It reads the staff cookie only, never a bearer token or the app's session cookie. A write (anything but GET
 * and HEAD) must carry the x-staff-csrf header equal to the staff CSRF cookie, checked before the session is read, so a
 * refused write moves nothing. The session is then read from the database, joined to its key and its account, and a
 * marked request slides its idle end in the same statement. Without a live session the answer is 401
 * staff_session_required with both staff cookies cleared, which the console answers with its sign-in. A later step that
 * finds the session ended after this read it (the step-up, when the session's key or account went meanwhile) raises the
 * same code, and its answer clears both cookies too.
 */
export function requireStaff(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ended = () => {
      clearStaffCookies(c);
      return c.json(errorBody("staff_session_required", authErrorMessage("staff_session_required"), c.get("requestId")), 401);
    };
    const token = readStaffCookie(c);
    if (!token) return ended();
    if (!SAFE_METHODS.has(c.req.method) && !checkStaffCsrf(c)) {
      return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
    }
    const session = await resolveStaffSession(deps, token, c.req.header(STAFF_ACTIVITY_HEADER) === "1");
    if (!session) return ended();
    c.set("staffSession", session);
    await next();
    // Hono has already answered an error thrown behind this through the app's onError and left it in c.error; the cookies
    // are added to that answer, as ended() adds them to its own.
    if (c.error instanceof AuthError && c.error.code === "staff_session_required") clearStaffCookies(c);
  });
}
```

### Replace `apps/api/src/auth/staff/revoke.ts` (whole file)

```ts
import type { Mailer } from "../../mail/mailer";
import { SYSTEM_ACTOR_ID } from "../admin";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { noticeTime, notifyAccount } from "../flows/notify";
import type { AuthRepo, StaffKeysRevoked } from "../repo";

/**
 * Revoking staff keys (3a design, section 7). The command line's `staff.js revoke` and the counter rule share one routine,
 * repo.revokeStaffKeys: the account's row locked first, the keys and every staff session they opened revoked, an event per
 * key and the audit rows last, all in one auth transaction. The counter rule also marks the key suspect and records the
 * regression as such. Only the command line enrols a replacement.
 */

/**
 * A staff key's counter went backwards after its signature verified, at a sign-in or at a step-up (`via` names which): the
 * key is revoked and marked suspect, every live staff session it opened revoked (at a step-up, the confirming one
 * included), staff_key_counter_regression recorded with its audit row, then its owner is mailed staff_key_suspect (never
 * 1c's passkey_suspect, whose remedy names the app's Security screen) and the attempt refused with staff_key_suspended. A
 * key that another revocation reached first, or whose account went meanwhile, is refused as any revoked key is at that
 * ceremony: staff_key_invalid at a sign-in, staff_step_up_invalid at a step-up.
 */
export async function revokeForCounterRegression(
  deps: AuthDeps,
  key: { id: string; userId: string; name: string },
  ctx: StaffRequestContext,
  via: "sign_in" | "step_up",
): Promise<never> {
  const revoked = await deps.repo.revokeStaffKeys({
    account: { id: key.userId },
    key: key.id,
    suspect: true,
    via,
    // The key's holder presented it, so the row is the account's; the request's id ties it to the access log.
    actorId: key.userId,
    now: deps.now(),
    requestId: ctx.requestId,
  });
  if (!revoked.ok || revoked.keys.length === 0) throw via === "sign_in" ? new AuthError("staff_key_invalid", 401) : new AuthError("staff_step_up_invalid", 403);
  // After the commit, and best effort as every notice is: a failed mail never undoes the revocation.
  await notifyAccount(deps, revoked.email, "staff_key_suspect", { name: key.name });
  throw new AuthError("staff_key_suspended", 403);
}

/** What `staff.js revoke` did, or why it found nothing to act on, and why its mail failed when it did. */
export type StaffKeysRevokedReport = (StaffKeysRevoked & { ok: false }) | (Extract<StaffKeysRevoked, { ok: true }> & { mailError: string | null });

/**
 * `staff.js revoke <email> <key id>` and `revoke <email> all`, from the server's command line only: the routine above with
 * the server as the actor, then, after the commit and only when a key was revoked, the owner is mailed the names of the
 * keys revoked (an enrolment link cancelled alone sends nothing, as with grant-role). The mail is best effort: one that
 * fails is reported to the caller and undoes nothing.
 */
export async function revokeStaffKeys(deps: { repo: AuthRepo; mailer: Mailer }, email: string, key: string | "all"): Promise<StaffKeysRevokedReport> {
  const now = new Date();
  const revoked = await deps.repo.revokeStaffKeys({ account: { email }, key, suspect: false, via: "cli", actorId: SYSTEM_ACTOR_ID, now });
  if (!revoked.ok) return revoked;
  let mailError: string | null = null;
  if (revoked.keys.length > 0) {
    try {
      await deps.mailer.send({
        to: revoked.email,
        template: "staff_keys_revoked",
        data: { names: revoked.keys.map((k) => `"${k.name}"`).join(", "), time: noticeTime(now) },
      });
    } catch (err) {
      mailError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ...revoked, mailError };
}
```

### Replace `apps/api/src/auth/staff/signin.ts` (whole file)

```ts
import type { StaffMe, StaffRole, StaffSignInVerifyRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { deviceLabel } from "../devices";
import { noticeTime, notifyAccount } from "../flows/notify";
import { HOUR, enforceLimit } from "../limits";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import { openStaffSession, staffMe } from "./sessions";

/**
 * The staff sign-in (3a design, section 7, Sign-in). The console asks for options, the browser offers the staff keys it
 * holds for the console's relying party, and the answer opens a staff session. Only a live staff key of a live staff
 * account opens one, and only when its authenticator reported user verification and neither backup eligibility nor a
 * backup at this use. The routes live in the staff module, behind the staff gate; the credential work is here.
 */

/** Sign-in attempts per client address an hour, counted before anything else. */
export const STAFF_SIGNIN_PER_IP_PER_HOUR = 20;
/** Sign-ins per staff key an hour, counted only once its signature and flags have checked, so only its holder spends them. */
export const STAFF_SIGNIN_PER_KEY_PER_HOUR = 10;

/** The one answer for every failure up to and including the signature, so no answer tells a live key from a revoked or unknown one. */
const keyInvalid = () => new AuthError("staff_key_invalid", 401);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_invalid; challenge_expired stays, and the console starts over on it. */
async function invalidAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyInvalid();
    throw err;
  }
}

/** What a sign-in hands the staff route: the session's token, for the cookie, and the answer /me would give. */
export interface StaffSignedIn {
  token: string;
  me: StaffMe;
}

/**
 * Options for a staff sign-in: an empty allow list, so the options name no account and the browser offers every
 * discoverable credential it holds for the console's relying party; user verification required; and a staff sign-in
 * challenge bound to nothing, which no other ceremony accepts. Handing them out stores nothing.
 */
export async function signInOptions(deps: AuthDeps): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_signin", deps.now());
  const options = await authenticationOptions({ rpId: staffConsole.rpId, allow: [], challenge, userVerification: "required" });
  return { options };
}

/**
 * Verifies a staff sign-in. The per-address limit is counted first. The challenge is read from the response and spent
 * before anything else runs, so a forged, foreign or spent one never reaches the library. Then the key must be a live
 * staff key of a live staff account, and the response must carry that account's user handle, since the allow list named
 * no one (as 1c's sign-in requires). Every failure so far, and a response the library refuses on its signature, its origin
 * (CONSOLE_ORIGIN alone) or its relying party (CONSOLE_RP_ID alone), is staff_key_invalid. Only after the signature are the
 * flags read, each refusal with its own code; then the per-key limit is counted, so an unsigned response naming a key's
 * credential id cannot lock its owner out; then 1c's counter rule, in the session's own transaction, where a regression
 * revokes the key. The session is mailed to its owner after the commit.
 */
export async function signInVerify(deps: AuthDeps, input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn> {
  await enforceLimit(deps.kv, `staff-signin:ip:${ctx.ipHash}`, STAFF_SIGNIN_PER_IP_PER_HOUR, HOUR);
  const staffConsole = consoleOf(deps);
  const now = deps.now();
  const challenge = await invalidAsStaff(() => readResponseChallenge(input.response));
  await invalidAsStaff(() => readChallenge(challengeKey(deps.config.authHmacKey), challenge, "staff_signin", now));
  await invalidAsStaff(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyForSignIn(input.response.id);
  // An unknown or revoked key, and an account that is deleted or no longer staff, are one answer. In development, where
  // the console's relying party ID is the app's, a personal passkey the browser offers here is refused by this lookup alone.
  if (!key || key.revokedAt !== null || key.deletedAt !== null || key.role === "user") throw keyInvalid();
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || key.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(key.webauthnUserId)) throw keyInvalid();

  const verified = await invalidAsStaff(() =>
    verifyAuthentication({
      response: input.response,
      expectedChallenge: challenge,
      origins: [staffConsole.origin],
      rpId: staffConsole.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed. WebAuthn L3 asks a relying party that uses
  // BE in its policy to check it on every assertion, and BS as well, since a key can be synced after it was registered.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  await enforceLimit(deps.kv, `staff-signin:key:${key.id}`, STAFF_SIGNIN_PER_KEY_PER_HOUR, HOUR);

  const browser = deviceLabel(ctx.userAgent, "web");
  const role = key.role as StaffRole;
  const opened = await openStaffSession(deps, { userId: key.userId, keyId: key.id, role, newCounter: verified.newCounter, browser }, ctx);
  // Null when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!opened) return revokeForCounterRegression(deps, key, ctx, "sign_in");
  const { token, session } = opened;
  // After the commit, and best effort as every notice is: a failed mail never undoes a sign-in.
  await notifyAccount(deps, key.email, "staff_session_started", { name: key.name, browser, time: noticeTime(session.createdAt) });
  return { token, me: await staffMe(deps, session) };
}
```

### Replace `apps/api/src/cli/staff.ts` (whole file)

```ts
/**
 * The staff command line (3a design, section 7). Run on the server only. enroll runs in the migrate service, as the
 * migrator, the one application role the running API never holds; the others run like grant-role:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>|all
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *
 * enroll prints a one-time link that registers one staff key for a live staff account with a handle; the database lets
 * only the migrator issue one. keys lists an account's staff keys, or every staff account with its keys, for the
 * runbook's comparison with the operator's own list. revoke revokes one key and every staff session it opened, or with
 * `all` every key and staff session of the account and its unused enrolment links, and mails the owner; it is the only way
 * to revoke a key by hand, since no console route does.
 *
 * audit-head prints the audit log's newest place and hash, which the keeper holds off the server. audit-verify recomputes
 * the whole chain in its own code (the staff module's chain.ts), never asking the database for a text or a hash, since
 * whoever owns the database can replace its functions, and checks it against the places kept before: a rewrite that
 * recomputed every later hash still fails against a place kept before it. It also checks every step-up a row stores
 * against the public key, owner, origin and relying party ID of the key it names, so a confirmed action is in the record
 * only with an assertion its actor's key made for exactly that action. Neither needs a server secret or the console's
 * configuration, so both run the same with the console off or moved: each reads only the database URLs it connects with
 * (staffDatabaseUrls), never the API's whole configuration.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Email, STAFF_STEP_UP_ACTIONS, STAFF_STEP_UP_CHALLENGE, StaffStoredAssertion, stepUpActionHash, stepUpBindingText } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID, createAuthRepo, revokeStaffKeys, verifyRecordedAssertion, type StaffKeysRevokedReport } from "../auth";
import { consoleHostOf, consoleOriginSetting, consoleRpIdSetting, databaseUrl, mailFrom, smtpUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { mailerFor, type CommandLineMailSettings } from "./mail";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;",
  "                                         run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>",
  "  keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
  "  revoke <email> <key id>                revoke that staff key and every staff session it opened, and mail its owner",
  "  revoke <email> all                     revoke every staff key and staff session of the account, delete its unused",
  "                                         enrolment links, and mail its owner",
].join("\n");

/** A place in the chain and the hash it had when someone kept it, as audit-head printed it. */
export interface KeptPlace {
  seq: number;
  hash: string;
}

export type StaffCommand =
  | { command: "enroll"; email: string }
  | { command: "keys"; email: string | null }
  | { command: "audit-head" }
  | { command: "audit-verify"; kept: KeptPlace[] }
  | { command: "revoke"; email: string; key: string | "all" };

/** A place as the keeper copies it: at most 15 digits, so it is always a safe integer, and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;
/** A staff key's id as `keys` prints it: a uuid, read in any case and kept in PostgreSQL's lower-case form. */
const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An address as the account was registered with it: trimmed and lower-cased, as the contracts read it. */
function emailArg(arg: string): string {
  const email = Email.safeParse(arg);
  if (!email.success) throw new Error(`not an email address: ${arg}\n${STAFF_USAGE}`);
  return email.data;
}

export function parseStaffArgs(args: readonly string[]): StaffCommand {
  const [command, ...rest] = args;
  switch (command) {
    case "enroll":
      if (rest.length !== 1) throw new Error(STAFF_USAGE);
      return { command, email: emailArg(rest[0]!) };
    case "keys":
      if (rest.length > 1) throw new Error(STAFF_USAGE);
      return { command, email: rest.length === 1 ? emailArg(rest[0]!) : null };
    case "audit-head":
      if (rest.length > 0) throw new Error(STAFF_USAGE);
      return { command };
    case "revoke": {
      if (rest.length !== 2) throw new Error(STAFF_USAGE);
      const email = emailArg(rest[0]!);
      // Exactly "all"; anything else must be a key's id, so a typo never revokes every key.
      if (rest[1] === "all") return { command, email, key: "all" };
      const key = rest[1]!.toLowerCase();
      if (!KEY_ID.test(key)) throw new Error(`not a key id or all: ${rest[1]} (staff.js keys prints each key's id)\n${STAFF_USAGE}`);
      return { command, email, key };
    }
    case "audit-verify":
      return {
        command,
        kept: rest.map((arg) => {
          const match = KEPT_PLACE.exec(arg);
          if (!match) throw new Error(`not a kept place: ${arg} (a kept place is <chain_seq>:<hash>, as audit-head prints it)\n${STAFF_USAGE}`);
          return { seq: Number(match[1]), hash: match[2]! };
        }),
      };
    case undefined:
      throw new Error(STAFF_USAGE);
    default:
      throw new Error(`unknown command: ${command}\n${STAFF_USAGE}`);
  }
}

// ---------------------------------------------------------------- the environment

/**
 * What each command reads of the environment, after its arguments are known, and nothing more. The API's configuration
 * (loadConfig) would also require its secrets, Valkey, the mail settings and APP_ORIGIN, and would refuse a CONSOLE_ORIGIN
 * its rules reject, none of which these commands use. audit-head reads the record on the API's role; audit-verify also
 * reads the staff keys on the auth role's.
 */
const AUDIT_HEAD_ENV = z.object({ DATABASE_URL_API: databaseUrl });
const AUDIT_VERIFY_ENV = AUDIT_HEAD_ENV.extend({ DATABASE_URL_AUTH: databaseUrl });

function readEnv<T extends z.ZodType>(schema: T, env: Record<string, string | undefined>, command: string): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment for ${command}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * The database URLs a command connects with: the API role's, and the auth role's for audit-verify and keys, which read the
 * staff keys there. enroll connects as the migrator alone and reads its settings with enrollSettings.
 */
export function staffDatabaseUrls(command: Exclude<StaffCommand, { command: "enroll" | "revoke" }>, env: Record<string, string | undefined>): { api: string; auth: string | null } {
  if (command.command === "audit-verify" || command.command === "keys") {
    const urls = readEnv(AUDIT_VERIFY_ENV, env, command.command);
    return { api: urls.DATABASE_URL_API, auth: urls.DATABASE_URL_AUTH };
  }
  return { api: readEnv(AUDIT_HEAD_ENV, env, command.command).DATABASE_URL_API, auth: null };
}

/**
 * What enroll reads: the migrator's URL, which only the migrate service holds, and the console's origin and relying party
 * ID, which Compose gives that service, each by the API's own rule for it. The relying party ID defaults to the console's
 * hostname, as the API's does. Nothing else of the API's configuration is read: the migrate service holds none of it.
 */
const ENROLL_ENV = z.object({ DATABASE_URL_MIGRATE: databaseUrl, CONSOLE_ORIGIN: consoleOriginSetting, CONSOLE_RP_ID: consoleRpIdSetting });

export interface EnrollSettings {
  migrate: string;
  consoleOrigin: string;
  consoleRpId: string;
}

/** enroll's settings, refusing while the console is off: a link to a console that does not run would enrol nothing. */
export function enrollSettings(env: Record<string, string | undefined>): EnrollSettings {
  // Blank counts as unset, as Compose passes an empty line of infra/.env.
  if (!env.CONSOLE_ORIGIN?.trim()) {
    throw new Error(
      "CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued. " +
        "Set API_CONSOLE_ORIGIN in infra/.env to the console's address (the migrate service reads it as CONSOLE_ORIGIN) and run the command again.",
    );
  }
  const settings = readEnv(ENROLL_ENV, env, "enroll");
  const consoleOrigin = settings.CONSOLE_ORIGIN!;
  return { migrate: settings.DATABASE_URL_MIGRATE, consoleOrigin, consoleRpId: settings.CONSOLE_RP_ID ?? consoleHostOf(consoleOrigin) };
}

/**
 * What revoke reads: the auth role's URL, on which it revokes, and the mail settings, with which it tells the key's owner,
 * each by the API's own rule for it. The API role's URL and the API's secrets are not read: revoke needs neither.
 */
const REVOKE_ENV = z.object({ DATABASE_URL_AUTH: databaseUrl, SMTP_URL: smtpUrl, MAIL_FROM: mailFrom, NODE_ENV: z.string().optional() });

export interface RevokeSettings {
  auth: string;
  mail: CommandLineMailSettings;
}

/** revoke's settings; production refuses a plain relay that does not upgrade with STARTTLS, as the API does. */
export function revokeSettings(env: Record<string, string | undefined>): RevokeSettings {
  const settings = readEnv(REVOKE_ENV, env, "revoke");
  return { auth: settings.DATABASE_URL_AUTH, mail: { smtpUrl: settings.SMTP_URL, mailFrom: settings.MAIL_FROM, requireTls: settings.NODE_ENV === "production" } };
}

// ---------------------------------------------------------------- reading the record

/** What the record is read through: the command line's own connection, or a transaction a test hands in. */
type Reader = Pick<Db, "select" | "execute">;

/** How many rows audit-verify reads at a time. */
const PAGE_SIZE = 1000;

/**
 * Sets the transaction up to read the record as the canonical text needs it. Times come as ISO text in UTC, which is what
 * the rows' Date values are parsed from (a session in 'SQL, DMY' would print another form), and a lock is waited on for
 * at most 10 seconds, as every staff command waits.
 */
async function readingSettings(q: Reader): Promise<void> {
  await q.execute(sql`set local datestyle = 'ISO'`);
  await q.execute(sql`set local timezone = 'UTC'`);
  await q.execute(sql`set local lock_timeout = '10s'`);
}

/**
 * The next page of rows after place `after` (from the lowest place when null) up to place `upto` (to the end when null),
 * in chain order. The jsonb columns come as PostgreSQL prints them, which the canonical text embeds as it is.
 */
function chainRows(q: Reader, after: number | null, upto: number | null) {
  return q
    .select({
      id: auditLog.id,
      chainVersion: auditLog.chainVersion,
      chainSeq: auditLog.chainSeq,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      requestId: auditLog.requestId,
      staffSession: auditLog.staffSession,
      keyId: auditLog.keyId,
      actionHash: auditLog.actionHash,
      stepUpText: sql<string | null>`${auditLog.stepUp}::text`,
      metadataText: sql<string>`${auditLog.metadata}::text`,
      prevHash: auditLog.prevHash,
      hash: auditLog.hash,
    })
    .from(auditLog)
    .where(and(after === null ? undefined : gt(auditLog.chainSeq, after), upto === null ? undefined : lte(auditLog.chainSeq, upto)))
    .orderBy(asc(auditLog.chainSeq))
    .limit(PAGE_SIZE);
}

// ---------------------------------------------------------------- audit-verify

/** One thing audit-verify found wrong: the place it is at, or null for the head or a staff key. */
export interface AuditProblem {
  place: number | null;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  /** The rows read: every row up to the head's place, and any other row the table holds at or below it. */
  rows: number;
  /** The head as audit_head held it, or null when the row is missing. */
  head: KeptPlace | null;
  keptChecked: number;
  /** How many rows follow the newest kept place, which no kept place anchors yet; every row when none was given. */
  unanchored: number;
  keysChecked: number;
  /** Keys whose staff_key_added row was written after the head this run read: the next run checks them. */
  keysLeftToNextRun: number;
  /** The first problems, in chain order, then the head's, the kept places' and the keys'. */
  problems: AuditProblem[];
  problemCount: number;
}

/** How many problems a report keeps: enough to name the first rows at fault. */
const PROBLEMS_KEPT = 100;

// ---------------------------------------------------------------- step-ups

/**
 * A staff key as audit-verify checks a step-up against it (3a design, section 7, Command line): its owner, its credential
 * and public key, and the origin and relying party ID recorded on it at enrolment, never the console's configuration now.
 */
interface RecordedKey {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  origin: string;
  rpId: string;
}

/** A row as the step-up checks read it: the chain's columns, with the metadata and the step-up as PostgreSQL printed them. */
type StepUpRow = Awaited<ReturnType<typeof chainRows>>[number];

// The authenticator data's flags byte follows the 32-byte hash of the relying party ID: UP and UV (WebAuthn L3, section 6.1).
const AUTH_DATA_FLAGS_AT = 32;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/** The members of a JSON object, or null for anything else. */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The client data a stored assertion carries, as JSON, or null when it cannot be read. */
function clientDataOf(assertion: StaffStoredAssertion): { type: unknown; origin: unknown; challenge: unknown } | null {
  try {
    const data = objectOf(JSON.parse(Buffer.from(assertion.clientDataJSON, "base64url").toString("utf8")));
    return data ? { type: data.type, origin: data.origin, challenge: data.challenge } : null;
  } catch {
    return null;
  }
}

/** A step-up challenge's binding and expiry, read at the contracts' offsets without the sealing key, or null for anything else. */
function stepUpChallengeOf(challenge: unknown): { binding: Buffer; expiresAt: number } | null {
  const L = STAFF_STEP_UP_CHALLENGE;
  if (typeof challenge !== "string" || challenge.length !== L.encodedLength) return null;
  const bytes = Buffer.from(challenge, "base64url");
  // Only the canonical encoding, as the API's codec reads it.
  if (bytes.length !== L.bytes || bytes.toString("base64url") !== challenge) return null;
  if (bytes[L.versionAt] !== L.version || bytes[L.purposeAt] !== L.purpose) return null;
  return { binding: bytes.subarray(L.bindingAt, L.bindingAt + L.bindingBytes), expiresAt: Number(bytes.readBigUInt64BE(L.expiryAt)) };
}

/**
 * One row's step-up (3a design, section 7, Command line), checked in audit-verify's own code with no server secret: a row
 * of a step-up action must carry one, whatever its actor; and a step-up must hold an assertion that the key the row names,
 * a key of the row's actor, made over a step-up challenge bound to the row's session and to the hash of the row's action,
 * target and `metadata.params`, unexpired when the row joined the chain, as a webauthn.get from the origin recorded on the
 * key, naming the relying party ID recorded on it, with user presence and verification. Answers the first check that fails,
 * or null, and the challenge the client data names, which no other row may carry.
 */
async function checkStepUp(row: StepUpRow, keys: ReadonlyMap<string, RecordedKey>): Promise<{ problem: string | null; challenge: string | null }> {
  const fail = (problem: string, challenge: string | null = null) => ({ problem, challenge });
  if (row.stepUpText === null) {
    return Object.hasOwn(STAFF_STEP_UP_ACTIONS, row.action) ? fail(`its action, ${row.action}, needs a step-up, and it carries none`) : { problem: null, challenge: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.stepUpText);
  } catch {
    parsed = null;
  }
  const stored = StaffStoredAssertion.safeParse(parsed);
  if (!stored.success) return fail("its step-up is not a stored assertion");
  const assertion = stored.data;
  const clientData = clientDataOf(assertion);
  const challenge = typeof clientData?.challenge === "string" ? clientData.challenge : null;

  if (row.staffSession === null) return fail("its step-up names no staff session", challenge);
  if (row.keyId === null) return fail("its step-up names no staff key", challenge);
  // The action's hash from the row itself, never from its action_hash column, which the next check compares with it. The
  // metadata is PostgreSQL's print of a jsonb value, so it always parses.
  const params = objectOf(objectOf(JSON.parse(row.metadataText) as unknown)?.params);
  if (row.targetType === null || row.targetId === null || params === null) {
    return fail("its step-up's action cannot be recomputed: it needs a target and metadata.params", challenge);
  }
  let actionHash: string;
  try {
    actionHash = await stepUpActionHash({ action: row.action, target: { type: row.targetType, id: row.targetId }, params });
  } catch {
    return fail("its step-up's action cannot be recomputed: its params are not JSON", challenge);
  }
  if (row.actionHash !== actionHash) return fail("its step-up's action hash is not the hash of its action, target and params", challenge);
  const key = keys.get(row.keyId);
  if (!key) return fail(`its step-up names key ${row.keyId}, which is not a staff key`, challenge);
  if (key.userId !== row.actorId) return fail(`its step-up's key ${key.id} belongs to another account than its actor`, challenge);
  if (clientData === null || clientData.type !== "webauthn.get" || clientData.origin !== key.origin) {
    return fail("its step-up's client data is not a webauthn.get from the origin recorded on its key", challenge);
  }
  const issued = stepUpChallengeOf(challenge);
  if (!issued) return fail("its step-up's challenge is not a step-up challenge", challenge);
  if (!issued.binding.equals(sha256(stepUpBindingText(row.staffSession, actionHash)))) {
    return fail("its step-up's challenge was not issued for this action in this session", challenge);
  }
  if (row.createdAt.getTime() >= issued.expiresAt) return fail("its step-up's challenge had expired when the row was written", challenge);
  const authData = Buffer.from(assertion.authenticatorData, "base64url");
  if (authData.length <= AUTH_DATA_FLAGS_AT || !authData.subarray(0, AUTH_DATA_FLAGS_AT).equals(sha256(key.rpId))) {
    return fail("its step-up's authenticator data does not name the relying party ID recorded on its key", challenge);
  }
  const flags = authData[AUTH_DATA_FLAGS_AT]!;
  if ((flags & FLAG_UP) === 0 || (flags & FLAG_UV) === 0) return fail("its step-up's authenticator data does not report user presence and verification", challenge);
  // The library checks all of the above again, and the signature over the authenticator data and the client data's hash.
  const verified = await verifyRecordedAssertion({ assertion, credential: { id: key.credentialId, publicKey: key.publicKey }, origin: key.origin, rpId: key.rpId });
  if (!verified) return fail(`its step-up's signature does not verify with the public key of key ${key.id}`, challenge);
  return { problem: null, challenge };
}

/** What one snapshot of the record showed, before the keys missing from it are looked up again. */
interface Walk {
  head: KeptPlace | null;
  rows: number;
  newest: KeptPlace | null;
  keptChecked: number;
  unanchored: number;
  keys: string[];
  /** The places of the staff_key_added rows read, by the key their key_id names. */
  keyRows: Map<string, number[]>;
  problems: AuditProblem[];
  problemCount: number;
}

/**
 * Everything audit-verify checks inside one view of the record: the head, then every row up to the head's place in chain
 * order, a page at a time. Run in a REPEATABLE READ transaction, a row written meanwhile is neither read nor missed. The
 * staff keys are read from `keysFrom` after the head, so each key listed either has its staff_key_added row among the
 * rows read or was added after the head, and every key a row read names is among them, since no key is ever deleted.
 */
async function walkRecord(q: Reader, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select">): Promise<Walk> {
  const problems: AuditProblem[] = [];
  let problemCount = 0;
  const problem = (place: number | null, message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place, message });
  };

  await readingSettings(q);
  const [headRow] = await q.select({ seq: auditHead.seq, hash: auditHead.hash }).from(auditHead).where(eq(auditHead.id, 1));
  const head = headRow ?? null;
  if (!head) problem(null, "the audit head is missing");
  // What the step-up checks need of each key, and nothing more: never its name, counter or transports.
  const recordedKeys = await keysFrom
    .select({ id: staffKeys.id, userId: staffKeys.userId, credentialId: staffKeys.credentialId, publicKey: staffKeys.publicKey, origin: staffKeys.origin, rpId: staffKeys.rpId })
    .from(staffKeys);
  const keys = recordedKeys.map((key) => key.id);
  const keysById = new Map(recordedKeys.map((key) => [key.id, key]));
  // Every step-up challenge read so far, by the place of the row that carried it: a challenge confirms one row only.
  const challenges = new Map<string, number>();

  const keptAt = new Map<number, string[]>();
  for (const place of kept) keptAt.set(place.seq, [...(keptAt.get(place.seq) ?? []), place.hash]);
  const keptSeen = new Set<number>();
  const keyRows = new Map<string, number[]>();
  let rows = 0;
  let previous: KeptPlace | null = null;
  // Without a head the whole table is read, so the other problems are still named.
  for (let after: number | null = null; ; ) {
    const page = await chainRows(q, after, head ? head.seq : null);
    for (const row of page) {
      rows++;
      const expected = previous ? previous.seq + 1 : 1;
      if (row.chainSeq < expected) {
        problem(row.chainSeq, "its place is not in the chain, which runs from place 1");
      } else if (row.chainSeq > expected) {
        problem(expected, row.chainSeq - expected === 1 ? `place ${expected} is missing` : `places ${expected} to ${row.chainSeq - 1} are missing`);
      }
      if (row.prevHash !== (previous ? previous.hash : CHAIN_ZERO_HASH)) {
        problem(row.chainSeq, previous ? `its prev_hash is not the hash of place ${previous.seq}` : "its prev_hash is not 64 zeros, as the first row's must be");
      }
      // The row's own hash, over its stored prev_hash: a changed row fails here, and a changed hash fails the next link.
      let text: string | null = null;
      try {
        text = canonicalText(row);
      } catch (err) {
        problem(row.chainSeq, (err as Error).message);
      }
      if (text !== null && chainHash(row.prevHash, text) !== row.hash) problem(row.chainSeq, "its hash does not match its content");
      for (const hash of keptAt.get(row.chainSeq) ?? []) {
        keptSeen.add(row.chainSeq);
        if (hash !== row.hash) problem(row.chainSeq, `the kept place ${row.chainSeq}:${hash} no longer matches: the row there has the hash ${row.hash}`);
      }
      if (row.action === "staff_key_added" && row.keyId !== null) keyRows.set(row.keyId, [...(keyRows.get(row.keyId) ?? []), row.chainSeq]);
      const stepUp = await checkStepUp(row, keysById);
      if (stepUp.problem !== null) problem(row.chainSeq, stepUp.problem);
      if (stepUp.challenge !== null) {
        const first = challenges.get(stepUp.challenge);
        if (first !== undefined) problem(row.chainSeq, `its step-up's challenge was already used at place ${first}`);
        else challenges.set(stepUp.challenge, row.chainSeq);
      }
      previous = { seq: row.chainSeq, hash: row.hash };
    }
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1]!.chainSeq;
  }

  if (head) {
    const [beyond] = await q
      .select({ seq: auditLog.chainSeq })
      .from(auditLog)
      .where(gt(auditLog.chainSeq, head.seq))
      .orderBy(asc(auditLog.chainSeq))
      .limit(1);
    if (beyond) problem(beyond.seq, `rows lie beyond the head's place ${head.seq}, from place ${beyond.seq}`);
    if (!previous) {
      if (head.seq !== 0 || head.hash !== CHAIN_ZERO_HASH) problem(null, `the head names place ${head.seq}, but no row is at or before it`);
    } else if (previous.seq !== head.seq) {
      problem(null, `the head names place ${head.seq}, but the newest row up to it is at place ${previous.seq}`);
    } else if (previous.hash !== head.hash) {
      problem(head.seq, "the head's hash is not the hash of the row at its place");
    }
  }
  for (const place of kept) {
    if (!keptSeen.has(place.seq)) problem(place.seq, `the kept place ${place.seq}:${place.hash} no longer matches: no row is at that place`);
  }
  const newestSeq = previous?.seq ?? 0;
  const newestKept = kept.length > 0 ? Math.max(...kept.map((place) => place.seq)) : 0;
  return {
    head,
    rows,
    newest: previous,
    keptChecked: kept.length,
    unanchored: Math.max(0, newestSeq - newestKept),
    keys,
    keyRows,
    problems,
    problemCount,
  };
}

/**
 * The staff keys' check, outside the snapshot: every staff key has exactly one staff_key_added row, which names it in
 * key_id. A key with none among the rows read is looked up again through `fresh`; one whose row was written after the
 * head is left to the next run, and one with no row at all is a problem.
 */
async function finishReport(walk: Walk, fresh: Pick<Db, "select">): Promise<AuditReport> {
  const problems = [...walk.problems];
  let problemCount = walk.problemCount;
  const problem = (message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place: null, message });
  };
  const missing: string[] = [];
  for (const key of walk.keys) {
    const places = walk.keyRows.get(key) ?? [];
    if (places.length === 0) missing.push(key);
    else if (places.length > 1) problem(`staff key ${key} has ${places.length} staff_key_added rows (places ${places.join(", ")})`);
  }
  let keysLeftToNextRun = 0;
  if (missing.length > 0) {
    const read = walk.head ? walk.head.seq : (walk.newest?.seq ?? 0);
    const later = await fresh
      .select({ keyId: auditLog.keyId })
      .from(auditLog)
      .where(and(eq(auditLog.action, "staff_key_added"), inArray(auditLog.keyId, missing), gt(auditLog.chainSeq, read)));
    const addedLater = new Set(later.map((row) => row.keyId));
    for (const key of missing) {
      if (addedLater.has(key)) keysLeftToNextRun++;
      else problem(`staff key ${key} has no staff_key_added row`);
    }
  }
  return {
    ok: problemCount === 0,
    rows: walk.rows,
    head: walk.head,
    keptChecked: walk.keptChecked,
    unanchored: walk.unanchored,
    keysChecked: walk.keys.length,
    keysLeftToNextRun,
    problems,
    problemCount,
  };
}

/**
 * audit-verify on the command line's own connections: the record read on the API's role in one REPEATABLE READ READ ONLY
 * transaction, the staff keys on the auth role's.
 */
export async function auditVerify(db: { api: Db; auth: Db }, kept: readonly KeptPlace[]): Promise<AuditReport> {
  const walk = await db.api.transaction((tx) => walkRecord(tx, kept, db.auth), { isolationLevel: "repeatable read", accessMode: "read only" });
  return finishReport(walk, db.api);
}

/**
 * The same check through a transaction the caller holds, so a test can verify rows it wrote, or rewrote as the owner, and
 * then roll back: no later test sees a chain broken on purpose. The staff keys are read through the transaction too,
 * unless its role cannot read them (the API's), when `keysFrom` names the auth role's pool.
 */
export async function checkAuditRecord(tx: DbTx, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select"> = tx): Promise<AuditReport> {
  return finishReport(await walkRecord(tx, kept, keysFrom), tx);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How audit-verify reports: what holds, or the first problems; and the rows no kept place anchors yet. */
export function describeReport(report: AuditReport): string[] {
  const lines: string[] = [];
  if (report.ok) {
    lines.push(
      report.rows === 0
        ? "audit-verify: the chain holds: the audit log is empty"
        : `audit-verify: the chain holds: ${plural(report.rows, "row", "rows")}, from place 1 to the head ${report.head!.seq}:${report.head!.hash}`,
    );
  } else {
    lines.push(`audit-verify: FAILED, ${plural(report.problemCount, "problem", "problems")}; the first rows at fault:`);
    const shown = report.problems.slice(0, 20);
    for (const p of shown) lines.push(p.place === null ? `  ${p.message}` : `  place ${p.place}: ${p.message}`);
    if (report.problemCount > shown.length) lines.push(`  and ${report.problemCount - shown.length} more`);
  }
  lines.push(
    report.keptChecked === 0
      ? `no kept place given: ${plural(report.unanchored, "row is", "rows are")} not yet anchored by a kept place`
      :`${plural(report.keptChecked, "kept place", "kept places")} checked; ${plural(report.unanchored, "row", "rows")} after the newest kept place ${report.unanchored === 1 ? "is" : "are"} not yet anchored`,
  );
  lines.push(
    `${plural(report.keysChecked, "staff key", "staff keys")} checked` +
      (report.keysLeftToNextRun > 0 ? `; ${plural(report.keysLeftToNextRun, "key was", "keys were")} added after this run's head and are left to the next run` : ""),
  );
  return lines;
}

// ---------------------------------------------------------------- enroll

/** How long an enrolment link works (3a design, section 2). */
const ENROLMENT_MINUTES = 30;
/** At most this many live staff keys per account; auth.add_staff_key refuses a sixth too. */
const LIVE_KEYS_MAX = 5;

/** What enroll issued, or why it refused. */
export type IssuedEnrolment =
  | { ok: true; token: string; email: string; role: string; expiresAt: Date }
  | { ok: false; problem: string };

/**
 * Issues an enrolment link as the migrator (3a design, section 7), in one transaction that first locks the account's row
 * FOR NO KEY UPDATE, as every writer of staff rows takes it, and waits for it at most 10 seconds. It refuses, writing
 * nothing, unless the account is live, staff and has a handle (the console names staff by their handle) and holds fewer
 * than five live keys. It writes the enrolment with only the token's sha256 and the console's origin and relying party ID,
 * its staff_enrollment_issued event, and last its audit row, which holds the chain's head until the commit. The token is
 * 32 random bytes; it is printed once and kept nowhere.
 */
export async function issueEnrolment(db: Db, email: string, settings: Pick<EnrollSettings, "consoleOrigin" | "consoleRpId">): Promise<IssuedEnrolment> {
  return db.transaction(async (tx): Promise<IssuedEnrolment> => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [account] = await tx
      .select({ id: users.id, email: users.email, role: users.role, onboardedAt: users.onboardedAt })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
      .limit(1)
      .for("no key update");
    if (!account) return { ok: false, problem: `no live account for ${email}` };
    if (account.role === "user") return { ok: false, problem: `${email} is not staff (its role is user): make it staff with grant-role first` };
    if (account.onboardedAt === null) {
      return { ok: false, problem: `${email} has no handle yet: the console names staff by their handle, so the account chooses one in the app first` };
    }
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(staffKeys)
      .where(and(eq(staffKeys.userId, account.id), isNull(staffKeys.revokedAt)));
    if ((held?.count ?? 0) >= LIVE_KEYS_MAX) {
      return { ok: false, problem: `${email} already holds ${LIVE_KEYS_MAX} live staff keys, the most an account may hold: revoke one before enrolling another` };
    }
    const token = randomBytes(32).toString("base64url");
    // The database's clock, which auth.add_staff_key checks the expiry against; the creation time is the same now().
    const [enrolment] = await tx
      .insert(staffEnrollments)
      .values({
        userId: account.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        origin: settings.consoleOrigin,
        rpId: settings.consoleRpId,
        expiresAt: sql`now() + make_interval(mins => ${ENROLMENT_MINUTES}::int)`,
      })
      .returning({ id: staffEnrollments.id, expiresAt: staffEnrollments.expiresAt });
    await tx.insert(authEvents).values({ userId: account.id, type: "staff_enrollment_issued", metadata: { enrollmentId: enrolment!.id, via: "cli" } });
    // As the migrator the row is written directly: auth.append_audit is the auth role's way, and does not take this action.
    await tx.insert(auditLog).values({
      actorId: SYSTEM_ACTOR_ID,
      action: "staff_enrollment_issued",
      targetType: "user",
      targetId: account.id,
      metadata: { enrollmentId: enrolment!.id, via: "cli" },
    });
    return { ok: true, token, email: account.email, role: account.role, expiresAt: enrolment!.expiresAt };
  });
}

/** What enroll prints: the link on a line of its own, so it can be copied whole, and how to hand it over. */
export function describeEnrolment(issued: Extract<IssuedEnrolment, { ok: true }>, consoleOrigin: string): string[] {
  return [
    `Enrolment link for ${issued.email} (${issued.role}), valid for ${ENROLMENT_MINUTES} minutes, until ${issued.expiresAt.toISOString()}, and once:`,
    `${consoleOrigin}/enroll/${issued.token}`,
    "Hand it over by a channel you trust: whoever holds it can register a staff key for this account. The person opens it on the device that holds the key, then signs in once with the new key.",
  ];
}

// ---------------------------------------------------------------- keys

/** One account as keys lists it, with its keys oldest first. */
export interface StaffKeysListing {
  id: string;
  email: string;
  role: string;
  handle: string | null;
  keys: {
    id: string;
    name: string;
    aaguid: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    suspectAt: Date | null;
  }[];
}

/**
 * The staff keys of the live account at `email`, or of every live account whose role is not user; null when no live
 * account has that address. Keys and accounts are read on the auth role, the handles on the API role, which holds the
 * profiles. A key's public key and credential id are never read.
 */
export async function listStaffKeys(db: { api: Pick<Db, "select">; auth: Pick<Db, "select"> }, email: string | null): Promise<StaffKeysListing[] | null> {
  const accounts = await db.auth
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(and(isNull(users.deletedAt), email === null ? ne(users.role, "user") : sql`lower(${users.email}) = lower(${email})`))
    .orderBy(asc(users.email));
  if (email !== null && accounts.length === 0) return null;
  if (accounts.length === 0) return [];
  const ids = accounts.map((account) => account.id);
  const keys = await db.auth
    .select({
      id: staffKeys.id,
      userId: staffKeys.userId,
      name: staffKeys.name,
      aaguid: staffKeys.aaguid,
      createdAt: staffKeys.createdAt,
      lastUsedAt: staffKeys.lastUsedAt,
      revokedAt: staffKeys.revokedAt,
      suspectAt: staffKeys.suspectAt,
    })
    .from(staffKeys)
    .where(inArray(staffKeys.userId, ids))
    .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
  const handles = new Map((await db.api.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(inArray(profiles.id, ids))).map((p) => [p.id, p.handle]));
  return accounts.map((account) => ({
    ...account,
    handle: handles.get(account.id) ?? null,
    keys: keys.filter((key) => key.userId === account.id).map(({ userId: _owner, ...key }) => key),
  }));
}

/**
 * How keys prints: each account on a line, its keys indented below it. A name is printed as a JSON string, so a quote or
 * a character a terminal would act on is shown escaped, never acted on. A zero AAGUID means the browser or the
 * authenticator withheld its model; none, that the account's deletion blanked it.
 */
export function describeStaffKeys(listing: StaffKeysListing[]): string[] {
  if (listing.length === 0) return ["no staff account"];
  const lines: string[] = [];
  for (const account of listing) {
    lines.push(`${account.role} ${account.email} ${account.handle === null ? "(no handle)" : `@${account.handle}`} (account ${account.id})`);
    if (account.keys.length === 0) lines.push("  no staff keys");
    for (const key of account.keys) {
      const state = key.revokedAt === null ? "live" : `revoked ${key.revokedAt.toISOString()}${key.suspectAt ? `, suspect ${key.suspectAt.toISOString()}` : ""}`;
      lines.push(
        `  key ${key.id} ${JSON.stringify(key.name)}: AAGUID ${key.aaguid ?? "none"}, created ${key.createdAt.toISOString()}, ` +
          `last used ${key.lastUsedAt ? key.lastUsedAt.toISOString() : "never"}, ${state}`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------- audit-head

/**
 * The newest row's place, hash and time, read with audit_head in one statement, and whether the head names that row. An
 * empty log's head is place 0 with 64 zeros.
 */
export async function readAuditHead(db: Db): Promise<{ ok: true; place: KeptPlace; createdAt: Date | null } | { ok: false; problem: string }> {
  return db.transaction(
    async (tx) => {
      await readingSettings(tx);
      const newest = tx
        .select({ seq: auditLog.chainSeq, hash: auditLog.hash, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.chainSeq))
        .limit(1)
        .as("newest");
      const [row] = await tx
        .select({ headSeq: auditHead.seq, headHash: auditHead.hash, seq: newest.seq, hash: newest.hash, createdAt: newest.createdAt })
        .from(auditHead)
        .leftJoin(newest, sql`true`)
        .where(eq(auditHead.id, 1));
      if (!row) return { ok: false as const, problem: "the audit head is missing" };
      const head = { seq: row.headSeq, hash: row.headHash };
      if (row.seq === null || row.hash === null) {
        if (head.seq === 0 && head.hash === CHAIN_ZERO_HASH) return { ok: true as const, place: head, createdAt: null };
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the audit log holds no row` };
      }
      if (row.seq !== head.seq || row.hash !== head.hash) {
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the newest row is ${row.seq}:${row.hash}` };
      }
      return { ok: true as const, place: head, createdAt: row.createdAt };
    },
    { accessMode: "read only" },
  );
}

// ---------------------------------------------------------------- the command

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

/** Runs one command and answers its exit code: 0 when it holds, 1 when it found a problem or failed, 2 for the usage. */
export async function runStaffCommand(args: readonly string[], env: Record<string, string | undefined> = process.env, out: Output = console): Promise<number> {
  let command: StaffCommand;
  try {
    command = parseStaffArgs(args);
  } catch (err) {
    out.error((err as Error).message);
    return 2;
  }
  if (command.command === "enroll") return runEnroll(command.email, env, out);
  if (command.command === "revoke") return runRevoke(command.email, command.key, env, out);
  let urls: { api: string; auth: string | null };
  try {
    urls = staffDatabaseUrls(command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  // The command line's own connections: the record on the API's role, which may only read it, and the staff keys on the
  // auth role's, which audit-verify checks the record against.
  const apiDb = createDb(urls.api, { max: 1 });
  const authDb = urls.auth === null ? null : createDb(urls.auth, { max: 1 });
  try {
    if (command.command === "audit-head") {
      const head = await readAuditHead(apiDb);
      if (!head.ok) {
        out.error(`audit-head: ${head.problem}; run audit-verify`);
        return 1;
      }
      out.log(`${head.place.seq}:${head.place.hash} ${head.createdAt ? head.createdAt.toISOString() : "(the audit log is empty)"}`);
      return 0;
    }
    if (command.command === "keys") {
      const listing = await listStaffKeys({ api: apiDb, auth: authDb! }, command.email);
      if (listing === null) {
        out.error(`keys: no live account for ${command.email}`);
        return 1;
      }
      for (const line of describeStaffKeys(listing)) out.log(line);
      return 0;
    }
    const report = await auditVerify({ api: apiDb, auth: authDb! }, command.kept);
    for (const line of describeReport(report)) {
      if (report.ok) out.log(line);
      else out.error(line);
    }
    return report.ok ? 0 : 1;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(apiDb), ...(authDb ? [closeDb(authDb)] : [])]);
  }
}

/** enroll, on the migrator's own connection: its settings first, so a console that is off connects to nothing. */
async function runEnroll(email: string, env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: EnrollSettings;
  try {
    settings = enrollSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const migrateDb = createDb(settings.migrate, { max: 1 });
  try {
    const issued = await issueEnrolment(migrateDb, email, settings);
    if (!issued.ok) {
      out.error(`enroll: ${issued.problem}; no link was issued`);
      return 1;
    }
    for (const line of describeEnrolment(issued, settings.consoleOrigin)) out.log(line);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `enroll: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

// ---------------------------------------------------------------- revoke

/** What revoke prints of what it did. */
export function describeRevocation(report: Extract<StaffKeysRevokedReport, { ok: true }>, email: string, key: string | "all"): string[] {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (key !== "all" && report.alreadyRevokedAt !== null) {
    return [`revoke: staff key ${key} of ${email} was already revoked at ${report.alreadyRevokedAt.toISOString()}; nothing changed`];
  }
  if (report.keys.length === 0 && report.staffSessionsRevoked === 0 && report.enrollmentsCancelled === 0) {
    return [`revoke: ${email} has nothing to revoke: no live staff key, staff session or unused enrolment link; nothing changed`];
  }
  const lines = [
    `revoke: ${email}: ${count(report.keys.length, "staff key", "staff keys")} revoked, ${count(report.staffSessionsRevoked, "staff session", "staff sessions")} revoked` +
      (key === "all" ? `, ${count(report.enrollmentsCancelled, "unused enrolment link", "unused enrolment links")} deleted` : ""),
  ];
  // A name is printed as a JSON string, as keys prints it, so a character a terminal would act on is shown escaped.
  for (const revoked of report.keys) lines.push(`  key ${revoked.id} ${JSON.stringify(revoked.name)}: ${count(revoked.sessionsRevoked, "staff session", "staff sessions")} revoked`);
  return lines;
}

/** revoke, on the command line's own connection on the auth role: its settings first, so a missing one connects to nothing. */
async function runRevoke(email: string, key: string | "all", env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: RevokeSettings;
  try {
    settings = revokeSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const authDb = createDb(settings.auth, { max: 1 });
  try {
    const report = await revokeStaffKeys({ repo: createAuthRepo(authDb), mailer: mailerFor(settings.mail) }, email, key);
    if (!report.ok) {
      out.error(report.reason === "no_account" ? `revoke: no live account for ${email}; nothing changed` : `revoke: no staff key ${key} on ${email}; nothing changed`);
      return 1;
    }
    for (const line of describeRevocation(report, email, key)) out.log(line);
    // The revocation stands whatever the mail does; the operator tells the person another way.
    if (report.mailError !== null) out.error(`warning: the staff_keys_revoked mail to the account could not be sent (${report.mailError}); the revocation stands`);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `revoke: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(authDb);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runStaffCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

### Replace `apps/api/src/env.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { ActiveStaffSession, Session, StaffStepUpConfirmed } from "./auth";

export type { Session };

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
    /** How the session was presented: the HttpOnly cookie (web) or a bearer token (native). */
    authVia: "cookie" | "bearer" | null;
    /** The staff session requireStaff read on a staff route (3a design, section 7); never set elsewhere. */
    staffSession: ActiveStaffSession | null;
    /** The action a step-up confirmed, which requireStaffStepUp leaves for the route that executes and records it; never set elsewhere. */
    staffStepUp: StaffStepUpConfirmed | null;
    /** The client address as TRUST_PROXY says to read it, and its keyed hash: the only form limits and audit rows hold. */
    clientIp: string;
    clientIpHash: string;
  };
};
```

### Replace `apps/api/src/staff/routes.ts` (whole file)

```ts
import { AuditPageQuery, StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffSignInVerifyRequest, StaffStepUpOptionsRequest, type AuditPage } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { clearStaffCookies, setStaffCookies, type ActiveStaffSession, type AuthForStaff, type StaffRequestContext, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Behind it, every route but enrolment and sign-in stands behind requireStaff.
 * Handlers only validate, call the auth module's staff interface or the audit reader, and shape the answer. A route that
 * changes something stands behind requireStaffStepUp as well, which verifies the key's confirmation of exactly what the
 * route is about to do; sign-out alone needs none.
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff, readAudit: (query: AuditPageQuery) => Promise<AuditPage>) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // The client's address is hashed before any flow sees it, and the request's id goes to the audit rows it writes.
  const requestContext = (c: Context<AppEnv>): StaffRequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
    requestId: c.get("requestId"),
  });

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  /** The confirmation requireStaffStepUp verified; a route without it in front is a wiring fault, not a refusal. */
  const confirmedStepUp = (c: Context<AppEnv>): StaffStepUpConfirmed => {
    const confirmed = c.get("staffStepUp");
    if (!confirmed) throw new Error("a staff route that changes something ran without requireStaffStepUp");
    return confirmed;
  };

  // Enrolment needs no session: the link's one-time token is the credential, until a key is stored with it.
  routes.post("/enroll/options", validate("json", StaffEnrollOptionsRequest), async (c) => c.json(await auth.enrollOptions(c.req.valid("json"))));
  routes.post("/enroll/verify", validate("json", StaffEnrollVerifyRequest), async (c) => c.json(await auth.enrollVerify(c.req.valid("json"), requestContext(c))));

  // Sign-in needs no session either: the staff key's assertion is the credential. The options take no body.
  routes.post("/signin/options", async (c) => c.json(await auth.signInOptions()));
  routes.post("/signin/verify", validate("json", StaffSignInVerifyRequest), async (c) => {
    const { token, me } = await auth.signInVerify(c.req.valid("json"), requestContext(c));
    // Both staff cookies, set once and never refreshed: they last the session's 12 hours.
    setStaffCookies(c, token);
    return c.json(me);
  });

  routes.get("/me", auth.requireStaff, async (c) => c.json(await auth.me(staffSession(c))));
  routes.get("/sessions", auth.requireStaff, async (c) => c.json(await auth.sessions(staffSession(c))));
  routes.get("/keys", auth.requireStaff, async (c) => c.json(await auth.keys(staffSession(c))));
  // Any staff member reads the whole record; reading is not itself recorded.
  routes.get("/audit", auth.requireStaff, validate("query", AuditPageQuery), async (c) => c.json(await readAudit(c.req.valid("query"))));
  routes.post("/signout", auth.requireStaff, async (c) => {
    await auth.signOut(staffSession(c), requestContext(c));
    clearStaffCookies(c);
    return c.body(null, 204);
  });

  // Step-up (3a design, section 7): options for confirming one action, bound to this session and to exactly the
  // { action, target, params } the console sent, which the action's own route then recomputes from what it executes.
  routes.post("/step-up/options", auth.requireStaff, validate("json", StaffStepUpOptionsRequest), async (c) =>
    c.json(await auth.stepUpOptions(staffSession(c), c.req.valid("json"))),
  );
  // One of the person's own staff sessions, revoked with a confirmation by the session's key: the path's handle is the
  // action's target, and the body is the action's params (none) with the assertion as `stepUp`. A handle that names no live
  // session of the person's is the 404 the app's own session revocation answers.
  routes.delete(
    "/sessions/:handle",
    auth.requireStaff,
    validate("param", z.object({ handle: z.uuid() })),
    auth.requireStaffStepUp("staff_session_revoked", (c) => c.req.param("handle")),
    async (c) => {
      const revoked = await auth.revokeSession(staffSession(c), confirmedStepUp(c), requestContext(c));
      return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
    },
  );

  return routes;
}
```

### Replace `packages/contracts/src/staff.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { AuthenticationResponseJSON, PasskeyOptionsResponse, RegistrationResponseJSON } from "./passkeys";

// The staff console (3a design, section 10). The console talks only to /api/staff/* on its own origin, and parses every
// answer with these schemas; the API validates every request with them.

/**
 * Every code the staff flows put in ErrorEnvelope.error.code. Staff routes may also answer the shared challenge_expired,
 * rate_limited and invalid_request, and the staff gate's not_found and csrf_failed, but never a passkey_* code.
 */
export const StaffErrorCode = z.enum([
  "staff_session_required",
  "staff_key_invalid",
  "staff_key_suspended",
  "staff_key_limit",
  "staff_key_not_device_bound",
  "staff_key_not_user_verified",
  "staff_key_refused",
  "staff_enrollment_invalid",
  "staff_step_up_required",
  "staff_step_up_invalid",
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;

/** The roles that open the console: an account whose role is user holds no staff key. */
export const StaffRole = Role.exclude(["user"]);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * The name a staff key's holder gives it at enrolment, under the display-name rules. The authenticator shows it (it is the
 * registration's user name), so the console asks for neither an email nor a real name.
 */
export const StaffKeyName = DisplayName;

/** Which button the enrolment page offered: a roaming security key (sent with the security-key hint) or this computer's Windows Hello (no hint). */
export const StaffKeyKind = z.enum(["security_key", "this_device"]);
export type StaffKeyKind = z.infer<typeof StaffKeyKind>;

/** A lowercase hex sha256: chain hashes and action hashes. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256");

/** A row's place in the audit chain (chain_seq): 1 for the first row. */
const ChainSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A place as a query string names it: a decimal without a sign, a leading zero or an exponent, and at most 15 digits, so
 * it always converts to a safe integer.
 */
const ChainSeqParam = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/, "must be a place in the audit chain: a positive whole number")
  .transform(Number);

// ---------------------------------------------------------------- keys, sessions and the account

/** One of the person's staff keys as the console lists them: never the public key, the credential id or the AAGUID. */
export const StaffKey = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type StaffKey = z.infer<typeof StaffKey>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKey) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;

/**
 * One of the person's live staff sessions. `handle` is the session's random handle, which the revocation route takes;
 * `browser` is the coarse label ("Firefox on Linux"), never the user agent or an address.
 */
export const StaffSession = z.object({
  handle: z.uuid(),
  browser: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session this request came from. */
  current: z.boolean(),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffSessionsResponse = z.object({ sessions: z.array(StaffSession) });
export type StaffSessionsResponse = z.infer<typeof StaffSessionsResponse>;

/**
 * GET /api/staff/me: the account's handle and role, the session's handle (the console binds step-up challenges to it) and
 * both expiries with the seconds left, counted on the server, so the console's idle timer needs no clock of its own.
 */
export const StaffMe = z
  .object({
    handle: z.string(),
    role: StaffRole,
    sessionHandle: z.uuid(),
    idleExpiresAt: z.iso.datetime(),
    idleSecondsLeft: z.number().int().nonnegative(),
    absoluteExpiresAt: z.iso.datetime(),
    absoluteSecondsLeft: z.number().int().nonnegative(),
  })
  // The idle expiry never moves past the absolute one (the database checks it too).
  .refine((me) => me.idleSecondsLeft <= me.absoluteSecondsLeft, { message: "the idle end cannot lie beyond the absolute end", path: ["idleSecondsLeft"] });
export type StaffMe = z.infer<typeof StaffMe>;

// ---------------------------------------------------------------- enrolment

/** POST /api/staff/enroll/options: the token of the link `staff.js enroll` printed, the key's name and its kind. */
export const StaffEnrollOptionsRequest = z.object({ token: OpaqueId, name: StaffKeyName, kind: StaffKeyKind });
export type StaffEnrollOptionsRequest = z.infer<typeof StaffEnrollOptionsRequest>;

/**
 * The registration options, and whether the console's relying party ID is the app's (`rpShared`, true in development).
 * Only when it is not does the page ask the password manager to drop a refused credential through the Signal API.
 */
export const StaffEnrollOptionsResponse = PasskeyOptionsResponse.extend({ rpShared: z.boolean() });
export type StaffEnrollOptionsResponse = z.infer<typeof StaffEnrollOptionsResponse>;

/** POST /api/staff/enroll/verify: the same token and name with the browser's registration response. */
export const StaffEnrollVerifyRequest = z.object({ token: OpaqueId, name: StaffKeyName, response: RegistrationResponseJSON });
export type StaffEnrollVerifyRequest = z.infer<typeof StaffEnrollVerifyRequest>;

/** The key the enrolment stored; the person then signs in with it once. */
export const StaffEnrollVerifyResponse = z.object({ key: StaffKey });
export type StaffEnrollVerifyResponse = z.infer<typeof StaffEnrollVerifyResponse>;

// ---------------------------------------------------------------- sign-in

/** POST /api/staff/signin/options takes no body and answers with discoverable-credential options. */
export const StaffSignInOptionsResponse = PasskeyOptionsResponse;
export type StaffSignInOptionsResponse = z.infer<typeof StaffSignInOptionsResponse>;

/** POST /api/staff/signin/verify: the browser's assertion. There is no device id: a staff session is its own record. */
export const StaffSignInVerifyRequest = z.object({ response: AuthenticationResponseJSON });
export type StaffSignInVerifyRequest = z.infer<typeof StaffSignInVerifyRequest>;

/** A sign-in answers with the new session as /me describes it, beside the two staff cookies. */
export const StaffSignInVerifyResponse = StaffMe;
export type StaffSignInVerifyResponse = z.infer<typeof StaffSignInVerifyResponse>;

// ---------------------------------------------------------------- step-up

/**
 * A uuid in the one spelling PostgreSQL writes, lower-case hex. A step-up target's id is hashed exactly as sent, but the
 * database finds a uuid by value whatever its case and the audit row records the id as the database returns it: an
 * upper-case spelling would act on the row and leave a record whose target no longer hashes to the confirmed action, which
 * audit-verify would refuse for good. So any other spelling is refused, never changed.
 */
const LowerCaseUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });

/**
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: LowerCaseUuid, params: z.strictObject({}) },
} as const;
export type StaffStepUpAction = keyof typeof STAFF_STEP_UP_ACTIONS;

export const StaffStepUpActionName = z.enum(Object.keys(STAFF_STEP_UP_ACTIONS) as [StaffStepUpAction, ...StaffStepUpAction[]]);

/** The `{ action, target, params }` of one step-up action, each part checked by that action's own schemas. */
function stepUpRequest<A extends StaffStepUpAction>(action: A) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  return z.strictObject({
    action: z.literal(action),
    target: z.strictObject({ type: z.literal(spec.targetType), id: spec.targetId }),
    params: spec.params,
  });
}

/** POST /api/staff/step-up/options: the action the route will execute, as it will execute it. */
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [stepUpRequest("staff_session_revoked")]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

/**
 * The step-up challenge's layout (3a design, section 5), which the API's codec writes, audit-verify reads back from a
 * stored assertion without the sealing key, and the console checks before it asks for the key: version, purpose, expiry
 * (epoch milliseconds, big-endian), nonce, the full 32-byte binding, then the first 16 bytes of an HMAC over the 58 bytes
 * before it, 74 bytes sent as unpadded base64url. The other ceremonies' challenges are 58 bytes with purposes 1 to 5 and a
 * 16-byte binding, so neither layout is ever read as the other.
 */
export const STAFF_STEP_UP_CHALLENGE = {
  bytes: 74,
  encodedLength: 99,
  version: 1,
  purpose: 6,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 32,
  sealAt: 58,
  sealBytes: 16,
} as const;

/** What a step-up confirms: an action, its target and its params, as the route will execute them, or as an audit row records them. */
export interface StaffStepUpActionInput {
  action: string;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * JSON with every object's keys sorted and no whitespace. Keys are sorted by UTF-16 code units (Array.prototype.sort's
 * order), and strings and numbers are written as JSON.stringify writes them, so the API, audit-verify and the console write
 * the same text. Anything JSON cannot carry is refused rather than dropped or changed, as JSON.stringify would.
 */
function sortedJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("a step-up action's params hold only JSON values: a number must be finite");
    return JSON.stringify(value);
  }
  // Array.from visits holes too, so a sparse array is refused as undefined.
  if (Array.isArray(value)) return `[${Array.from(value, sortedJson).join(",")}]`;
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`a step-up action's params hold only JSON values, not ${value instanceof Object ? value.constructor.name : typeof value}`);
}

/**
 * The text an action's hash is taken over (3a design, section 7, Step-up): the sorted JSON of `{ action, target: { type,
 * id }, params }`. The step-up options take it from what the console sent, requireStaffStepUp from what the route is about
 * to do, audit-verify from the row's action, target and `metadata.params`, and the console from what it chose.
 */
export function stepUpActionText(input: StaffStepUpActionInput): string {
  return sortedJson({ action: input.action, target: { type: input.target.type, id: input.target.id }, params: input.params });
}

/**
 * The text a step-up challenge's binding is the sha256 of: the staff session's handle, a newline and the action's hash. A
 * confirmation made in one session, or for one action, therefore binds nothing else.
 */
export function stepUpBindingText(sessionHandle: string, actionHash: string): string {
  return `${sessionHandle}\n${actionHash}`;
}

/**
 * The parts of the Web Crypto and Encoding APIs the hashes below use. Browsers and Node (from 19) both have them as
 * globals; the contracts are compiled without the DOM's or Node's types, so only these members are declared.
 */
interface WebPlatform {
  crypto: { subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(text: string): Uint8Array };
}

async function sha256(text: string): Promise<Uint8Array> {
  const platform = globalThis as unknown as WebPlatform;
  return new Uint8Array(await platform.crypto.subtle.digest("SHA-256", new platform.TextEncoder().encode(text)));
}

/** The action's hash: the lower-case hex sha256 of stepUpActionText's UTF-8 bytes. */
export async function stepUpActionHash(input: StaffStepUpActionInput): Promise<string> {
  return Array.from(await sha256(stepUpActionText(input)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The step-up challenge's binding: all 32 bytes of the sha256 of stepUpBindingText's UTF-8 bytes. */
export async function stepUpBinding(sessionHandle: string, actionHash: string): Promise<Uint8Array> {
  return sha256(stepUpBindingText(sessionHandle, actionHash));
}

/**
 * A step-up assertion as the audit row stores it in `step_up`: the three members `audit-verify` checks, base64url exactly
 * as the browser sent them, under the same bounds as the browser's answer.
 */
export const StaffStoredAssertion = z.strictObject(
  AuthenticationResponseJSON.shape.response.pick({ authenticatorData: true, clientDataJSON: true, signature: true }).shape,
);
export type StaffStoredAssertion = z.infer<typeof StaffStoredAssertion>;

// ---------------------------------------------------------------- the audit log

/** How many rows one page of the audit log holds. */
export const STAFF_AUDIT_PAGE_SIZE = 50;

/**
 * One row of the audit log as the console shows it: its place and hash in the chain, when it joined the chain, the actor's
 * handle (null for the system actor or an account without one), the action, its target and the action's hash when a
 * step-up confirmed it. Never its metadata.
 */
export const AuditEntry = z.object({
  seq: ChainSeq,
  hash: Sha256Hex,
  createdAt: z.iso.datetime(),
  actorHandle: z.string().nullable(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  actionHash: Sha256Hex.nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({ cursor: ChainSeqParam.optional(), at: ChainSeqParam.optional(), action: z.enum(["staff_sign_in"]).optional() })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/db test:       Tests  40 passed (40)
packages/contracts test:       Tests  139 passed (139)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  108 passed (108)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  548 passed | 438 skipped (986)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  436 passed (436)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: verify: staff-cli

```bash
node --check apps/api/dist/staff.js && node apps/api/dist/staff.js 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo staff-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `usage: node dist/staff.js <command>`
- `revoke <email> all`
- `audit-verify [<chain_seq>:<hash> ...]`
- `staff-exit=2`

Observed on the dry run:

```text
usage: node dist/staff.js <command>
audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before
revoke <email> all                     revoke every staff key and staff session of the account, delete its unused
staff-exit=2
```

## Step 9: verify: audit-verify-dev

```bash
cd apps/api && set -a && . ./.env && set +a && node dist/staff.js audit-verify 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo verify-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `audit-verify: the chain holds:`
- `staff keys checked`
- `verify-exit=0`

Observed on the dry run:

```text
audit-verify: the chain holds: 19 rows, from place 1 to the head 19:ef0af91506352cd1a9fac887d777baace7a2acd0f41f9b43dc0399849efde0fc
0 staff keys checked
verify-exit=0
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/passkeys/challenge.ts`
- `apps/api/src/auth/passkeys/webauthn.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/staff/middleware.ts`
- `apps/api/src/auth/staff/revoke.ts`
- `apps/api/src/auth/staff/signin.ts`
- `apps/api/src/auth/staff/step-up.ts`
- `apps/api/src/cli/staff.ts`
- `apps/api/src/env.ts`
- `apps/api/src/staff/routes.ts`
- `apps/api/test/auth/passkey-challenge.test.ts`
- `apps/api/test/auth/passkey-webauthn.test.ts`
- `apps/api/test/integration/audit-verify.test.ts`
- `apps/api/test/integration/http-staff-sessions.test.ts`
- `apps/api/test/integration/staff-step-up.test.ts`
- `apps/api/test/integration/staff-step-up.ts`
- `apps/api/test/staff/app-mount.test.ts`
- `apps/api/test/staff/route-table.test.ts`
- `packages/contracts/src/staff.ts`
- `packages/contracts/test/staff.test.ts`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(api,contracts): step-up: an action that changes something asks for an assertion from the session's own staff key over a 74-byte challenge bound to the session's handle and the sorted-JSON hash of the action, its target and its parameters, spent once and read only while more than a minute of its ten is left; the route recomputes the hash from what it is about to do, re-checks the key and the account under the account's lock, and writes its record with the assertion in the same transaction; DELETE /api/staff/sessions/:handle is the first such action and takes only a lower-case handle, so the record hashes what was confirmed; audit-verify checks every confirmation against the key's public key, the origin and relying party recorded on it and the row's actor, and that no step-up action's row lacks one; no route changes a role or reads another person's data" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,contracts): step-up: an action that changes something asks for an assertion from the session's own staff key over a 74-byte challenge bound to the session's handle and the sorted-JSON hash of the action, its target and its parameters, spent once and read only while more than a minute of its ten is left; the route recomputes the hash from what it is about to do, re-checks the key and the account under the account's lock, and writes its record with the assertion in the same transaction; DELETE /api/staff/sessions/:handle is the first such action and takes only a lower-case handle, so the record hashes what was confirmed; audit-verify checks every confirmation against the key's public key, the origin and relying party recorded on it and the row's actor, and that no step-up action's row lacks one; no route changes a role or reads another person's data`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 21>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "staff-cli": <paste the expected lines as printed>
Verify "audit-verify-dev": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
