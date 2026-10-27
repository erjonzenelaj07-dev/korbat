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
// 3d Task 6: the automated decision's numbers and closed lists. It imports nothing, so every module below can read it.
export * from "./automation";
export * from "./explore";
// 3b Task 1: the import's contracts and numbers. It imports only ./media and ./text, so the modules that name ImportSource
// (social.ts, moderation.ts, staff.ts, account.ts) can read it while they load.
export * from "./imports";
export * from "./media";
// Evaluated before ./staff, and importing nothing from it: staff.ts can read this module's constants while it loads.
export * from "./moderation";
// 3f: imports nothing from the other modules, so moderation.ts can read its constants while it loads.
export * from "./orders";
export * from "./passkeys";
export * from "./social";
export * from "./staff";
export * from "./text";
// 3d Task 4: the public figures. It reads moderation.ts and orders.ts for closed lists, and nothing reads it.
export * from "./transparency";
