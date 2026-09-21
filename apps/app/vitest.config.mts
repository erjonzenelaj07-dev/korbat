import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets.
 */
export default defineConfig({
  resolve: { alias: [{ find: /^react-native$/, replacement: "react-native-web" }] },
  test: { environment: "node", include: ["test/**/*.test.tsx"] },
});
