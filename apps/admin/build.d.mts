// Types for build.mjs, which the tests import; the script itself runs in Node without a compiler.
import type { BuildOptions } from "esbuild";

export declare const BUILD_TARGET: string[];
export declare function buildOptions(outdir: string): BuildOptions;
export declare function buildConsole(options?: { outdir?: string }): Promise<void>;
