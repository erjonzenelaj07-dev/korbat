import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding, type StaffMe, type StaffStepUpOptionsRequest } from "@korbat/contracts";
import type { Clock } from "../src/idle";

/**
 * What the console's tests share: hostile strings of the kind a staff member's handle, key name or browser label could
 * carry if the API were ever made to echo them, a session as /me describes it, a clock the tests move by hand, a fake
 * fetch that records every request, and step-up challenges built from the contracts' layout.
 */

// Built from char codes: a right-to-left override, which would reorder the text after it if it were not isolated.
const RLO = String.fromCharCode(0x202e);

export const HOSTILE = {
  script: "<script>alert(1)</script>",
  img: "<img src=x onerror=alert(2)>",
  url: "javascript:alert(3)",
  quote: '"><svg onload=alert(4)>',
  bidi: `${RLO}gnp.exe`,
  long: "W".repeat(50),
} as const;

/** The same strings as React writes them into HTML text: escaped, never markup. */
export const HOSTILE_ESCAPED = {
  script: "&lt;script&gt;alert(1)&lt;/script&gt;",
  img: "&lt;img src=x onerror=alert(2)&gt;",
  quote: "&quot;&gt;&lt;svg onload=alert(4)&gt;",
} as const;

/** The only addresses the console links to by name; none is built from data. A case's address is built from a checked id (CASE_PATH). */
export const CONSOLE_PATHS = ["/", "/audit", "/signin", "/queue", "/appeals", "/standing", "/contact"];

/** A case's address in the console: the one address built from a value, and only from a lower-case uuid. */
export const CASE_PATH = /^\/cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every href attribute in rendered HTML. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
}

/** Every tag name in rendered HTML, lower-cased. */
export function tags(html: string): Set<string> {
  return new Set([...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]!.toLowerCase()));
}

export const SESSION_HANDLE = "2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
export const OTHER_SESSION = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";

/** A session as GET /api/staff/me answers it, `idle` and `absolute` seconds from its end, counted from `at`. */
export function makeMe(options: { idle?: number; absolute?: number; at?: number; handle?: string; sessionHandle?: string } = {}): StaffMe {
  const at = options.at ?? Date.parse("2026-10-01T09:00:00.000Z");
  const idle = options.idle ?? 900;
  const absolute = options.absolute ?? 43_200;
  return {
    handle: options.handle ?? "mod_anna",
    role: "moderator",
    sessionHandle: options.sessionHandle ?? SESSION_HANDLE,
    idleExpiresAt: new Date(at + idle * 1000).toISOString(),
    idleSecondsLeft: idle,
    absoluteExpiresAt: new Date(at + absolute * 1000).toISOString(),
    absoluteSecondsLeft: absolute,
  };
}

/** A clock the test moves: timers fire in order of their time, and the promises they start settle before the next one. */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: { at: number; id: number; callback: () => void }[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), id, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** How many timers are waiting. */
  get pending(): number {
    return this.timers.length;
  }

  /** Moves the clock by `ms`, firing every timer due on the way and letting what each one started settle. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.callback();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

/** Lets every pending promise, a fetch's body included, settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = { status: number; body?: unknown } | (() => { status: number; body?: unknown });

/**
 * A fetch that answers from a table of `METHOD path` keys (the path with its query) and records every request. A key
 * may hold a list of answers, given one per request, the last one repeated.
 */
export function fakeFetch(table: Record<string, Answer | Answer[]>) {
  const requests: Recorded[] = [];
  const used = new Map<string, number>();
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    requests.push({ method, url: input, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const key = `${method} ${input}`;
    const entry = table[key];
    if (entry === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404, headers: { "content-type": "application/json" } });
    const list = Array.isArray(entry) ? entry : [entry];
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const pick = list[Math.min(index, list.length - 1)]!;
    const answer = typeof pick === "function" ? pick() : pick;
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

/** An error envelope as the API writes it. */
export const envelope = (code: string, message = "the server's own words") => ({ error: { code, message, requestId: "req-1" } });

/** The step-up action that revokes `target`, as the console sends it. */
export const revokeAction = (target: string): StaffStepUpOptionsRequest => ({ action: "staff_session_revoked", target: { type: "staff_session", id: target }, params: {} });

/**
 * A step-up challenge in the contracts' layout: its version and purpose bytes, an expiry, a nonce, the binding of
 * `sessionHandle` and the action's hash, and a seal the console cannot check. `bytes` cuts or pads it to another length.
 */
export async function stepUpChallenge(
  sessionHandle: string,
  action: { action: string; target: { type: string; id: string }; params: Record<string, unknown> },
  options: { purpose?: number; version?: number; bytes?: number } = {},
): Promise<string> {
  const c = STAFF_STEP_UP_CHALLENGE;
  const bytes = Buffer.alloc(c.bytes, 7);
  bytes[c.versionAt] = options.version ?? c.version;
  bytes[c.purposeAt] = options.purpose ?? c.purpose;
  bytes.writeBigUInt64BE(BigInt(Date.parse("2026-10-01T09:10:00.000Z")), c.expiryAt);
  Buffer.from(await stepUpBinding(sessionHandle, await stepUpActionHash(action))).copy(bytes, c.bindingAt);
  const sized = options.bytes === undefined ? bytes : Buffer.concat([bytes, Buffer.alloc(Math.max(0, options.bytes - c.bytes), 1)]).subarray(0, options.bytes);
  return sized.toString("base64url");
}

/**
 * A challenge in the other ceremonies' 58-byte layout (the contracts' CEREMONY_CHALLENGE): a staff sign-in's unless told
 * another purpose, with a zero binding unless given one, and a seal the console cannot check. `bytes` cuts or pads it.
 */
export function ceremonyChallenge(options: { purpose?: number; version?: number; binding?: Buffer; bytes?: number } = {}): string {
  const c = CEREMONY_CHALLENGE;
  const bytes = Buffer.alloc(c.bytes, 7);
  bytes[c.versionAt] = options.version ?? c.version;
  bytes[c.purposeAt] = options.purpose ?? CHALLENGE_PURPOSES.staff_signin;
  bytes.writeBigUInt64BE(BigInt(Date.parse("2026-10-01T09:10:00.000Z")), c.expiryAt);
  (options.binding ?? Buffer.alloc(c.bindingBytes)).copy(bytes, c.bindingAt);
  const sized = options.bytes === undefined ? bytes : Buffer.concat([bytes, Buffer.alloc(Math.max(0, options.bytes - c.bytes), 1)]).subarray(0, options.bytes);
  return sized.toString("base64url");
}

/** A staff registration's challenge, bound (as the API binds it) to an enrolment's id the page is never told. */
export const registerChallenge = () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.staff_register, binding: Buffer.alloc(16, 0x5e) });

/** Sign-in options as the API writes them: a staff sign-in challenge, user verification and an empty allow list. */
export function signInOptions(challenge: string = ceremonyChallenge()) {
  return { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } };
}

/** Step-up options as the API writes them: the challenge, the console's relying party, user verification and an allow list. */
export function stepUpOptions(challenge: string, allow: string[] = ["Y3JlZGVudGlhbC0x"]) {
  return {
    options: {
      challenge,
      rpId: "localhost",
      timeout: 300_000,
      userVerification: "required",
      allowCredentials: allow.map((id) => ({ id, type: "public-key", transports: ["usb"] })),
    },
  };
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** What navigator.credentials.get resolves with, as far as the console reads it. */
export function fakeAssertion(id = "Y3JlZGVudGlhbC0x") {
  return {
    id,
    rawId: Uint8Array.from(Buffer.from(id, "base64url")).buffer,
    type: "public-key",
    authenticatorAttachment: "cross-platform",
    response: {
      clientDataJSON: bytesOf('{"type":"webauthn.get"}'),
      authenticatorData: bytesOf("authenticator-data"),
      signature: bytesOf("signature"),
      userHandle: bytesOf("user-handle"),
    },
    getClientExtensionResults: () => ({}),
  };
}

/** What navigator.credentials.create resolves with, as far as the console reads it. */
export function fakeAttestation(id = "bmV3LWtleQ") {
  return {
    id,
    rawId: Uint8Array.from(Buffer.from(id, "base64url")).buffer,
    type: "public-key",
    authenticatorAttachment: null,
    response: {
      clientDataJSON: bytesOf('{"type":"webauthn.create"}'),
      attestationObject: bytesOf("attestation-object"),
      getTransports: () => ["usb", "nfc"],
    },
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
  };
}

/** A credentials container that records what it was asked and answers with `answer`. */
export function fakeCredentials(answer: { create?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
  const calls: { kind: "create" | "get"; options: unknown }[] = [];
  return {
    calls,
    create: async (options: unknown) => {
      calls.push({ kind: "create", options });
      return (answer.create ?? (async () => fakeAttestation()))();
    },
    get: async (options: unknown) => {
      calls.push({ kind: "get", options });
      return (answer.get ?? (async () => fakeAssertion()))();
    },
  };
}

/** Registration options as the API writes them for an enrolment; `challenge` replaces the staff registration's own. */
export function enrollOptions(rpShared: boolean, challenge: string = registerChallenge()) {
  return {
    options: {
      challenge,
      rp: { id: "localhost", name: "korbat" },
      user: { id: Buffer.alloc(32, 9).toString("base64url"), name: "Blue key", displayName: "Blue key" },
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      timeout: 300_000,
      attestation: "none",
      excludeCredentials: [{ id: "b2xkLWtleQ", type: "public-key", transports: ["usb"] }],
      authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true },
      extensions: { credProps: true },
      hints: ["security-key"],
    },
    rpShared,
  };
}
