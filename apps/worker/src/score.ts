import { R1_TEST_MODEL, carriesR1Marker } from "@korbat/media-protocol";

/**
 * The R1 scorer's seam (3d design, sections 2 rows 19 and 23, 5 "The adapters" and 10.2; Task 6). One interface, chosen by
 * R1_CLASSIFIER when the process starts: `off` (the default) scores nothing, so no score is written and R1 stays
 * report-driven; `test` is the deterministic stand-in of the suites, refused on an open site (config.ts); `onnx`, the real
 * classifier, is not built: it stops the worker at start until the owner's later task adds the runtime and the weights.
 *
 * A scorer is given the small size's raw sRGB pixels that the pipeline already holds, with their three or four channels,
 * and nothing else: no file, no name, no network. It answers a score from 0 to 1, or null for none. It never imports the
 * decoder: only pipeline.ts does.
 */
export interface Scorer {
  /** The model's name as the result file writes it, which the API holds to its own setting. */
  readonly model: string;
  score(pixels: Uint8Array, width: number, height: number, channels: number): Promise<number | null>;
}

/** The test scorer: 1 for an image whose top left corner carries the marker of @korbat/media-protocol's fixtures, else 0. */
export const testScorer: Scorer = {
  model: R1_TEST_MODEL,
  score: async (pixels, width, height, channels) => (carriesR1Marker(pixels, width, height, channels) ? 1 : 0),
};

/** The scorer of the setting: none while it is off. The configuration refused every other value before this is asked. */
export function scorerFrom(setting: "off" | "test"): Scorer | null {
  return setting === "test" ? testScorer : null;
}
