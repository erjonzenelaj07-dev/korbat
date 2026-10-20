import { z } from "zod";
import { parseFormats, type MediaFormat } from "@korbat/media-protocol";

/** A blank value, as Compose passes an unset variable, counts as unset. */
const blankAsUnset = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** The uploads volume, which this process may only read. */
  MEDIA_UPLOADS_DIR: z.string().min(1),
  /** The store volume, the only place this process writes. */
  MEDIA_STORE_DIR: z.string().min(1),
  MEDIA_FORMATS: z.string().optional(),
  VIPS_BLOCK_UNTRUSTED: z.string().optional(),
  /**
   * 3d Task 6 (design, sections 5 "The adapters" and 10.8): the R1 scorer. `off` (the default) scores nothing; `test`
   * answers 1 for the fixtures' marker and 0 otherwise; `onnx` is the real classifier, which this build does not carry.
   */
  R1_CLASSIFIER: blankAsUnset.pipe(z.enum(["off", "test", "onnx"]).default("off")),
  /** Caddy's switch of the app's site (3f), handed to the worker only so that a test adapter never runs on an open site. */
  APP_SITE: blankAsUnset.pipe(z.enum(["open", "closed"]).default("open")),
});

/** The refusal of a configuration: "Invalid environment:" and what is wrong, on a line of its own. */
const invalid = (message: string) => new Error(["Invalid environment:", message].join(String.fromCharCode(10)));

export interface Config {
  production: boolean;
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
  uploadsDir: string;
  storeDir: string;
  formats: MediaFormat[];
  /** 3d Task 6: the scorer this process runs; never a test scorer on an open site, and never one this build lacks. */
  r1Classifier: "off" | "test";
}

/**
 * The worker's whole configuration: two directories, the enabled formats, a log level and (3d) the scorer's setting with
 * the site's switch. It has no database URL, no Redis URL and no keys, by design. libvips reads VIPS_BLOCK_UNTRUSTED when
 * it loads, so it has to be in the environment before the process starts; production refuses to run without it.
 *
 * 3d (design, section 5, review ruling 11): in every environment, a test adapter is refused while APP_SITE is open, so
 * a stand-in never answers for a real classifier on a site people can reach; and `onnx` stops the process, since no
 * classifier is built in.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw invalid(z.prettifyError(result.error));
  const production = result.data.NODE_ENV === "production";
  if (production && result.data.VIPS_BLOCK_UNTRUSTED === undefined) {
    throw invalid("VIPS_BLOCK_UNTRUSTED must be set before the worker starts");
  }
  const classifier = result.data.R1_CLASSIFIER;
  if (classifier === "onnx") throw invalid("R1_CLASSIFIER=onnx: no such adapter in this build; set R1_CLASSIFIER=off");
  if (classifier === "test" && result.data.APP_SITE === "open") {
    throw invalid("R1_CLASSIFIER=test is refused while APP_SITE is open: a test adapter answers only on a site that is closed");
  }
  return {
    production,
    logLevel: result.data.LOG_LEVEL,
    uploadsDir: result.data.MEDIA_UPLOADS_DIR,
    storeDir: result.data.MEDIA_STORE_DIR,
    formats: parseFormats(result.data.MEDIA_FORMATS),
    r1Classifier: classifier,
  };
}
