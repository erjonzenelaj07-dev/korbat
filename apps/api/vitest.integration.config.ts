import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./test/integration/test-env";

/**
 * Integration tests run against the Compose data services, in their own database (`korbat_test`)
 * and their own Redis database. The environment comes from apps/api/.env.test, which
 * `node scripts/gen-dev-env.mjs` derives from apps/api/.env, so nothing has to be sourced into the
 * shell first. The INTEGRATION flag is set here rather than in the npm script, because `VAR=1 cmd`
 * does not work in cmd.exe, which pnpm uses to run scripts on Windows.
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    env: { ...loadTestEnv(), INTEGRATION: "1" },
    globalSetup: ["test/integration/global-setup.ts"],
    setupFiles: ["test/integration/setup.ts"],
  },
});
