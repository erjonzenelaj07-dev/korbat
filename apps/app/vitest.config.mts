import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets. `@/` is the app's source folder, as tsconfig.json's
 * paths say, so a test can load a screen that imports its components that way. A file's `.web`
 * twin is found before the file itself, as Metro finds it for the web build (Icon.web.tsx before
 * Icon.tsx), followed by Vite's own default list. test/setup.ts mocks, once for every file, the
 * native modules that never load in Node (Reanimated, gesture-handler, safe-area-context,
 * expo-haptics, expo-router/head, lucide-react-native).
 */
export default defineConfig({
  resolve: {
    extensions: [".web.tsx", ".web.ts", ".web.js", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["./test/setup.ts"] },
});
