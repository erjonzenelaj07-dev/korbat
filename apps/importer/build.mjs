// Bundles the importer for the Docker image. esbuild is called directly: the whole configuration fits here.
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
  // Everything is bundled: the importer has no native module, so the image holds dist/ and nothing else (3b design, 7.1).
  packages: "bundle",
  // Bundled CommonJS dependencies (stream-json, stream-chain, varint) call require(); an ES module bundle has to provide it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
