import { defineConfig } from "vitest/config";

/**
 * The app's browser check (`pnpm --filter @korbat/app test:browser`, UI design, section 12.3, decision 20): one walk
 * through the app's screens in Chromium, driven by playwright-core, against the app's own web export served as Caddy
 * serves it and a fixture API in the same Node process. It is kept apart from the unit tests because it builds the export
 * and starts a browser; its steps share one browser and run in order. It needs no stack and no internet, and it never
 * downloads a browser. Times are shown in UTC, as the walk's browser context sets them.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/browser/**/*.browser.ts"],
    env: { TZ: "UTC" },
    testTimeout: 120_000,
    // One more try for a step that raced the app's render on a loaded machine; a step that fails for its own reason fails twice.
    retry: 1,
    // The export runs once per walk, before the first step, and takes a few minutes on a busy machine.
    hookTimeout: 600_000,
  },
});
