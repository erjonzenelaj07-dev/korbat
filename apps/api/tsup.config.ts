import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", migrate: "src/migrate.ts", "grant-role": "src/cli/grant-role.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  // Everything is bundled except @node-rs/argon2: it loads a platform-specific native binary at
  // runtime, so the Docker image ships it in node_modules next to the bundle.
  noExternal: [/^(?!@node-rs\/argon2(?:\/|$))/],
  external: ["@node-rs/argon2"],
  sourcemap: true,
  clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
