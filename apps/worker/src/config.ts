import { z } from "zod";
import { parseFormats, type MediaFormat } from "@korbat/media-protocol";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** The uploads volume, which this process may only read. */
  MEDIA_UPLOADS_DIR: z.string().min(1),
  /** The store volume, the only place this process writes. */
  MEDIA_STORE_DIR: z.string().min(1),
  MEDIA_FORMATS: z.string().optional(),
  VIPS_BLOCK_UNTRUSTED: z.string().optional(),
});

export interface Config {
  production: boolean;
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
  uploadsDir: string;
  storeDir: string;
  formats: MediaFormat[];
}

/**
 * The worker's whole configuration: two directories, the enabled formats and a log level. It has
 * no database URL, no Redis URL and no keys, by design. libvips reads VIPS_BLOCK_UNTRUSTED when it
 * loads, so it has to be in the environment before the process starts; production refuses to run
 * without it.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  const production = result.data.NODE_ENV === "production";
  if (production && result.data.VIPS_BLOCK_UNTRUSTED === undefined) {
    throw new Error("Invalid environment:\nVIPS_BLOCK_UNTRUSTED must be set before the worker starts");
  }
  return {
    production,
    logLevel: result.data.LOG_LEVEL,
    uploadsDir: result.data.MEDIA_UPLOADS_DIR,
    storeDir: result.data.MEDIA_STORE_DIR,
    formats: parseFormats(result.data.MEDIA_FORMATS),
  };
}
