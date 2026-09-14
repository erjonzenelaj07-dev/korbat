import type { ErrorEnvelope } from "@korbat/contracts";

export function errorBody(code: string, message: string, requestId?: string, details?: unknown): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}
