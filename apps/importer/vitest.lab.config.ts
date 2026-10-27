import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The importer's labs under test/lab (3b design, section 12.5): measurements of time and memory against archives the
 * labs generate, run by hand in the Dockerfile's build stage and never by a suite (their files end in .lab.ts, which no
 * other configuration includes). Each file runs in a process of its own (the forks pool, one file at a time), so one
 * lab's peak memory is not another's. See test/lab/README.md.
 */
export default defineConfig({
  // In the Docker run the root is read-only: Vite's cache goes to the lab volume (LAB_DIR), and the script loads this
  // file with --configLoader runner, which writes no bundled copy of it next to node_modules.
  ...(process.env.LAB_DIR ? { cacheDir: path.join(process.env.LAB_DIR, "vite-cache") } : {}),
  test: {
    include: ["test/lab/**/*.lab.ts"],
    pool: "forks",
    fileParallelism: false,
    isolate: true,
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
