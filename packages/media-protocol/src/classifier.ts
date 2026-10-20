/**
 * The R1 classifier's identity (3d design, sections 2 rows 23 and 50, 5 "The adapters" and 10.2; Task 6), shared by the
 * worker, which writes the name into each result, and the API, whose finalize keeps a score only from the model its own
 * setting names, and whose facts route prints the name and the digest of a classifier that is built in.
 *
 * No build of 3d carries the classifier: R1_CLASSIFIER=onnx stops the worker and the API at start ("no such adapter in
 * this build") until the owner's later task adds the runtime and the weights. So the digest of the weights is null here:
 * the research read the file's size and the two ends of its SHA-256, not the whole, and nothing may be fetched to read it.
 * That task pins the digest, which the worker then checks at start against the file it loads.
 */
export const R1_MODEL = {
  /** The model the research named (Marqo/nsfw-image-detection-384, through ICIJ's ONNX export), as a result writes it. */
  name: "marqo/nsfw-image-detection-384",
  /** The weights file's size in bytes, as the research read it. */
  bytes: 22_450_955,
  /** The hex SHA-256 of the weights file, pinned by the task that builds the classifier; null in this build. */
  sha256: null as string | null,
} as const;

/** The test scorer's name, as a result written under R1_CLASSIFIER=test carries it: never a real model's. */
export const R1_TEST_MODEL = "korbat-test-marker";

/** A model's name as a result may carry it: at most 64 characters of lower-case letters, digits and . _ / - (10.2). */
export const R1_MODEL_NAME = /^[a-z0-9._/-]{1,64}$/;
