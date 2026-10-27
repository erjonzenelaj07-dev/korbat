import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** import-archives, which this process may only read (mounted read-only). */
  IMPORT_ARCHIVES_DIR: z.string().min(1),
  /** import-work, the only place this process writes. */
  IMPORT_WORK_DIR: z.string().min(1),
});

/** The refusal of a configuration: "Invalid environment:" and what is wrong, on a line of its own. */
const invalid = (message: string) => new Error(["Invalid environment:", message].join(String.fromCharCode(10)));

export interface Config {
  production: boolean;
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
  archivesDir: string;
  workDir: string;
}

/**
 * The importer's whole configuration (3b design, 7.1): two directories, a log level and the environment's name. It has
 * no database URL, no Valkey URL and no secret, by design: the one secret it holds is each job's account key, which
 * job.json brings and which leaves the process only as the keys of posts.jsonl.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw invalid(z.prettifyError(result.error));
  return {
    production: result.data.NODE_ENV === "production",
    logLevel: result.data.LOG_LEVEL,
    archivesDir: result.data.IMPORT_ARCHIVES_DIR,
    workDir: result.data.IMPORT_WORK_DIR,
  };
}
