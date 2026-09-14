import { randomInt } from "node:crypto";
import type { EmailStartRequest, EmailVerifyRequest } from "@korbat/contracts";
import { MailUnavailable } from "../../mail/mailer";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { hmacHex, randomToken, safeEqual } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { EmailCodeRow } from "../repo";
import { firstFactorPassed, type DeviceInput, type MfaPending, type SignedIn } from "./signin";

export const CODE_TTL_MS = 10 * MINUTE;
export const MAX_CODE_ATTEMPTS = 5;
export const MIN_START_RESPONSE_MS = 400;

export const flowKey = (flowId: string) => `flow:${flowId}`;
export const signupKey = (flowId: string) => `signup:${flowId}`;
export const ageBlockKey = (emailHashValue: string) => `age-block:${emailHashValue}`;

export interface PendingSignup extends DeviceInput {
  email: string;
}

export function newEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function emailCodeHash(key: Buffer, flowId: string, code: string): string {
  return hmacHex(key, `email-code:${flowId}:${code}`);
}

export async function sendCode(deps: AuthDeps, message: Parameters<AuthDeps["mailer"]["send"]>[0]): Promise<void> {
  try {
    await deps.mailer.send(message);
  } catch (err) {
    if (err instanceof MailUnavailable) throw new AuthError("mail_unavailable", 503);
    throw err;
  }
}

/**
 * Checks a code against its stored row: not consumed, not expired, within the attempt limit, equal.
 * Consumes it on success so it can never be used again.
 */
export async function checkEmailCode(deps: AuthDeps, row: EmailCodeRow | undefined, flowId: string, code: string): Promise<EmailCodeRow> {
  if (!row || row.consumedAt) throw new AuthError("invalid_code", 400);
  if (row.expiresAt.getTime() <= deps.now().getTime()) throw new AuthError("code_expired", 400);
  const attempts = await deps.repo.addCodeAttempt(row.id);
  if (attempts > MAX_CODE_ATTEMPTS) throw new AuthError("too_many_attempts", 429);
  if (!safeEqual(row.codeHash, emailCodeHash(deps.config.authHmacKey, flowId, code))) throw new AuthError("invalid_code", 400);
  if (!(await deps.repo.consumeEmailCode(row.id, deps.now()))) throw new AuthError("invalid_code", 400);
  return row;
}

/**
 * The single entry point for sign-up and sign-in. The response is identical whether or not the
 * email has an account, and always takes at least MIN_START_RESPONSE_MS.
 */
export async function startEmail(deps: AuthDeps, input: EmailStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const startedAt = Date.now();
  try {
    if (!(await deps.turnstile.verify(input.turnstileToken))) throw new AuthError("turnstile_failed", 403);
    if (isDisposableEmail(input.email)) throw new AuthError("disposable_email", 400);
    const hashedEmail = emailHash(deps.config.authHmacKey, input.email);
    if (await deps.kv.get(ageBlockKey(hashedEmail))) throw new AuthError("age_requirement", 403);

    await enforceLimit(deps.kv, `email-start:ip:${ctx.ipHash}`, 10, HOUR);
    if (!(await deps.kv.setIfAbsent(`email-cooldown:${hashedEmail}`, "1", MINUTE))) throw new AuthError("rate_limited", 429);
    await enforceLimit(deps.kv, `email-start:email:${hashedEmail}`, 3, HOUR);

    const user = await deps.repo.findUserByEmail(input.email);
    const flowId = randomToken();
    const code = newEmailCode();
    await deps.repo.createEmailCode({
      flowId,
      email: input.email,
      userId: user?.id ?? null,
      purpose: user ? "login" : "signup",
      codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
      expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
      ipHash: ctx.ipHash,
    });
    const device: DeviceInput = { deviceId: input.deviceId, platform: input.platform };
    await deps.kv.set(flowKey(flowId), JSON.stringify(device), CODE_TTL_MS);
    await sendCode(deps, { to: input.email, template: user ? "sign_in_code" : "sign_up_code", data: { code } });
    return { flowId };
  } finally {
    await padResponseTime(startedAt, MIN_START_RESPONSE_MS);
  }
}

/** Verifies a sign-in or sign-up code. Sign-up codes lead to `signup_required`; sign-in codes to a session or MFA. */
export async function verifyEmail(
  deps: AuthDeps,
  input: EmailVerifyRequest,
  ctx: RequestContext,
): Promise<SignedIn | MfaPending | { kind: "signup_required" }> {
  await enforceLimit(deps.kv, `email-verify:ip:${ctx.ipHash}`, 30, HOUR);
  const row = await deps.repo.findEmailCode(input.flowId);
  if (row?.purpose !== "login" && row?.purpose !== "signup") throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);

  const device = await deps.kv.get(flowKey(input.flowId));
  if (!device) throw new AuthError("code_expired", 400);
  const parsed = JSON.parse(device) as DeviceInput;

  if (row.purpose === "signup") {
    const pending: PendingSignup = { email: row.email, ...parsed };
    await deps.kv.set(signupKey(input.flowId), JSON.stringify(pending), CODE_TTL_MS);
    return { kind: "signup_required" };
  }

  const user = row.userId ? await deps.repo.findUserById(row.userId) : undefined;
  if (!user) throw new AuthError("invalid_code", 400);
  return firstFactorPassed(deps, user, parsed, ctx);
}
