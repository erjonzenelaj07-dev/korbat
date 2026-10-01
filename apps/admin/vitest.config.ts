import { defineConfig } from "vitest/config";

/**
 * The console's tests run in Node: screens are server-rendered with react-dom/server, the page's logic is called with a
 * fake fetch and a clock the test moves, and the build and the development server run for real on temporary folders.
 * Times are shown in the browser's time zone, so the tests fix one.
 */
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"], env: { TZ: "UTC" } },
});
