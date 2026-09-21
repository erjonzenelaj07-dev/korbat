import { defineConfig } from "vitest/config";

/**
 * The pipeline tests run the real decoder on fixtures they make themselves, some of them near the
 * pixel caps, so they get a longer timeout. VIPS_BLOCK_UNTRUSTED is set as in the container.
 */
export default defineConfig({
  test: { testTimeout: 60_000, env: { VIPS_BLOCK_UNTRUSTED: "1" } },
});
