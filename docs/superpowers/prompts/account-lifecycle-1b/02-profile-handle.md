# korbat account lifecycle (1b) — Task 2 of 9: Profile editing and handle change: display name and bio edits, a handle change once every 30 days with every old handle reserved for its account, onboarding writing the handle history, security events from the social module

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. Its social module owns the public profiles; the auth module owns accounts and the reserved-handle list. This task lets an account edit its display name and bio and change its handle: once every 30 days, with every handle it ever had reserved for it in `handle_history` (onboarding writes the first row), so a renamed account cannot be impersonated and a harassed account can move without leaving a redirect. The social module records the two security events through the auth module. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, sections 7.1, 7.2 and 10.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(contracts,db,api): the account lifecycle's ground: contracts for profile editing, handle change, email change, the badge, deletion and the export; handle_history, handle_changed_at, purged_at, a unique phone-hash index, the delete_account code purpose and seven event types in migration 0009 with the handle backfill; VERIFY_PROVIDER, Vonage credentials and the brand with production guards; six mail templates`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/02-profile-handle.md 1
```

Expected: 8 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/http-profile.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `p${randomBytes(4).toString("hex")}`;

/**
 * The profile-editing routes through the real app: 1a sign-up for the accounts, cookie sessions with
 * CSRF, the auth module's freshness check on the handle change, and events written to auth_events
 * through the auth module, wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `profile-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** The `{ profile }` body of a successful edit or handle change, checked against the contract. */
  const profileOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return ProfileView.parse(((await res.json()) as { profile: unknown }).profile);
  };
  /** Puts the session's last proof of a credential ten minutes back, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const signedOut = (path: string, method: string, body: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("editing the profile needs an onboarded session; the edit is public at once and recorded", async () => {
    expect((await signedOut("/api/me/profile", "PATCH", { bio: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "too early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const edited = await profileOf(await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { displayName: "Ada Lovelace", bio: "  Analytical engines.  " } }));
    expect(edited).toMatchObject({ id: ada.userId, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(edited.viewer).toBeUndefined();
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json())).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    const empty = await ada.b.fetch("/api/me/profile", { method: "PATCH", json: {} });
    expect(empty.status).toBe(400);
    expect(await errorCode(empty)).toBe("invalid_request");
    expect((await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "x".repeat(161) } })).status).toBe(400);
    expect(await eventTypes(ada.userId)).toContain("profile_updated");
  });

  test("changing the handle needs an onboarded, fresh session; /me and the profile routes follow; the cooldown answers with Retry-After", async () => {
    expect((await signedOut("/api/me/handle", "POST", { handle: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/handle", { json: { handle: "too_early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const bob = await signUp();
    const to = newHandle();
    const changed = await profileOf(await ada.b.fetch("/api/me/handle", { json: { handle: to.toUpperCase() } }));
    expect(changed).toMatchObject({ id: ada.userId, handle: to });
    const me = MeResponse.parse(await (await ada.b.fetch("/api/me")).json());
    expect(me.profile).toMatchObject({ id: ada.userId, handle: to, verified: false });
    expect(me.profile!.handleChangedAt).not.toBeNull();
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${to}`)).json()).id).toBe(ada.userId);
    expect(await eventTypes(ada.userId)).toContain("handle_changed");

    const again = await ada.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("handle_cooldown");
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(29 * 24 * 3600);

    const refusals = [
      [ada.handle, "handle_taken", 409],
      [to.toUpperCase(), "handle_taken", 409],
      ["admin", "handle_reserved", 400],
      ["ab", "handle_invalid", 400],
      [bob.handle, "invalid_request", 400],
    ] as const;
    for (const [handle, code, status] of refusals) {
      const refused = await bob.b.fetch("/api/me/handle", { json: { handle } });
      expect(refused.status, handle).toBe(status);
      expect(await errorCode(refused), handle).toBe(code);
    }
    expect(MeResponse.parse(await (await bob.b.fetch("/api/me")).json()).profile).toMatchObject({ handle: bob.handle, handleChangedAt: null });
    expect(await eventTypes(bob.userId)).not.toContain("handle_changed");

    await makeStale(bob.b);
    const stale = await bob.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    // Editing the name or the bio needs a session but no fresh proof of a credential.
    expect((await bob.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "still allowed" } })).status).toBe(200);
  });
});
```

### Create `apps/api/test/integration/social-flows-profile-edit.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { ProfileView } from "@korbat/contracts";
import { closeDb, createDb, handleHistory, profiles, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createProfileStore } from "../../src/profiles/store";
import { createPost, getPost } from "../../src/social/flows/posts";
import { HANDLE_COOLDOWN_MS, changeHandle, editProfile } from "../../src/social/flows/profile-edit";
import { profile } from "../../src/social/flows/profiles";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `h_${randomBytes(5).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** The profile the history reserves a handle for, or null when the handle was never left behind. */
  const reservedBy = async (handle: string) =>
    (await db.select({ profileId: handleHistory.profileId }).from(handleHistory).where(eq(handleHistory.handleLower, handle.toLowerCase())))[0]?.profileId ?? null;

  test("an edit is stored, shown to everyone through the profile flow, and recorded as an event", async () => {
    const ada = await h.established();
    const view = await editProfile(h.deps, ada.id, { displayName: "Ada Lovelace", bio: "Analytical engines." });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(view.viewer).toBeUndefined();
    expect(await profile(h.deps, null, ada.handle)).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    expect((await editProfile(h.deps, ada.id, { bio: "" })).bio).toBe("");
    expect(h.events.filter((e) => e.userId === ada.id)).toEqual([
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
    ]);
  });

  test("changing the handle reserves the old one, stamps the change, and existing posts show the new handle at once", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    h.clock.next();
    const root = await createPost(h.deps, ada.id, { body: "by ada", media: [] });
    h.clock.next();
    const reply = await createPost(h.deps, bob.id, { body: "to ada", media: [], replyToId: root.id });
    const to = newHandle();
    const view = await changeHandle(h.deps, ada.id, { handle: to.toUpperCase() });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: to, counts: { posts: 1, followers: 0, following: 0 } });
    expect(view.viewer).toBeUndefined();
    const row = (await h.repo.findProfileById(ada.id))!;
    expect(row.handle).toBe(to);
    expect(row.handleChangedAt).not.toBeNull();
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    expect((await getPost(h.deps, null, root.id)).author.handle).toBe(to);
    expect((await getPost(h.deps, null, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: to });
    expect(await rejection(profile(h.deps, null, ada.handle))).toBe("not_found");
    expect((await profile(h.deps, bob.id, to)).id).toBe(ada.id);
    expect(h.events).toContainEqual({ userId: ada.id, type: "handle_changed", metadata: { from: ada.handle, to } });
    // What /me reads from the profile store follows the change too.
    expect(await createProfileStore(db).find(ada.id)).toEqual({ id: ada.id, handle: to, displayName: `Profile ${ada.handle}`, handleChangedAt: row.handleChangedAt!.toISOString(), verified: false });
  });

  test("a handle another profile holds, in any case, or ever held is handle_taken; the profile itself may go back after the cooldown", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const to = newHandle();
    await changeHandle(h.deps, ada.id, { handle: to });
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: to.toUpperCase() }))).toBe("handle_taken");
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: ada.handle }))).toBe("handle_taken");
    expect((await h.repo.findProfileById(bob.id))!.handle).toBe(bob.handle);
    expect(await rejection(changeHandle(h.deps, ada.id, { handle: ada.handle }))).toBe("handle_cooldown");
    h.clock.jump(HANDLE_COOLDOWN_MS);
    expect((await changeHandle(h.deps, ada.id, { handle: ada.handle })).handle).toBe(ada.handle);
    expect(await reservedBy(to)).toBe(ada.id);
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: to }))).toBe("handle_taken");
  });

  test("two accounts racing for the same free handle: exactly one wins and the other is handle_taken", async () => {
    for (let i = 0; i < 6; i++) {
      const [ada, bob] = await Promise.all([h.established(), h.established()]);
      const to = newHandle();
      const outcomes = await Promise.allSettled([changeHandle(h.deps, ada.id, { handle: to }), changeHandle(h.deps, bob.id, { handle: to })]);
      const won = outcomes.filter((o): o is PromiseFulfilledResult<ProfileView> => o.status === "fulfilled");
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0]!.reason as { code: string }).code).toBe("handle_taken");
      const holders = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.handle, to));
      expect(holders.map((r) => r.id)).toEqual([won[0]!.value.id]);
    }
  });

  test("two changes by the same account in flight leave every handle it held in the history", async () => {
    const ada = await h.established();
    const [x, y] = [newHandle(), newHandle()];
    const outcomes = await Promise.allSettled([changeHandle(h.deps, ada.id, { handle: x }), changeHandle(h.deps, ada.id, { handle: y })]);
    // The later one may have read the earlier one's stamp and stopped at the cooldown; otherwise both ran, one after the other, on the locked row.
    const done = outcomes.filter((o): o is PromiseFulfilledResult<ProfileView> => o.status === "fulfilled").map((o) => o.value.handle);
    for (const o of outcomes) if (o.status === "rejected") expect((o.reason as { code: string }).code).toBe("handle_cooldown");
    expect(done.length).toBeGreaterThanOrEqual(1);
    const final = (await h.repo.findProfileById(ada.id))!.handle;
    expect(done).toContain(final);
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    for (const handle of done) if (handle !== final) expect(await reservedBy(handle)).toBe(ada.id);
  });

  test("onboarding writes the handle into the history in the profile's transaction and refuses a handle another profile ever had", async () => {
    const store = createProfileStore(db);
    const ada = await h.established();
    await changeHandle(h.deps, ada.id, { handle: newHandle() });
    const id = randomUUID();
    const handle = newHandle();
    expect(await store.create({ id, handle, displayName: "New" })).toEqual({ ok: true, profile: { id, handle, displayName: "New" } });
    expect(await reservedBy(handle)).toBe(id);
    for (const taken of [ada.handle, ada.handle.toUpperCase(), handle.toUpperCase()]) {
      const late = randomUUID();
      expect(await store.create({ id: late, handle: taken, displayName: "Late" }), taken).toEqual({ ok: false, reason: "handle_taken" });
      expect(await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, late)), taken).toEqual([]);
    }
  });
});
```

### Create `apps/api/test/social/profile-edit.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { ProfileView } from "@korbat/contracts";
import { SocialError } from "../../src/social/context";
import { HANDLE_COOLDOWN_MS, PROFILE_EDITS_PER_HOUR, changeHandle, editProfile } from "../../src/social/flows/profile-edit";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { profileHarness } from "./profile-harness";

const nobody = "00000000-0000-4000-8000-000000000009";

/** The SocialError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<SocialError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SocialError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

describe("profile editing", () => {
  test("updates the display name, the bio or both, records profile_updated without content, and returns the owner's view", async () => {
    const h = profileHarness();
    const ada = h.profile("ada");
    const named = await editProfile(h.deps, ada.id, { displayName: "Ada Lovelace" });
    expect(ProfileView.parse(named)).toMatchObject({ id: ada.id, handle: "ada", displayName: "Ada Lovelace", bio: "", verified: false, counts: { posts: 0, followers: 0, following: 0 } });
    expect(named.viewer).toBeUndefined();
    expect((await editProfile(h.deps, ada.id, { bio: "Analytical engines." })).bio).toBe("Analytical engines.");
    const both = await editProfile(h.deps, ada.id, { displayName: "Ada", bio: "" });
    expect([both.displayName, both.bio]).toEqual(["Ada", ""]);
    const stored = (await h.deps.repo.findProfileById(ada.id))!;
    expect([stored.displayName, stored.bio, stored.handle]).toEqual(["Ada", "", "ada"]);
    expect(h.events).toEqual([
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
    ]);
  });

  test("allows 10 edits an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = profileHarness();
    const ada = h.profile("ada");
    const bob = h.profile("bob");
    for (let i = 0; i < PROFILE_EDITS_PER_HOUR; i++) await editProfile(h.deps, ada.id, { bio: `edit ${i}` });
    const err = await failure(editProfile(h.deps, ada.id, { bio: "one too many" }));
    expect(err).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR_MS / 1000 });
    expect((await h.deps.repo.findProfileById(ada.id))!.bio).toBe("edit 9");
    expect((await editProfile(h.deps, bob.id, { bio: "bob's own window" })).bio).toBe("bob's own window");
    h.advance(HOUR_MS + 1);
    expect((await editProfile(h.deps, ada.id, { bio: "next hour" })).bio).toBe("next hour");
    expect(h.events.filter((e) => e.userId === ada.id)).toHaveLength(PROFILE_EDITS_PER_HOUR + 1);
  });

  test("an edit with nothing in it is invalid_request, an unknown profile is not_found, and neither is recorded", async () => {
    const h = profileHarness();
    expect(await failure(editProfile(h.deps, h.profile("ada").id, {}))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(editProfile(h.deps, nobody, { bio: "x" }))).toMatchObject({ code: "not_found", status: 404 });
    expect(h.events).toEqual([]);
  });

  test("works without an events dependency, as the 2a tests run the module", async () => {
    const h = profileHarness();
    const ada = h.profile("ada");
    delete h.deps.events;
    expect((await editProfile(h.deps, ada.id, { bio: "quiet" })).bio).toBe("quiet");
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_two" })).handle).toBe("ada_two");
  });
});

describe("handle change", () => {
  test("lowercases the handle, checks its format and the reserved list, and refuses the current one", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ab" }))).toMatchObject({ code: "handle_invalid", status: 400 });
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "no-dashes" }))).toMatchObject({ code: "handle_invalid", status: 400 });
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "Admin" }))).toMatchObject({ code: "handle_reserved", status: 400 });
    expect(await failure(changeHandle(h.deps, ada.id, { handle: "ADA_L" }))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(changeHandle(h.deps, nobody, { handle: "ghost" }))).toMatchObject({ code: "not_found", status: 404 });
    const stored = (await h.deps.repo.findProfileById(ada.id))!;
    expect([stored.handle, stored.handleChangedAt]).toEqual(["ada_l", null]);
    expect(h.events).toEqual([]);
  });

  test("moves the old handle into the history, stamps the change, records handle_changed with from and to, and returns the view", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    const view = await changeHandle(h.deps, ada.id, { handle: "Ada_Lovelace" });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: "ada_lovelace", displayName: "Profile ada_l" });
    expect(view.viewer).toBeUndefined();
    const stored = (await h.deps.repo.findProfileById(ada.id))!;
    expect(stored.handle).toBe("ada_lovelace");
    expect(stored.handleChangedAt).toEqual(h.now());
    expect(h.history.get("ada_l")).toBe(ada.id);
    expect(h.events).toEqual([{ userId: ada.id, type: "handle_changed", metadata: { from: "ada_l", to: "ada_lovelace" } }]);
  });

  test("a handle another profile holds, in any case, or ever held is handle_taken; the profile itself may go back to its own", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    const bob = h.profile("bob_b");
    await changeHandle(h.deps, ada.id, { handle: "ada_lovelace" });
    expect(await failure(changeHandle(h.deps, bob.id, { handle: "ADA_LOVELACE" }))).toMatchObject({ code: "handle_taken", status: 409 });
    expect(await failure(changeHandle(h.deps, bob.id, { handle: "ada_l" }))).toMatchObject({ code: "handle_taken", status: 409 });
    expect((await h.deps.repo.findProfileById(bob.id))!.handle).toBe("bob_b");
    h.advance(HANDLE_COOLDOWN_MS);
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_l" })).handle).toBe("ada_l");
    expect(h.history.get("ada_lovelace")).toBe(ada.id);
    expect(h.history.get("ada_l")).toBe(ada.id);
    expect(h.events.map((e) => e.metadata)).toEqual([
      { from: "ada_l", to: "ada_lovelace" },
      { from: "ada_lovelace", to: "ada_l" },
    ]);
  });

  test("waits 30 days between changes, answering handle_cooldown with the seconds left as Retry-After", async () => {
    const h = profileHarness();
    const ada = h.profile("ada_l");
    await changeHandle(h.deps, ada.id, { handle: "ada_two" });
    const atOnce = await failure(changeHandle(h.deps, ada.id, { handle: "ada_three" }));
    expect(atOnce).toMatchObject({ code: "handle_cooldown", status: 429, retryAfterSeconds: HANDLE_COOLDOWN_MS / 1000 });
    h.advance(10 * DAY_MS);
    expect((await failure(changeHandle(h.deps, ada.id, { handle: "ada_three" }))).retryAfterSeconds).toBe((20 * DAY_MS) / 1000);
    h.advance(20 * DAY_MS - 500);
    expect((await failure(changeHandle(h.deps, ada.id, { handle: "ada_three" }))).retryAfterSeconds).toBe(1);
    h.advance(500);
    expect((await changeHandle(h.deps, ada.id, { handle: "ada_three" })).handle).toBe("ada_three");
    expect((await h.deps.repo.findProfileById(ada.id))!.handleChangedAt).toEqual(h.now());
    expect(h.events.map((e) => e.metadata)).toEqual([
      { from: "ada_l", to: "ada_two" },
      { from: "ada_two", to: "ada_three" },
    ]);
  });
});
```

### Create `apps/api/test/social/profile-harness.ts`

```ts
import { randomUUID } from "node:crypto";
import pino from "pino";
import type { AuthEventType } from "../../src/auth/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "../../src/social/context";
import type { HandleChangeResult, ProfileRow, SocialRepo } from "../../src/social/repo";

export interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

/** An events dependency that keeps what the flows asked the auth module to record, instead of writing auth_events. */
export function recordingEvents(): SocialEvents & { recorded: RecordedEvent[] } {
  const recorded: RecordedEvent[] = [];
  return {
    recorded,
    async append(userId, type, metadata) {
      recorded.push({ userId, type, metadata });
    },
  };
}

/**
 * The profile-edit flows without a database: profiles by id, and the handle history as the real
 * table keeps it (one row per lowercase handle, owned by one profile for good). The repository fake
 * has only the three methods those flows call, checked against the real signatures; the limit store
 * is in memory; the clock moves only when a test says so, so timestamps compare exactly; and the
 * events fake records what the server would write to auth_events.
 */
export function profileHarness(start = 1_789_000_000_000) {
  let t = start;
  const rows = new Map<string, ProfileRow>();
  /** handle_history: the lowercase handle and the profile it belongs to. */
  const history = new Map<string, string>();
  const events = recordingEvents();
  const repo = {
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const row = rows.get(id);
      if (!row) return false;
      if (patch.displayName !== undefined) row.displayName = patch.displayName;
      if (patch.bio !== undefined) row.bio = patch.bio;
      return true;
    },
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      const row = rows.get(id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
      const inUse = [...rows.values()].some((other) => other.id !== id && other.handle.toLowerCase() === to);
      if (inUse || (history.has(to) && history.get(to) !== id)) return { ok: false, reason: "handle_taken" };
      const from = row.handle;
      // As the real insert with "on conflict do nothing": a handle already in the history keeps its owner.
      if (!history.has(from.toLowerCase())) history.set(from.toLowerCase(), id);
      row.handle = to;
      row.handleChangedAt = now;
      return { ok: true, from };
    },
  } satisfies Pick<SocialRepo, "findProfileById" | "updateProfile" | "changeHandle">;
  const deps: SocialDeps = {
    repo: repo as unknown as SocialRepo,
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => t),
    log: pino({ level: "silent" }),
    now: () => new Date(t),
    events,
  };
  return {
    deps,
    events: events.recorded,
    history,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    /** A profile as onboarding leaves it: the handle chosen then is in the history. */
    profile(handle: string): ProfileRow {
      const id = randomUUID();
      const row: ProfileRow = { id, handle, displayName: `Profile ${handle}`, bio: "", verified: false, followerCount: 0, followingCount: 0, postCount: 0, createdAt: new Date(t), handleChangedAt: null };
      rows.set(id, row);
      history.set(handle.toLowerCase(), id);
      return row;
    },
  };
}
```

### Replace `apps/api/test/app.test.ts` (whole file)

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { MemoryKv } from "../src/auth/kv";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/mail/memory";
import { createMedia } from "../src/media";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createSocial } from "../src/social";

const key = Buffer.alloc(32, 7).toString("base64");

const config = loadConfig({
  DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
  DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
  REDIS_URL: "redis://localhost:56379",
  KORBAT_VERSION: "9.9.9",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
});

const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-app-test-"));

/** The real app with every module; the database pools are created but never connect in these tests. */
function app(checks: Record<string, () => Promise<void>>, advisoryChecks?: Record<string, () => Promise<void>>) {
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
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
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, advisoryChecks, auth, social, media });
}

describe("GET /api/health", () => {
  test("200 ok when all checks pass", async () => {
    const res = await app({ postgres: async () => {}, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: "ok", version: "9.9.9", checks: { postgres: "ok", redis: "ok" } });
  });
  test("503 degraded when a check throws", async () => {
    const res = await app({ postgres: async () => { throw new Error("down"); }, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", redis: "ok" });
  });
});

describe("advisory health checks", () => {
  const down = async () => {
    throw new Error("stale heartbeat");
  };
  test("a failing advisory check is reported as degraded, with status 200", async () => {
    const res = await app({ postgres: async () => {} }, { image_worker: down }).request("/api/health");
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "degraded", version: "9.9.9", checks: { postgres: "ok", image_worker: "fail" } });
  });
  test("a failing critical check is still 503, whatever the advisory ones say", async () => {
    const res = await app({ postgres: down }, { image_worker: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", image_worker: "ok" });
  });
});

describe("caching", () => {
  test("responses are no-store unless the handler set its own Cache-Control", async () => {
    const a = app({});
    a.get("/api/cached", (c) => {
      c.header("Cache-Control", "public, max-age=300");
      return c.text("image bytes");
    });
    expect((await a.request("/api/health")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/nope")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/cached")).headers.get("cache-control")).toBe("public, max-age=300");
  });
});

describe("request bodies", () => {
  test("JSON bodies over 64 KiB are refused with 413; the raw upload route is exempt", async () => {
    const a = app({});
    const big = JSON.stringify({ email: "x".repeat(70_000) });
    const refused = await a.request("/api/auth/email/start", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: big });
    expect(upload.status).toBe(401);
  });
});

describe("media routes", () => {
  const id = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
  test("uploading, status and removal need a session", async () => {
    const a = app({});
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: "x" });
    expect(upload.status).toBe(401);
    expect(await upload.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request(`/api/media/${id}`)).status).toBe(401);
    expect((await a.request(`/api/media/${id}`, { method: "DELETE" })).status).toBe(401);
  });
  test("image file requests that cannot name an image are not found before any query runs", async () => {
    const a = app({});
    for (const url of ["/api/media/not-an-id/large.webp", `/api/media/${id}/large.png`, `/api/media/${id}/huge.webp`]) {
      const res = await a.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
  });
  test("image files have their own bucket of 1200 a minute, outside the global 300", async () => {
    const a = app({});
    let last = 0;
    for (let i = 0; i < 1201; i++) last = (await a.request("/api/media/not-an-id/large.webp")).status;
    expect(last).toBe(429);
    expect((await a.request("/api/health")).status).toBe(200);
  });
});

describe("routing", () => {
  test("unknown route returns 404 envelope", async () => {
    const res = await app({}).request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
  test("/api/me is 401 without a session", async () => {
    const res = await app({}).request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });
  test("state-changing requests from another origin are refused before any handler runs", async () => {
    const res = await app({}).request("/api/auth/email/start", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "csrf_failed" } });
  });
  test("thrown errors become a 500 envelope without leaking the message", async () => {
    const a = app({});
    a.get("/api/boom", () => { throw new Error("secret detail"); });
    const res = await a.request("/api/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "internal" } });
  });
});

describe("social routes", () => {
  test("writes and the Following timeline need a session", async () => {
    const a = app({});
    const post = await a.request("/api/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "hi" }) });
    expect(post.status).toBe(401);
    expect(await post.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request("/api/timeline/following")).status).toBe(401);
    expect((await a.request("/api/me/bookmarks")).status).toBe(401);
  });
  test("malformed ids and handles are refused before any query runs", async () => {
    const a = app({});
    const post = await a.request("/api/posts/not-a-uuid");
    expect(post.status).toBe(400);
    expect(await post.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect((await a.request("/api/profiles/has%20space")).status).toBe(400);
    expect((await a.request("/api/timeline/latest?limit=500")).status).toBe(400);
  });
});
```

### Replace `apps/api/test/integration/http-media.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, HealthResponse, MEDIA_MAX_BYTES, MediaStatusResponse, PostView, TimelinePage, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, posts, type Db } from "@korbat/db";
import { uploadsLayout } from "@korbat/media-protocol";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";

type App = ReturnType<typeof createApp>;

/**
 * Images through the real app: 1a sign-up for the accounts, cookie sessions with CSRF, the media and
 * social modules wired as the server wires them, and a stand-in for the worker on the store directory.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: images over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-media-"));
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();
  let offsetMs = 0;
  let tick = 0;
  const now = () => new Date(Date.now() + offsetMs + ++tick);

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore(() => now().getTime());
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: uploads.root,
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
      now,
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, advisoryChecks: { image_worker: media.healthCheck }, auth, social, media });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `media-${randomUUID()}@korbat.local`;
    const handle = `m${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    return { b, handle };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const jpeg = { type: "image/jpeg", body: BYTES.jpeg };

  /** Uploads an image and lets the stand-in worker accept it. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: jpeg });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }

  test("upload, wait, post, and read the image back, signed in and signed out", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const sent = await ada.b.fetch("/api/media", { raw: jpeg });
    expect(sent.status).toBe(202);
    const { id } = UploadResponse.parse(await sent.json());
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${id}`)).json())).toEqual({ id, status: "processing" });
    expect((await app.request(`/api/media/${id}/large.webp`)).status).toBe(404);

    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await ada.b.fetch(`/api/media/${id.toUpperCase()}`)).json())).toMatchObject({ id, status: "ready", width: 1200, height: 800 });
    expect(existsSync(uploads.upload(id))).toBe(false);

    const created = await ada.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id, alt: "  a harbour\n at dawn " }] } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());
    expect(post.media).toEqual([{ id, width: 1200, height: 800, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a harbour at dawn", small: `/api/media/${id}/small.webp`, large: `/api/media/${id}/large.webp` }]);

    const image = await app.request(post.media[0]!.large);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("cache-control")).toBe("public, max-age=300");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await image.text()).toBe(`large-webp-of-${id}`);
    const again = await app.request(post.media[0]!.large, { headers: { "if-none-match": image.headers.get("etag")! } });
    expect(again.status).toBe(304);

    const latest = TimelinePage.parse(await (await app.request("/api/timeline/latest?limit=50")).json());
    expect(latest.items.find((item) => item.post.id === post.id)?.post.media[0]?.alt).toBe("a harbour at dawn");
  });

  test("uploads need a session, the CSRF token and the app's origin", async () => {
    const ada = await signUp();
    expect((await app.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: BYTES.jpeg })).status).toBe(401);
    const noToken = await ada.b.fetch("/api/media", { raw: jpeg, csrf: false });
    expect([noToken.status, await errorCode(noToken)]).toEqual([403, "csrf_failed"]);
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/media", { raw: jpeg });
    expect([crossOrigin.status, await errorCode(crossOrigin)]).toEqual([403, "csrf_failed"]);
  });

  test("refusals come back in the error envelope with the right status", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const svg = await ada.b.fetch("/api/media", { raw: { type: "image/svg+xml", body: Buffer.from("<svg/>") } });
    expect([svg.status, await errorCode(svg)]).toEqual([415, "unsupported_media_type"]);
    const disguised = await ada.b.fetch("/api/media", { raw: { type: "image/png", body: BYTES.pdf } });
    expect([disguised.status, await errorCode(disguised)]).toEqual([415, "unsupported_media_type"]);
    const heic = await ada.b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.heic } });
    expect(ErrorEnvelope.parse(await heic.json()).error.message).toMatch(/Export the photo as JPEG/);
    const declaredTooLarge = await ada.b.fetch("/api/media", { raw: jpeg, headers: { "content-length": String(MEDIA_MAX_BYTES + 1) } });
    expect([declaredTooLarge.status, await errorCode(declaredTooLarge)]).toEqual([413, "file_too_large"]);

    const id = await readyImage(ada.b);
    expect((await bob.b.fetch(`/api/media/${id}`)).status).toBe(404);
    expect((await bob.b.fetch(`/api/media/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await ada.b.fetch(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}`)).status).toBe(404);
    expect(existsSync(uploads.deletion(id))).toBe(true);
    expect((await ada.b.fetch("/api/media/not-an-id")).status).toBe(400);
  });

  test("a post takes only the author's own ready images, at most four, each described", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const bobs = await readyImage(bob.b);
    const stolen = await ada.b.fetch("/api/posts", { json: { body: "not mine", media: [{ id: bobs, alt: "x" }] } });
    expect([stolen.status, await errorCode(stolen)]).toEqual([400, "media_unavailable"]);

    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await readyImage(ada.b));
    const five = await ada.b.fetch("/api/posts", { json: { body: "too many", media: ids.map((id) => ({ id, alt: "x" })) } });
    expect([five.status, await errorCode(five)]).toEqual([400, "invalid_request"]);
    const undescribed = await ada.b.fetch("/api/posts", { json: { body: "no alt", media: [{ id: ids[0], alt: "   " }] } });
    expect([undescribed.status, await errorCode(undescribed)]).toEqual([400, "invalid_request"]);
    const empty = await ada.b.fetch("/api/posts", { json: { body: "  ", media: [] } });
    expect([empty.status, await errorCode(empty)]).toEqual([400, "invalid_request"]);

    const four = await ada.b.fetch("/api/posts", { json: { media: ids.slice(0, 4).map((id, i) => ({ id, alt: `image ${i + 1}` })) } });
    expect(four.status).toBe(201);
    expect(PostView.parse(await four.json())).toMatchObject({ body: "", media: [{ alt: "image 1" }, { alt: "image 2" }, { alt: "image 3" }, { alt: "image 4" }] });
  });

  test("images of a withheld post reach their author only, and deleting a post takes its images with it", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const id = await readyImage(ada.b);
    const post = PostView.parse(await (await ada.b.fetch("/api/posts", { json: { body: "under review", media: [{ id, alt: "an image" }] } })).json());
    await apiDb.update(posts).set({ state: "withheld" }).where(eq(posts.id, post.id));

    const own = await ada.b.fetch(`/api/media/${id}/small.webp`);
    expect([own.status, own.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
    expect((await bob.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect((await app.request(`/api/media/${id}/small.webp`)).status).toBe(404);

    await apiDb.update(posts).set({ state: "visible" }).where(eq(posts.id, post.id));
    expect((await ada.b.fetch(`/api/posts/${post.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/media/${id}/small.webp`)).status).toBe(404);
    expect(existsSync(uploads.deletion(id))).toBe(true);
  });

  test("an account in its first day may upload 20 images an hour", async () => {
    offsetMs = 0;
    const newcomer = await signUp();
    for (let i = 0; i < 20; i++) expect((await newcomer.b.fetch("/api/media", { raw: jpeg })).status).toBe(202);
    const refused = await newcomer.b.fetch("/api/media", { raw: jpeg });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorCode(refused)).toBe("rate_limited");
    offsetMs = 3 * DAY_MS;
  });

  test("health names the image worker without turning the API unhealthy", async () => {
    worker.beat(now().getTime() - 5 * 60_000);
    const stale = await app.request("/api/health");
    expect(stale.status).toBe(200);
    expect(HealthResponse.parse(await stale.json())).toMatchObject({ status: "degraded", checks: { image_worker: "fail" } });
    worker.beat(now().getTime());
    expect(HealthResponse.parse(await (await app.request("/api/health")).json())).toMatchObject({ status: "ok", checks: { image_worker: "ok" } });
  });
});
```

### Replace `apps/api/test/integration/http-social.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EngagementResponse, ErrorEnvelope, FlowResponse, PostPage, PostView, ProfilePage, ProfileView, ThreadResponse, TimelinePage } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { DAY_MS } from "../../src/social/tiers";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

/**
 * The social endpoints through the real app: 1a sign-up for the accounts, cookie sessions with CSRF,
 * and a clock the tests move so accounts can age past the new-account tier.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: posting and feed over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let app: App;
  const mailer = new MemoryMailer();
  let offsetMs = 0;
  let tick = 0;
  /** Strictly increasing even within one millisecond, so list order never depends on a tie-breaker. */
  const now = () => new Date(Date.now() + offsetMs + ++tick);

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore(() => now().getTime());
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), now });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in, onboarded web account. Accounts are as old as the clock offset says. */
  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `social-${randomUUID()}@korbat.local`;
    const handle = `s${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    return { b, handle };
  }

  const json = async (res: Response) => res.json() as Promise<unknown>;
  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  const post = async (b: Browser, body: string, extra: Record<string, string> = {}) => {
    const res = await b.fetch("/api/posts", { json: { body, ...extra } });
    expect(res.status).toBe(201);
    return PostView.parse(await res.json());
  };

  test("posting, replying, quoting, reading a thread, and reading signed out", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const root = await post(ada.b, "  hello\r\n\r\n\r\nworld  ");
    expect(root.body).toBe("hello\n\nworld");
    expect(root.author.handle).toBe(ada.handle);
    expect(root.viewer).toEqual({ liked: false, reposted: false, bookmarked: false });
    const reply = await post(ada.b, "a reply", { replyToId: root.id });
    expect(reply.replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    const quote = await post(ada.b, "a quote", { quoteOfId: root.id });
    expect(quote.quoteOf).toMatchObject({ id: root.id, body: "hello\n\nworld", quoteOf: null });

    const signedOut = await app.request(`/api/posts/${root.id}`);
    expect(signedOut.status).toBe(200);
    const view = PostView.parse(await signedOut.json());
    expect(view.viewer).toBeUndefined();
    expect(view.counts).toEqual({ likes: 0, reposts: 0, replies: 1, quotes: 1 });

    const thread = ThreadResponse.parse(await json(await app.request(`/api/posts/${reply.id}/thread`)));
    expect(thread.ancestors.map((a) => a.id)).toEqual([root.id]);
    expect(thread.post.id).toBe(reply.id);
    const both = await ada.b.fetch("/api/posts", { json: { body: "x", replyToId: root.id, quoteOfId: root.id } });
    expect(both.status).toBe(400);
    expect(await errorCode(both)).toBe("invalid_request");
  });

  test("follows, timelines, profiles and the follower lists", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const b1 = await post(bob.b, "from bob");
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" }))).toEqual({ following: true, followerCount: 1 });
    const a1 = await post(ada.b, "from ada");
    const repost = EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${a1.id}/repost`, { method: "POST" })));
    expect(repost.counts.reposts).toBe(1);

    const feed = TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following")));
    expect(feed.items.map((i) => (i.kind === "repost" ? `repost:${i.post.id}:${i.repostedBy.handle}` : `post:${i.post.id}`))).toEqual([
      `repost:${a1.id}:${bob.handle}`,
      `post:${a1.id}`,
      `post:${b1.id}`,
    ]);
    const latest = TimelinePage.parse(await json(await app.request("/api/timeline/latest?limit=50")));
    expect(latest.items.map((i) => i.post.id)).toEqual(expect.arrayContaining([a1.id, b1.id]));
    expect(latest.items.every((i) => i.kind === "post")).toBe(true);

    const profile = ProfileView.parse(await json(await ada.b.fetch(`/api/profiles/@${bob.handle.toUpperCase()}`)));
    expect(profile.handle).toBe(bob.handle);
    expect(profile.counts).toEqual({ posts: 1, followers: 1, following: 0 });
    expect(profile.viewer).toEqual({ following: true, followedBy: false, blocked: false, muted: false });
    expect(ProfileView.parse(await json(await app.request(`/api/profiles/${bob.handle}`))).viewer).toBeUndefined();

    const followersPage = ProfilePage.parse(await json(await bob.b.fetch(`/api/profiles/${bob.handle}/followers`)));
    expect(followersPage.items.map((i) => [i.handle, i.viewerFollows])).toEqual([[ada.handle, false]]);
    expect((await app.request(`/api/profiles/${bob.handle}/followers`)).status).toBe(401);
    const bobPosts = TimelinePage.parse(await json(await app.request(`/api/profiles/${bob.handle}/posts`)));
    expect(bobPosts.items.map((i) => i.kind)).toEqual(["repost", "post"]);
    expect((await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "DELETE" })).status).toBe(200);
    expect(ProfileView.parse(await json(await app.request(`/api/profiles/${bob.handle}`))).counts.followers).toBe(0);
  });

  test("likes, reposts and bookmarks with their private lists", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const target = await post(ada.b, "engage me");
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/like`, { method: "POST" })))).toEqual({
      counts: { likes: 1, reposts: 0, replies: 0, quotes: 0 },
      viewer: { liked: true, reposted: false, bookmarked: false },
    });
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/like`, { method: "POST" }))).counts.likes).toBe(1);
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/bookmark`, { method: "POST" }))).viewer.bookmarked).toBe(true);
    expect(PostPage.parse(await json(await bob.b.fetch("/api/me/likes"))).items.map((p) => p.id)).toEqual([target.id]);
    expect(PostPage.parse(await json(await bob.b.fetch("/api/me/bookmarks"))).items.map((p) => p.id)).toEqual([target.id]);
    expect(PostPage.parse(await json(await ada.b.fetch("/api/me/likes"))).items).toEqual([]);
    expect(EngagementResponse.parse(await json(await bob.b.fetch(`/api/posts/${target.id}/like`, { method: "DELETE" }))).counts.likes).toBe(0);
    expect((await app.request("/api/me/likes")).status).toBe(401);
    expect((await app.request("/api/me/bookmarks")).status).toBe(401);
  });

  test("blocks are directional in their errors, hide profiles both ways, and are listed for the blocker", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const adaPost = await post(ada.b, "ada's post");
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/block`, { method: "POST" }))).toEqual({ blocked: true });

    const bobSeesAda = await bob.b.fetch(`/api/profiles/${ada.handle}`);
    expect(bobSeesAda.status).toBe(404);
    expect((await bob.b.fetch(`/api/posts/${adaPost.id}`)).status).toBe(404);
    const bobFollows = await bob.b.fetch(`/api/profiles/${ada.handle}/follow`, { method: "POST" });
    expect(bobFollows.status).toBe(404);
    const bobLikes = await bob.b.fetch(`/api/posts/${adaPost.id}/like`, { method: "POST" });
    expect(bobLikes.status).toBe(404);
    const bobReplies = await bob.b.fetch("/api/posts", { json: { body: "reply", replyToId: adaPost.id } });
    expect(await errorCode(bobReplies)).toBe("post_unavailable");

    expect((await ada.b.fetch(`/api/profiles/${bob.handle}`)).status).toBe(404);
    const adaFollows = await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" });
    expect(adaFollows.status).toBe(403);
    expect(await errorCode(adaFollows)).toBe("blocked");
    expect(ProfilePage.parse(await json(await ada.b.fetch("/api/me/blocks"))).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(200);

    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/block`, { method: "DELETE" }))).toEqual({ blocked: false });
    expect((await bob.b.fetch(`/api/profiles/${ada.handle}`)).status).toBe(200);
    expect(ProfilePage.parse(await json(await ada.b.fetch("/api/me/blocks"))).items).toEqual([]);
  });

  test("mutes are silent and hide the muted account from timelines only", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    await ada.b.fetch(`/api/profiles/${bob.handle}/follow`, { method: "POST" });
    const b1 = await post(bob.b, "muted soon");
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/mute`, { method: "POST" }))).toEqual({ muted: true });
    expect(TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following"))).items).toEqual([]);
    expect(TimelinePage.parse(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/posts`))).items.map((i) => i.post.id)).toEqual([b1.id]);
    expect(ProfileView.parse(await json(await bob.b.fetch(`/api/profiles/${ada.handle}`))).viewer?.followedBy).toBe(true);
    expect(ProfilePage.parse(await json(await ada.b.fetch("/api/me/mutes"))).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect(await json(await ada.b.fetch(`/api/profiles/${bob.handle}/mute`, { method: "DELETE" }))).toEqual({ muted: false });
    expect(TimelinePage.parse(await json(await ada.b.fetch("/api/timeline/following"))).items.map((i) => i.post.id)).toEqual([b1.id]);
  });

  test("new accounts get the low tier with Retry-After, and the tier lifts as the account ages", async () => {
    offsetMs = 0;
    const young = await signUp();
    for (let i = 0; i < 5; i++) await post(young.b, `post ${i}`);
    const sixth = await young.b.fetch("/api/posts", { json: { body: "one too many" } });
    expect(sixth.status).toBe(429);
    expect(await errorCode(sixth)).toBe("rate_limited");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    const own = TimelinePage.parse(await json(await young.b.fetch("/api/timeline/following"))).items[0]!.post;
    expect((await young.b.fetch("/api/posts", { json: { body: "replies have their own window", replyToId: own.id } })).status).toBe(201);
    const repost = await young.b.fetch(`/api/posts/${own.id}/repost`, { method: "POST" });
    expect(repost.status).toBe(403);
    expect(await errorCode(repost)).toBe("account_too_new");
    const quote = await young.b.fetch("/api/posts", { json: { body: "quote", quoteOfId: own.id } });
    expect(await errorCode(quote)).toBe("account_too_new");

    offsetMs = 3 * DAY_MS;
    expect((await young.b.fetch("/api/posts", { json: { body: "established now" } })).status).toBe(201);
    expect((await young.b.fetch(`/api/posts/${own.id}/repost`, { method: "POST" })).status).toBe(200);
  });

  test("deleting: the author gets 204, others 403, and the tombstone stays in threads", async () => {
    offsetMs = 3 * DAY_MS;
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await post(ada.b, "root");
    const reply = await post(bob.b, "reply", { replyToId: root.id });
    const notAuthor = await bob.b.fetch(`/api/posts/${root.id}`, { method: "DELETE" });
    expect(notAuthor.status).toBe(403);
    expect(await errorCode(notAuthor)).toBe("not_author");
    expect((await ada.b.fetch(`/api/posts/${root.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await ada.b.fetch(`/api/posts/${root.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/posts/${root.id}`)).status).toBe(404);
    const thread = ThreadResponse.parse(await json(await app.request(`/api/posts/${reply.id}/thread`)));
    expect(thread.ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect(TimelinePage.parse(await json(await app.request(`/api/profiles/${ada.handle}/posts`))).items).toEqual([]);
  });

  test("cursors page the Latest timeline and malformed ones are refused", async () => {
    offsetMs = 3 * DAY_MS;
    const ada = await signUp();
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await post(ada.b, `page ${i}`)).id);
    const first = TimelinePage.parse(await json(await app.request("/api/timeline/latest?limit=2")));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = TimelinePage.parse(await json(await app.request(`/api/timeline/latest?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)));
    expect(second.items.map((i) => i.post.id)).not.toEqual(first.items.map((i) => i.post.id));
    const bad = await app.request("/api/timeline/latest?cursor=not-a-cursor");
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe("invalid_request");
    expect((await app.request("/api/profiles/no_such_handle_xyz")).status).toBe(404);
  });
});
```

### Replace `apps/api/test/integration/social-harness.ts` (whole file)

```ts
import pino from "pino";
import type { Db } from "@korbat/db";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { MediaForPosts } from "../../src/media";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { recordingEvents } from "../social/profile-harness";
import { newProfile, ticker } from "./social-fixtures";

/**
 * Real repository on Postgres, in-memory limits, a clock the test moves, and an events fake in place
 * of the auth module. Every read of the clock by a flow advances it one millisecond, so consecutive
 * actions never share a timestamp and list order in the tests is never left to the tie-breaker.
 */
export function socialHarness(db: Db, options: { media?: MediaForPosts } = {}) {
  const clock = ticker();
  const repo = createSocialRepo(db);
  const events = recordingEvents();
  const deps: SocialDeps = { repo, media: options.media ?? WITHOUT_MEDIA, limits: new MemoryStore(() => clock.now().getTime()), log: pino({ level: "silent" }), now: clock.next, events };
  return {
    deps,
    repo,
    clock,
    /** What the flows asked the auth module to record; the server writes these to auth_events. */
    events: events.recorded,
    /** An account old enough for every action. */
    established: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - 3 * DAY_MS) }),
    /** An account in its first day. */
    fresh: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - HOUR_MS) }),
  };
}

export type SocialHarness = ReturnType<typeof socialHarness>;

/** The error code a flow rejects with, or null when it succeeds. */
export async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
    throw err;
  }
}
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
Test Files  2 failed | 26 passed | 23 skipped (51)
Tests  172 passed | 160 skipped (332)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/02-profile-handle.md 3
```

Expected: 10 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/social/flows/profile-edit.ts`

```ts
import type { HandleChangeRequest, ProfileEditRequest, ProfileView } from "@korbat/contracts";
import { checkHandle } from "../../auth";
import { SocialError, type SocialDeps } from "../context";
import { enforceAccountLimit } from "../limits";
import type { ProfileRow } from "../repo";
import { DAY_MS, HOUR_MS } from "../tiers";
import { profileView } from "./profiles";

/** A handle may change again this long after the last change (1b design, section 7.2). */
export const HANDLE_COOLDOWN_MS = 30 * DAY_MS;
/** Edits of the display name or the bio an account may make in an hour. */
export const PROFILE_EDITS_PER_HOUR = 10;

/** The viewer's own profile row, which the edits below start from. A session always has one; a missing row means the account is gone. */
async function own(deps: SocialDeps, viewer: string): Promise<ProfileRow> {
  const row = await deps.repo.findProfileById(viewer);
  if (!row) throw new SocialError("not_found", 404);
  return row;
}

/** Sets the display name, the bio, or both, and answers with the profile as its owner sees it on the profile route. */
export async function editProfile(deps: SocialDeps, viewer: string, input: ProfileEditRequest): Promise<ProfileView> {
  // The contract refuses an empty edit; a caller that skipped it gets the same answer instead of an update with nothing to set.
  if (input.displayName === undefined && input.bio === undefined) throw new SocialError("invalid_request", 400, "Nothing to change.");
  await enforceAccountLimit(deps.limits, "profile-edit", viewer, PROFILE_EDITS_PER_HOUR, HOUR_MS);
  if (!(await deps.repo.updateProfile(viewer, input))) throw new SocialError("not_found", 404);
  // The event says that the profile changed, not what it says now: the events table holds no content.
  await deps.events?.append(viewer, "profile_updated");
  return profileView(await own(deps, viewer));
}

/**
 * Moves the account to a new handle: the handle rules and the reserved list first, then the 30-day
 * cooldown, then the repository's transaction, which decides whether the handle is free. The handle
 * left behind stays reserved for this account, which may take it back after the next cooldown.
 */
export async function changeHandle(deps: SocialDeps, viewer: string, input: HandleChangeRequest): Promise<ProfileView> {
  const to = input.handle.toLowerCase();
  const problem = checkHandle(to);
  if (problem) throw new SocialError(problem, 400);
  const current = await own(deps, viewer);
  if (current.handle.toLowerCase() === to) throw new SocialError("invalid_request", 400, "That is already your handle.");
  const now = deps.now();
  if (current.handleChangedAt) {
    const allowedAt = current.handleChangedAt.getTime() + HANDLE_COOLDOWN_MS;
    // Retry-After says when the next change is allowed, in whole seconds and never zero.
    if (now.getTime() < allowedAt) throw new SocialError("handle_cooldown", 429, undefined, Math.max(1, Math.ceil((allowedAt - now.getTime()) / 1000)));
  }
  const result = await deps.repo.changeHandle(viewer, to, now);
  if (!result.ok) {
    if (result.reason === "handle_taken") throw new SocialError("handle_taken", 409);
    // The row changed under us (a second request of the same account) and already holds this handle.
    if (result.reason === "unchanged") throw new SocialError("invalid_request", 400, "That is already your handle.");
    throw new SocialError("not_found", 404);
  }
  await deps.events?.append(viewer, "handle_changed", { from: result.from, to });
  return profileView(await own(deps, viewer));
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore } from "./context";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions } from "./sessions";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";

export type { ProfileStore } from "./context";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export { AuthError, isUniqueViolation } from "./context";
export { grantRole } from "./admin";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

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
  now?: () => Date;
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
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes). */
    appendEvent: (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata }),
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit } from "./social";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/profiles/store.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { handleHistory, profiles, type Db } from "@korbat/db";
import { isUniqueViolation, type ProfileStore } from "../auth";

/**
 * Public profiles through the korbat_api pool. Onboarding writes the profile and the reservation of
 * its handle in one transaction; the unique index on lower(handle) and the primary key of
 * handle_history decide races and refuse a handle another profile holds or ever held.
 */
export function createProfileStore(apiDb: Db): ProfileStore {
  const columns = { id: profiles.id, handle: profiles.handle, displayName: profiles.displayName };
  return {
    async create({ id, handle, displayName }) {
      try {
        const profile = await apiDb.transaction(async (tx) => {
          const [created] = await tx.insert(profiles).values({ id, handle, displayName }).returning(columns);
          // The handle chosen at onboarding is reserved like every later one (1b design, section 6); a row for it under another profile ends the transaction.
          await tx.insert(handleHistory).values({ handleLower: handle.toLowerCase(), profileId: id });
          return created!;
        });
        return { ok: true, profile };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
    async find(id) {
      const [profile] = await apiDb
        .select({ ...columns, handleChangedAt: profiles.handleChangedAt, verifiedAt: profiles.verifiedAt })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (!profile) return null;
      const { handleChangedAt, verifiedAt, ...pub } = profile;
      // The badge is a fact of the profile row (verified_at), read here so the account screen sees it on /me.
      return { ...pub, handleChangedAt: handleChangedAt?.toISOString() ?? null, verified: verifiedAt !== null };
    },
  };
}
```

### Replace `apps/api/src/social/context.ts` (whole file)

```ts
import type { AuthErrorCode, SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import type { AuthEventType } from "../auth";
import { MediaError, type MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialRepo } from "./repo";

/** The handle codes onboarding answers with, which a handle change raises too, plus its cooldown. */
type HandleErrorCode = Extract<AuthErrorCode, "handle_invalid" | "handle_reserved" | "handle_taken" | "handle_cooldown">;

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | HandleErrorCode | "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type SocialErrorStatus = 400 | 403 | 404 | 409 | 429 | 503;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  handle_taken: "That handle is taken.",
  handle_cooldown: "Handles can change once every 30 days.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited, service_unavailable and handle_cooldown so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export function socialErrorMessage(code: SocialErrorKind): string {
  return MESSAGES[code];
}

/** The account making a request, or null when signed out. Reads accept null; writes never do. */
export type ViewerId = string | null;

/** Posts without images: what the module runs with when no media module is wired, as in the 2a tests. */
export const WITHOUT_MEDIA: MediaForPosts = {
  attach: async (_tx, input) => {
    if (input.items.length > 0) throw new MediaError("media_unavailable", 400);
  },
  detachAll: async () => [],
  requestDeletion: async () => undefined,
  forPosts: async () => new Map(),
};

/** Security events about an account go to the auth module's table; this is its appendEvent, as the server wires it. */
export interface SocialEvents {
  append(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

export interface SocialDeps {
  repo: SocialRepo;
  /** Images on posts. The media module owns them; this module only passes its transaction along. */
  media: MediaForPosts;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
  /** Records profile and handle changes as security events. Absent in the 2a tests, which record nothing. */
  events?: SocialEvents;
}
```

### Replace `apps/api/src/social/flows/profiles.ts` (whole file)

```ts
import type { Pagination, ProfileListItem, ProfilePage, ProfileView } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import type { ProfileListRow, ProfileRow } from "../repo";
import { authorOf, pageCursor } from "../views";

/** A profile by handle (a leading @ is tolerated), or not_found. Does not consider the viewer. */
export async function lookupProfile(deps: SocialDeps, handle: string): Promise<ProfileRow> {
  const profile = await deps.repo.findProfileByHandle(handle.replace(/^@/, ""));
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/** A profile the viewer may see: a block in either direction makes it not_found. */
export async function visibleProfile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileRow> {
  const profile = await lookupProfile(deps, handle);
  if (viewer && viewer !== profile.id && (await deps.repo.blockedEitherWay(viewer, [profile.id])).size > 0) {
    throw new SocialError("not_found", 404);
  }
  return profile;
}

/** The public facts of a profile row, as every viewer sees them; `profile` adds the viewer's relation to someone else's. */
export function profileView(target: ProfileRow): ProfileView {
  return {
    id: target.id,
    handle: target.handle,
    displayName: target.displayName,
    bio: target.bio,
    verified: target.verified,
    createdAt: target.createdAt.toISOString(),
    counts: { posts: target.postCount, followers: target.followerCount, following: target.followingCount },
  };
}

export async function profile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileView> {
  const target = await visibleProfile(deps, viewer, handle);
  const view = profileView(target);
  if (viewer && viewer !== target.id) {
    const relation = await deps.repo.relation(viewer, target.id);
    view.viewer = { following: relation.following, followedBy: relation.followedBy, blocked: relation.blocked, muted: relation.muted };
  }
  return view;
}

/**
 * Turns list rows into profile items for a signed-in viewer, dropping accounts with a block in
 * either direction and marking which ones the viewer follows.
 */
export async function profileItems(deps: SocialDeps, viewer: string, rows: ProfileListRow[]): Promise<ProfileListItem[]> {
  const ids = rows.map((row) => row.profileId);
  const [profiles, blocked, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.blockedEitherWay(viewer, ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (!row || blocked.has(id)) continue;
    items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return items;
}

export async function followers(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.followers(target.id, viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

export async function following(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.following(target.id, viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AppEnv } from "../env";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  return { deps, routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth) };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/limits.ts` (whole file)

```ts
import type { RateLimitStore } from "../middleware/rate-limit";
import { SocialError } from "./context";
import { limitsFor, mayRepostOrQuote, type WriteAction } from "./tiers";

/** Counts one action of the account in a fixed window and refuses it once the window is full. */
export async function enforceAccountLimit(store: RateLimitStore, bucket: string, userId: string, max: number, windowMs: number): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await store.hit(`social:${bucket}:${userId}`, windowMs);
  } catch {
    // Fails closed: a write that cannot be counted is not made, and the client is told to retry shortly.
    throw new SocialError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > max) throw new SocialError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Counts one write for the account in every window its tier gives the action and refuses it once
 * one is full. Reposts and quotes are refused outright while the account is too young. Undo actions
 * never call this.
 */
export async function enforceWriteLimit(
  store: RateLimitStore,
  userId: string,
  action: WriteAction,
  accountCreatedAt: Date,
  now: Date,
): Promise<void> {
  const accountAgeMs = now.getTime() - accountCreatedAt.getTime();
  if ((action === "repost" || action === "quote") && !mayRepostOrQuote(accountAgeMs)) {
    throw new SocialError("account_too_new", 403);
  }
  for (const limit of limitsFor(action, accountAgeMs)) await enforceAccountLimit(store, limit.bucket, userId, limit.max, limit.windowMs);
}
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { isUniqueViolation } from "../auth";
import { SocialError } from "./context";
import type { Cursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" };

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_SELECT = sql`select id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /** Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to delete. `within` runs in the same transaction. */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /** `other` is the post's author when that is someone else: the pair is locked and a block refused inside the transaction. */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
      return inserted.length > 0;
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /** With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a concurrent block. */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => removeFollow(tx, followerId, followeeId));
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
      return inserted.length > 0;
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /** Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile. */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid and deleted_at is null for update`)) as unknown as { handle: string }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
              or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { taken: boolean }[];
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `apps/api/src/social/routes.ts` (whole file)

```ts
import { CreatePostRequest, HandleChangeRequest, HandleParam, Pagination, PostId, ProfileEditRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { MediaError } from "../media";
import { SocialError, type SocialDeps, type ViewerId } from "./context";
import { setEngagement, type EngagementKind } from "./flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "./flows/graph";
import { createPost, deletePost, getPost, thread } from "./flows/posts";
import { changeHandle, editProfile } from "./flows/profile-edit";
import { followers, following, profile } from "./flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "./flows/timelines";

const PostParam = z.object({ id: PostId });
const ProfileParam = z.object({ handle: HandleParam });

/**
 * Every social endpoint, mounted at `/api`. Handlers only validate, call a flow and shape the
 * response. `guard` is the auth module's requireSession: an onboarded account, with CSRF and
 * Origin already checked for cookie sessions. `fresh` is its requireFreshAuth: a credential proven
 * in the last five minutes, which a handle change needs on top.
 */
export function socialRoutes(deps: SocialDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const viewer = (c: Context<AppEnv>): ViewerId => c.get("session")?.userId ?? null;
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.onError((err, c) => {
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // Creating a post attaches its images through the media module, which refuses with its own error type.
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in social route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  // ---------------------------------------------------------------- posts

  r.post("/posts", guard, validate("json", CreatePostRequest), async (c) => c.json(await createPost(deps, me(c), c.req.valid("json")), 201));
  r.get("/posts/:id", validate("param", PostParam), async (c) => c.json(await getPost(deps, viewer(c), c.req.valid("param").id)));
  r.delete("/posts/:id", guard, validate("param", PostParam), async (c) => {
    await deletePost(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  r.get("/posts/:id/thread", validate("param", PostParam), validate("query", Pagination), async (c) =>
    c.json(await thread(deps, viewer(c), c.req.valid("param").id, c.req.valid("query"))),
  );

  for (const kind of ["like", "repost", "bookmark"] as EngagementKind[]) {
    r.post(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, true)));
    r.delete(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, false)));
  }

  // ---------------------------------------------------------------- timelines

  r.get("/timeline/following", guard, validate("query", Pagination), async (c) => c.json(await followingTimeline(deps, me(c), c.req.valid("query"))));
  r.get("/timeline/latest", validate("query", Pagination), async (c) => c.json(await latestTimeline(deps, viewer(c), c.req.valid("query"))));

  // ---------------------------------------------------------------- profiles and graph

  r.get("/profiles/:handle", validate("param", ProfileParam), async (c) => c.json(await profile(deps, viewer(c), c.req.valid("param").handle)));
  r.get("/profiles/:handle/posts", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profilePosts(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/replies", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileReplies(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/followers", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await followers(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/following", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await following(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );

  r.post("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, false)));

  // ---------------------------------------------------------------- the viewer's private lists

  r.get("/me/likes", guard, validate("query", Pagination), async (c) => c.json(await likedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/bookmarks", guard, validate("query", Pagination), async (c) => c.json(await bookmarkedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/blocks", guard, validate("query", Pagination), async (c) => c.json(await blockedList(deps, me(c), c.req.valid("query"))));
  r.get("/me/mutes", guard, validate("query", Pagination), async (c) => c.json(await mutedList(deps, me(c), c.req.valid("query"))));

  // ---------------------------------------------------------------- the viewer's own profile

  r.patch("/me/profile", guard, validate("json", ProfileEditRequest), async (c) => c.json({ profile: await editProfile(deps, me(c), c.req.valid("json")) }));
  r.post("/me/handle", guard, fresh, validate("json", HandleChangeRequest), async (c) => c.json({ profile: await changeHandle(deps, me(c), c.req.valid("json")) }));

  return r;
}
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
packages/contracts test:       Tests  63 passed (63)
packages/db test:       Tests  22 passed (22)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  17 passed (17)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  180 passed | 166 skipped (346)
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
Tests  164 passed (164)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/index.ts`
- `apps/api/src/index.ts`
- `apps/api/src/profiles/store.ts`
- `apps/api/src/social/context.ts`
- `apps/api/src/social/flows/profile-edit.ts`
- `apps/api/src/social/flows/profiles.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/limits.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/src/social/routes.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/integration/http-media.test.ts`
- `apps/api/test/integration/http-profile.test.ts`
- `apps/api/test/integration/http-social.test.ts`
- `apps/api/test/integration/social-flows-profile-edit.test.ts`
- `apps/api/test/integration/social-harness.ts`
- `apps/api/test/social/profile-edit.test.ts`
- `apps/api/test/social/profile-harness.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(social): an account edits its display name and bio and changes its handle once every 30 days, with every handle it ever had reserved for it in handle_history (onboarding writes the first row); the social module records profile_updated and handle_changed events through the auth module" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): an account edits its display name and bio and changes its handle once every 30 days, with every handle it ever had reserved for it in handle_history (onboarding writes the first row); the social module records profile_updated and handle_changed events through the auth module`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 18>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
