import { zValidator, type Hook } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z, type ZodType } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "./errors";

/**
 * zod validation for a request target that answers failures with the shared
 * error envelope instead of Hono's default body. The handler reads the parsed
 * value with c.req.valid(target).
 */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  const onInvalid: Hook<z.infer<T>, AppEnv, string, Target, {}, T> = (result, c) => {
    if (!result.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(result.error)), 400);
    }
    return undefined;
  };
  return zValidator<T, Target, AppEnv, string, typeof onInvalid>(target, schema, onInvalid);
}
