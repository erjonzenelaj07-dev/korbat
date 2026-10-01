// Builds the staff console for Caddy's image (3a design, section 9). esbuild is called directly, as the API's build
// is: the whole configuration fits here. The development server (dev.mjs) runs the same options in watch mode.
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The oldest browsers whose syntax the bundle is written for, pinned so that a new esbuild never changes the output by
 * itself. Each runs WebAuthn with user verification; one without Trusted Types ignores that part of the policy.
 */
export const BUILD_TARGET = ["chrome120", "edge120", "firefox121", "safari17"];

/**
 * The page. It holds no inline script or style, which the console's policy would refuse: one stylesheet and one module,
 * both under hashed names, and the icon as a file (img-src 'self' allows no data: URL).
 */
function indexHtml(script, style) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>korbat staff console</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/${style}">
<script type="module" src="/assets/${script}"></script>
</head>
<body>
<div id="root"></div>
<noscript>The staff console needs JavaScript.</noscript>
</body>
</html>
`;
}

/**
 * Writes index.html for a finished build and removes the hashed files an earlier build of the same folder left, so a
 * watch never serves yesterday's bundle. Runs at the end of every build, the development server's rebuilds included.
 */
function writePage(outdir) {
  return {
    name: "korbat-console-page",
    setup(pluginBuild) {
      pluginBuild.onEnd(async (result) => {
        if (result.errors.length > 0 || !result.metafile) return;
        const outputs = Object.entries(result.metafile.outputs);
        const entry = outputs.find(([, output]) => output.entryPoint === "src/main.tsx");
        if (!entry || !entry[1].cssBundle) throw new Error("the console's build produced no bundle or no stylesheet");
        const written = new Set(outputs.map(([file]) => path.basename(file)));
        for (const file of await readdir(path.join(outdir, "assets"))) {
          if (!written.has(file)) await rm(path.join(outdir, "assets", file), { force: true });
        }
        await copyFile(path.join(ROOT, "public", "favicon.svg"), path.join(outdir, "favicon.svg"));
        await writeFile(path.join(outdir, "index.html"), indexHtml(path.basename(entry[0]), path.basename(entry[1].cssBundle)));
      });
    },
  };
}

/** esbuild's options for a build into `outdir`: the page at its root, the hashed bundle and stylesheet under assets/. */
export function buildOptions(outdir) {
  return {
    absWorkingDir: ROOT,
    entryPoints: { main: "src/main.tsx" },
    outdir: path.join(outdir, "assets"),
    entryNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: BUILD_TARGET,
    minify: true,
    jsx: "automatic",
    // React's production build: no development checks, and none of the development build's extra code in the page.
    define: { "process.env.NODE_ENV": '"production"' },
    // Licence comments stay, at the end of the bundle.
    legalComments: "eof",
    metafile: true,
    logLevel: "info",
    plugins: [writePage(outdir)],
  };
}

/** Builds the console into `outdir` (dist/ by default), from scratch. */
export async function buildConsole({ outdir = path.join(ROOT, "dist") } = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(path.join(outdir, "assets"), { recursive: true });
  await build(buildOptions(outdir));
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await buildConsole();
  console.log("Build success");
}
