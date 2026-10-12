import pino, { type Logger, type LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";

export type { Logger };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Full form, compressed form with "::", and leading "::" form. Requires "::" or 8 groups so times like 10:30:45 are untouched.
const IPV6 = /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})/gi;
// phone, and to (the field Vonage takes the number in, and the mailer its address), keep a phone number out of every log line (1b design, section 10).
const SECRET_KEYS = new Set(["authorization", "cookie", "set-cookie", "password", "token", "secret", "session", "code", "otp", "phone", "to"]);

/**
 * A failed query as drizzle-orm wraps the driver's error: its message is "Failed query: <statement>", a line feed, and
 * "params: " with every parameter of the statement. Those are what a request wrote (a staff text with its salt, a
 * notifier's explanation, an account id), and they must not outlive their erasure in a log (3c design, section 11,
 * Privacy). Such an error is logged by its statement, and by the code, the constraint and the message of the database's
 * own error, which name no value; its stack keeps its frames.
 */
const FAILED_QUERY = "Failed query: ";
const PARAMS_FROM = String.fromCharCode(10) + "params: ";

function failedQuery(err: Error): Record<string, unknown> | null {
  const at = err.message.indexOf(PARAMS_FROM);
  if (!err.message.startsWith(FAILED_QUERY) || at === -1) return null;
  const message = err.message.slice(0, at);
  // The frames are the stack's last lines that start with "at": the message above them, parameters included, is dropped.
  const lines = (err.stack ?? "").split(String.fromCharCode(10));
  let first = lines.length;
  while (first > 0 && lines[first - 1]!.trimStart().startsWith("at ")) first--;
  const stack = [`${err.name}: ${message}`, ...lines.slice(first)].join(String.fromCharCode(10));
  const cause = (err as { cause?: unknown }).cause;
  const db = cause && typeof cause === "object" ? (cause as { code?: unknown; constraint_name?: unknown; message?: unknown }) : null;
  return {
    name: err.name,
    message: scrub(message),
    stack: scrub(stack),
    ...(typeof db?.code === "string" ? { code: db.code } : {}),
    ...(typeof db?.constraint_name === "string" ? { constraint: db.constraint_name } : {}),
    ...(typeof db?.message === "string" ? { cause: scrub(db.message) } : {}),
  };
}

/** Recursively masks emails, IPs, and secret-bearing keys, and a failed query's parameters. Applied to every log line. */
export function scrub(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.has(key.toLowerCase())) return "[redacted]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(IPV6, "[ip]").replace(IPV4, "[ip]");
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object" && !(value instanceof Error)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
    return out;
  }
  if (value instanceof Error) return failedQuery(value) ?? { name: value.name, message: scrub(value.message), stack: value.stack === undefined ? undefined : scrub(value.stack) };
  return value;
}

export function createLogger(level: string, pretty = false): Logger {
  const options: LoggerOptions = {
    level,
    base: undefined,
    formatters: { log: (obj) => scrub(obj) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === "string" ? scrub(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  };
  // pino-pretty is used as an in-process stream, not a transport: transports spawn a
  // worker thread that needs __dirname, which does not exist inside the bundle.
  return pretty ? pino(options, pinoPretty({ colorize: true })) : pino(options);
}
