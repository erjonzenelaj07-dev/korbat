import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets. `@/` is the app's source folder, as tsconfig.json's
 * paths say, so a test can load a screen that imports its components that way.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
});
