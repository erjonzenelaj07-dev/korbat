import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./test/integration/test-env";

/**
 * The labs under test/lab: measurements against the test database, run by hand and never by a suite (their files end
 * in .lab.ts, which no other configuration includes). See test/lab/README.md.
 */
export default defineConfig({
  test: {
    include: ["test/lab/**/*.lab.ts"],
    fileParallelism: false,
    env: { ...loadTestEnv(), INTEGRATION: "1" },
    testTimeout: 1_800_000,
    hookTimeout: 600_000,
  },
});
