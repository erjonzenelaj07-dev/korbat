import { defineConfig } from "vitest/config";

/**
 * Integration tests run against the Compose data services. The INTEGRATION flag
 * is set here rather than in the npm script, because `VAR=1 cmd` does not work
 * in cmd.exe, which pnpm uses to run scripts on Windows.
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    env: { INTEGRATION: "1" },
  },
});
