import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./account";
export * from "./auth";
export * from "./media";
export * from "./social";
export * from "./text";
