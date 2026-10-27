# The importer's labs

Four labs measure the importer against archives they build themselves (3b design, section 12.5): `zip-bomb.lab.ts`,
`json-bomb.lab.ts`, `traversal.lab.ts` and `large-archive.lab.ts`, the importer's half of the large-archive lab (the
API's intake of 50,000 lines within its 512m is Task 4's). No lab reads a real archive: `tool.ts` writes every one of
them, a chunk at a time, with the canaries of section 12 where a person's private data would be.

## Running them

From the repository's root, in the importer Dockerfile's build stage (the runtime stage holds only `dist/`), with the
importer's own limits and a read-only root:

    docker build -f apps/importer/Dockerfile --target build -t korbat2b-importer-build .
    docker run --rm --network none --memory 512m --memory-swap 512m --cpus 0.5 --read-only --tmpfs /tmp:size=16m -v korbat2b-importer-lab:/lab -e LAB_DIR=/lab korbat2b-importer-build pnpm --filter @korbat/importer test:lab
    docker volume rm korbat2b-importer-lab

In Git Bash on Windows, put `MSYS_NO_PATHCONV=1` before `docker run`, or `/lab` becomes a Windows path. No suite
includes the labs: their files end in `.lab.ts`, which only `vitest.lab.config.ts` includes, and each file runs in a
fork of its own, one at a time. The whole run takes about 25 minutes at half a processor; most of it is building and
reading the two CARs. A single file runs with its path after `test:lab`.

Without Docker, `pnpm --filter @korbat/importer test:lab` runs them on the host with `LAB_DIR` (default: a folder of
the system's temporary one); the symbolic-link case skips where links cannot be made (Windows without Developer Mode).

## Where things go

- **The lab volume.** Section 12.5 names none, and the read-only root leaves only 16 MB of `/tmp`, so a named volume,
  `korbat2b-importer-lab`, is mounted at `/lab` (`LAB_DIR`). It holds the bundled tool, every generated archive, the two
  volumes each scan reads and writes (`run-<uuid>/archives` and `run-<uuid>/work`, deleted after each case), Vite's cache,
  and the record.
- **The configuration.** `test:lab` loads `vitest.lab.config.ts` with `--configLoader runner`, which writes no bundled
  copy of it next to `node_modules` (the root is read-only), and the configuration puts Vite's cache under `LAB_DIR`.
- **The record.** Each measurement is one line of JSON in `/lab/lab-importer.jsonl`, also printed in the run's output.

## How a scan is measured

Each lab bundles `tool.ts` into the lab volume with esbuild, as `build.mjs` bundles the importer, and runs every
generator and every scan with it in a process of its own, so the vitest processes stay small and a scan's memory is its
own. `tool.mjs scan` takes a collection (`--expose-gc`), reads `process.memoryUsage().rss`, runs the importer's own
`scanJob` on one job, and then reads `process.resourceUsage().maxRSS` (kilobytes, the process's peak resident set):
**peak** is that maximum less the RSS before the scan, the most the scan added. **ms** is `performance.now()` around
`scanJob`. A Node process holds about 75 MB before it scans anything (`rssBefore`).

## The numbers of 2026-10-26

The scratch clone's build stage on Docker Desktop's Linux VM (the host a shared Windows machine), with the importer's
limits: `--memory 512m --cpus 0.5`, a read-only root and no network. All sixteen cases passed; the run took 22.7 minutes.

### zip-bomb.lab.ts: each refused within 5 seconds and under 64 MB

| archive | what it is | refused as | ms | peak |
|---|---|---|---|---|
| overlap-terabytes.zip | 10 MB; 99 allowlisted entries whose local records all lie in one region, each declaring 1 TiB (ZIP64) | too_large_uncompressed | 118 | 0.9 MB |
| overlap-within-limits.zip | 10 MB; four overlapping entries of 1,000,000,000 bytes each (ratio 96, the sum under 4 GiB) | unreadable | 101 | 0.4 MB |
| ratio-bomb.zip | 2 MB; tweets.js declares 100 MB (ratio about 50) and inflates to 2 GiB of spaces | unreadable | 3,507 | 3.3 MB |
| million-entries.zip | 103 MB; a central directory of 1,000,001 entries (ZIP64 count) | too_many_entries | 99 | 0.7 MB |
| zip64-offset-past-end.zip | the ZIP64 end record puts the directory 1 TiB past the file | unreadable | 25 | 0.4 MB |
| zip64-size-lies.zip | tweets.js's ZIP64 extra declares 2^62 bytes | too_large_uncompressed | 104 | 0.8 MB |
| zip64-entry-offset-lies.zip | tweets.js's ZIP64 extra puts its local header at 2^45 | unreadable | 107 | 0.9 MB |

- The overlapping bombs never inflate a byte: the first is refused by a data file's 1 GiB, the second by the overlap of
  the allowlisted ranges, both from the central directory and the local headers alone.
- The ratio bomb is the slowest: it inflates 100 MB of spaces through the JSON tokenizer before the 100,000,001st byte
  stops it, at half a processor.

### json-bomb.lab.ts: each refused item_too_large within 5 seconds and under 64 MB

Each X archive holds one ordinary tweet and then the bomb in `tweets.js` (stored, so the ratio is 1 and the bomb reaches
the parser). The ordinary tweet is kept (posts 1), the bomb counted `item_too_large`, and the rest of the file is not
read.

| archive | the bomb | ms | peak |
|---|---|---|---|
| string-900mb.zip | a 900 MB string | 226 | 3.9 MB |
| depth-million.zip | 1,000,000 nested brackets | 198 | 2.5 MB |
| key-500mb.zip | a 500 MB key | 216 | 3.3 MB |

### traversal.lab.ts: refused or ignored, nothing written outside jobs/<id>/

| case | result | ms | peak |
|---|---|---|---|
| crafted-names.zip, images on: `..` segments, a leading slash, a drive letter, backslashes, a NUL, 513 bytes, an empty and a `.` segment, a media name with `..` in it, and symbolic links to /etc/passwd under a kept post's media name and under data/note-tweet.js | scanned: 2 posts, the linked image counted missing_file; the work volume holds only jobs/<id>/posts.jsonl, summary.json and attempts/<id>; the archives volume is unchanged; no file holds /etc/passwd's first line | 128 | 2.0 MB |
| the archive itself a symbolic link to /etc/passwd | failed: unreadable (openWorkFile refuses the link) | 27 | 0.8 MB |

### large-archive.lab.ts: each within the 30-minute watchdog, peak under 400 MB

| archive | size | result | ms | peak |
|---|---|---|---|---|
| X: 60,000 tweets in a tweets.js of 369 MiB (deflated), 5,000 images of 360,000 bytes, images on | 1,902 MiB (1.86 GiB) | 50,000 posts and 5,000 images written, over_post_cap 10,000 | 158,224 (2.6 min) | 61.4 MB |
| Mastodon: an outbox of 50,000 Notes | 1.9 MiB | 50,000 posts | 49,608 | 34.3 MB |
| Bluesky: a CAR of 2,000,000 blocks, 897,195 of its records posts | 446.5 MiB | 50,000 posts, over_post_cap 847,195 | 309,919 (5.2 min) | 148.5 MB |
| Bluesky: a CAR of 1,180,000 blocks, 1,102,803 of them posts | 258.6 MiB | read in part: 1,000,000 items read, over_item_cap 1, 50,000 posts, over_post_cap 950,000 | 410,124 (6.8 min) | 77.6 MB |

- The X archive is about 1.86 GiB rather than 1.9, so that it stays within `IMPORT_RULES.maxBytes` (2 GiB), which the
  importer's opener enforces. The 5,000 images are the newest 5,000 tweets', all kept; the scan copies 1.7 GiB of them.
- The first run, before `detach()` copied the source ids the heap keeps, ran out of the container's JavaScript heap on
  the X archive: each id the tokenizer made was a slice of its 64 KB chunk of tweets.js and kept the chunk alive (633 MB
  of peak on the host). After the copy the same scan's peak is in the table.
- The large CAR is a repository's mix: posts beside likes (whose keys sort first and which are never decoded) under a
  16-way MST, and the commit, made up to exactly 2,000,000 blocks with unreferenced blocks. The index of 2,000,000
  blocks is keyed by 8 bytes of each digest in typed arrays.
- The second CAR is all posts, more than `IMPORT_RULES.maxItems`: the read stops at 1,000,000 items (over_item_cap 1,
  read in part) and keeps the newest 50,000 of those it read.
