import { describe, expect, test } from "vitest";
import { R1_MARKER, R1_TEST_MODEL } from "@korbat/media-protocol";
import { scorerFrom, testScorer } from "../src/score";

/**
 * The R1 scorer's seam (3d design, sections 5 "The adapters" and 12.1 row 12): off scores nothing, and the test scorer
 * answers 1 for the fixtures' marker in the top left corner and 0 for every other image, from raw pixels alone.
 */
describe("the scorer's seam", () => {
  const pixels = (width: number, height: number, marked: boolean, channels = 3) => {
    const data = new Uint8Array(width * height * channels).fill(90);
    if (marked) {
      for (let y = 0; y < R1_MARKER.side; y++) {
        for (let x = 0; x < R1_MARKER.side; x++) data.set([R1_MARKER.red, R1_MARKER.green, R1_MARKER.blue], (y * width + x) * channels);
      }
    }
    return data;
  };

  test("off is no scorer, and test is the marker's scorer under the test model's name", () => {
    expect(scorerFrom("off")).toBeNull();
    expect(scorerFrom("test")).toBe(testScorer);
    expect(testScorer.model).toBe(R1_TEST_MODEL);
  });

  test("the test scorer answers 1 for the marker and 0 otherwise, with three channels or four", async () => {
    expect(await testScorer.score(pixels(300, 200, true), 300, 200, 3)).toBe(1);
    expect(await testScorer.score(pixels(300, 200, true, 4), 300, 200, 4)).toBe(1);
    expect(await testScorer.score(pixels(300, 200, false), 300, 200, 3)).toBe(0);
    expect(await testScorer.score(pixels(300, 200, false, 4), 300, 200, 4)).toBe(0);
  });
});
