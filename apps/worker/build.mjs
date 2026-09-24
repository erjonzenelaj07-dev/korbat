// Bundles the image worker for the Docker image. esbuild is called directly: the whole configuration fits here.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  // Everything is bundled except sharp: it loads a platform-specific native binary at runtime, so
  // the Docker image ships it and its platform packages in node_modules next to the bundle.
  packages: "bundle",
  external: ["sharp", "sharp/*", "@img/*"],
  // Bundled CommonJS dependencies call require(); an ES module bundle has to provide it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
