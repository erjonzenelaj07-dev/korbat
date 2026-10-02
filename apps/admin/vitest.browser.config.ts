import { defineConfig } from "vitest/config";

/**
 * The console's browser check (`pnpm --filter @korbat/admin test:browser`, 3a design, section 12): one walk through every
 * screen in Chromium, driven by playwright-core. It is kept apart from the unit tests because it builds the console and
 * starts a browser. Its steps share one page and run in order. The page shows times in the browser's time zone, which the
 * walk sets to UTC, as this sets the tests' own.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/browser/**/*.browser.ts"],
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
