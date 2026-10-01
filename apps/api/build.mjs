// Bundles the API for the Docker image. esbuild is called directly: the whole configuration fits here.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  // Each entry is a bundle of its own. The command lines check that they were run directly by comparing import.meta.url,
  // which in a bundle is the bundle's, so no entry may import another entry's file.
  entryPoints: { index: "src/index.ts", migrate: "src/migrate.ts", "grant-role": "src/cli/grant-role.ts", staff: "src/cli/staff.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  // Everything is bundled except @node-rs/argon2: it loads a platform-specific native binary at
  // runtime, so the Docker image ships it in node_modules next to the bundle.
  packages: "bundle",
  external: ["@node-rs/argon2", "@node-rs/argon2/*"],
  // Bundled CommonJS dependencies call require(); an ES module bundle has to provide it. The import is
  // aliased because esbuild cannot rename a banner's names, and a bundled ES module (fflate) imports
  // createRequire itself at top level: with the plain name the bundle declares it twice and Node refuses to load it.
  banner: { js: "import { createRequire as createRequireForBundle } from 'node:module'; const require = createRequireForBundle(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
