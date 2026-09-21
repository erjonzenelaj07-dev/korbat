import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  // Everything is bundled except sharp: it loads a platform-specific native binary at runtime, so
  // the Docker image ships it and its platform packages in node_modules next to the bundle.
  noExternal: [/^(?!sharp(?:\/|$)|@img\/)/],
  external: ["sharp"],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
