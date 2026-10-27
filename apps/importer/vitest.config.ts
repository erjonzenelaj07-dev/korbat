import { defineConfig } from "vitest/config";

/**
 * The importer's unit tests build every archive they read in code (3b design, section 12.1), some of them a few
 * megabytes, so they get a longer timeout. The labs (test/lab/*.lab.ts) are measurements, run by hand through
 * vitest.lab.config.ts and never here.
 */
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
