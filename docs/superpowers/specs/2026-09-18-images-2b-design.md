# korbat sub-project 2b: Images — Design

Date: 2026-09-18. Status: approved in brainstorm. The technical assumptions were then checked by experiment and source research (section "Research"), which changed a few numbers (section "Changes since the brainstorm"). Awaiting written review.

## Context

Sub-project 2 of the korbat design (`2026-09-03-korbat-design.md`, build-order row 2) was split into 2a text posting and feed (executed 2026-09-17), 2b images, and 2c explore. This is 2b: images on posts, end to end.

What exists today:

- `post_media` was created by Foundation and has never been written by any code.
- `apps/worker` is the Foundation skeleton: a Redis list consumer with one `noop` job.
- The Compose stack runs MinIO and a bucket-init job that no code uses.
- 2a's `social` module creates, deletes and hydrates posts. Its composer and post card are text only.
- The API applies `Cache-Control: no-store`, a 300-per-minute per-IP limit and session resolution to every request, and `/api/health` answers 503 when any check fails. Sections 5.5 and 9 adjust these for images.
- The 2a integration tests write fixture accounts and posts into the development database and leave them there. Some are future-dated by the tests' clock, so they sit on top of the public Latest timeline in development.

One fact changed under the main design. MinIO's community edition stopped publishing images in October 2025, entered maintenance mode in December 2025, was archived in April 2026, and its Docker Hub repositories were removed on 2026-09-11. The image korbat pins is the last one, from September 2025, and will get no security fixes.

## Decisions

| Topic | Decision |
|---|---|
| Storage | Two Docker volumes behind a small file protocol. MinIO leaves the stack. An S3 adapter can be added behind the same interface if it is ever wanted |
| Pipeline | The worker has no network and no credentials. Work is handed over through files. The API owns the database and finalizes rows |
| NSFW score (rule R1) | Moves to sub-project 3, to arrive with the review queue, CSAM matching and appeals. `nsfw_score` stays empty; the pipeline keeps a slot for it |
| Alt text | Required on every image, 1 to 1000 characters |
| Images per post | Up to 4, on posts, replies and quotes. A post needs text or at least one image |
| Formats | JPEG, PNG, WebP, AVIF and single-frame GIF in. WebP out, in two sizes. Animated images and HEIC are refused with a clear message |
| Serving | The API serves image files after a visibility check. Images of visible posts are public and cacheable for 5 minutes; everything else is for the author only and never cached |
| Originals | Never kept. The uploaded file is deleted as soon as processing ends |
| Test isolation | Integration tests run against a separate `korbat_test` database and Redis database 15. A script clears what 2a left in the development database |

## Research

Done on 2026-09-18 with sharp 0.35.4 (libvips 8.18.6) on Windows x64, Docker Desktop on WSL2, and primary sources. "Measured" means run in a scratch folder or a throwaway Compose project.

| Finding | Consequence |
|---|---|
| Measured: the prebuilt sharp binary contains SVG and TIFF loaders next to JPEG, PNG, WebP, GIF and AVIF. HEIC cannot be decoded | The decoder allowlist is necessary, not decoration |
| Measured: `sharp.block({operation: ["VipsForeignLoad"]})` refuses every format; unblocking the parent classes `VipsForeignLoadJpeg`, `VipsForeignLoadPng`, `VipsForeignLoadWebp`, `VipsForeignLoadNsgif` and `VipsForeignLoadHeif` admits exactly JPEG, PNG, WebP, GIF and AVIF. An unknown class name is ignored without an error | A typo would silently leave a format blocked or the allowlist incomplete. Tests must prove that each allowed format decodes and that SVG and TIFF do not |
| Measured: Ultra HDR and Apple gain-map JPEGs decode through the plain JPEG loader when the Ultra HDR loader is blocked, with byte-identical output | Phone photos are not refused, and the embedded gain-map image is dropped |
| Measured: `metadata().pages` is 2 or more for animated GIF and WebP without decoding frames. Source: libvips 8.18 has no APNG support and reads only the first frame | Animation is detected from `pages`; APNG from its `acTL` chunk; AVIF sequences from their brand |
| Measured: default output has no EXIF, GPS, ICC, XMP or IPTC, `autoOrient()` applies the EXIF rotation first, a ZIP appended to a JPEG does not reach the output, and a truncated JPEG is refused at `failOn: "error"` | The pipeline is a fresh encode. Nothing of the original file survives |
| Measured: the pixel limit is enforced from the header in about 3 ms | Decompression bombs are refused before any pixel is decoded |
| Measured: decode memory follows pixel count, not file size. At 48 MP: WebP 96 MB, 8-bit PNG 107 MB, progressive JPEG 255 MB, GIF 325 MB, 16-bit interlaced PNG 400 MB, AVIF 948 MB. AVIF at 20 MP: 423 MB, from a 932-byte file. AVIF at 12 MP: 281 MB. A 12 MP photo of pure noise takes 0.7 s for both sizes at about 107 MB | Pixel caps are per format: 16 MP for AVIF, 50 MP for the rest. The worker gets 768 MB. One image at a time |
| Source: sharp's `timeout()` is cooperative and may not interrupt a single blocking decoder call | The worker has its own watchdog that exits the process |
| Source: libvips honours `VIPS_BLOCK_UNTRUSTED` only if it is set before it loads. In this build it blocks SVG and two others, not TIFF | It is set as well, but the allowlist is the control that matters |
| Source: a critical libheif advisory was published on 2026-08-25 and fixed in sharp 0.35.4 the next day; the workaround was to block the HEIF loader. sharp fixes only its latest release | Formats can be switched off by configuration without a deploy. sharp is kept current, and the worst-case check is rerun after each upgrade |
| Source: many camera JPEGs, Samsung phones among them, raise libjpeg warnings such as "Invalid SOS parameters". sharp's default `failOn: "warning"` refuses them | `failOn: "error"`. The decoder has already run when a warning is raised, so this does not widen the attack surface; it only stops refusing ordinary photos |
| Source: sharp 0.35 has no install scripts; the platform binary is an optional dependency selected by operating system, CPU and libc | pnpm has nothing to block. The worker image must install inside Alpine, as the API image already does for argon2 |
| Source: sharp is Apache-2.0; the prebuilt libvips packages are LGPL-3.0-or-later, as a separate dynamically loaded library | No obligations for running it. If korbat images are ever distributed, ship the notices; the library is already replaceable |
| Measured: a named volume takes the image directory's owner even when its first mount is read-only, as long as the path exists in the image. Source: while a volume is empty, every container creation re-applies that image's owner | Both images create both mount paths owned by `node`. No init container is needed |
| Measured: a container with `network_mode: none` has only a loopback interface, still reports a file-based health check, gates `depends_on`, and accepts `docker compose exec`. The other side's volume gives `EROFS` | The isolation model works as designed |
| Source: a read-only mount cannot be remounted without `CAP_SYS_ADMIN`, which a non-root process with all capabilities dropped and `no-new-privileges` cannot get. Files written by the other container must still be treated as untrusted | The API checks every file it opens in the store (section 7.3). Without that, a compromised worker could plant a symlink to `/proc/self/environ` and have the API serve its own secrets |
| Source: `rename(2)` is atomic inside one mount and fails across mounts. A rename to a new name is not made durable by ext4 on its own | Temporary files live in the volume they are renamed in, and are `fsync`ed first |
| Source: Hono 4.13.5's `bodyLimit` reads a chunked body fully into memory before the handler runs | The upload route counts bytes itself while streaming to disk |
| Source: Cloudflare caches by file extension, `.webp` included, honours `public, max-age`, never caches `private` or `no-store`, and ignores request cookies in the cache key. Its default Browser Cache TTL of 4 hours overrides a shorter `max-age` | Image URLs end in `.webp`. Anything that depends on the viewer is `private, no-store`. The zone must be set to "Respect Existing Headers" |
| Source: Cloudflare's CSAM Scanning Tool is free on every plan and scans only content served from its cache | Public images must be cacheable, which they are. Sub-project 3 turns the tool on |
| Source: `expo-image` supports web; blurhash placeholders are decoded in JavaScript and need only `img-src blob:`, which the CSP already allows. On web the `<img alt>` comes from `accessibilityLabel`, not from `alt` | The post card passes `accessibilityLabel` |

Sources:

- MinIO: https://blog.vonng.com/en/db/minio-resurrect/ and https://stormdevelopments.ca/blog/minio-s-community-edition-is-archived-what-still-runs-in-2026/
- sharp: https://sharp.pixelplumbing.com/security/ , https://sharp.pixelplumbing.com/api-utility/ , https://sharp.pixelplumbing.com/api-constructor/ , https://sharp.pixelplumbing.com/changelog/v0.35.0/ , https://github.com/lovell/sharp/security/advisories
- libvips: https://github.com/libvips/libvips/blob/8.18/libvips/iofuncs/operation.c , https://github.com/libvips/libvips/blob/8.18/libvips/iofuncs/init.c , https://github.com/libvips/libvips/discussions/3705
- Docker: https://docs.docker.com/engine/storage/volumes/ , https://github.com/moby/moby/issues/45714 , https://docs.docker.com/engine/network/drivers/none/ , https://docs.docker.com/engine/containers/resource_constraints/ , https://man7.org/linux/man-pages/man2/rename.2.html
- Hono: https://github.com/honojs/hono/blob/v4.13.5/src/middleware/body-limit/index.ts , https://github.com/honojs/hono/security/advisories/GHSA-9vqf-7f2p-gf9v
- Cloudflare: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ , https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/ , https://developers.cloudflare.com/cache/reference/csam-scanning/
- Caddy: https://caddyserver.com/docs/caddyfile/directives/request_body
- expo-image: https://docs.expo.dev/versions/v57.0.0/sdk/image/ , https://github.com/expo/expo/blob/sdk-57/packages/expo-image/src/ExpoImage.web.tsx

## Changes since the brainstorm

The brainstorm fixed the decisions above. Research changed these details:

- The side limit rises from 10,000 to 16,383 pixels, so phone panoramas pass. Memory is governed by the pixel caps, not the side.
- AVIF gets its own cap of 16 MP.
- The worker's memory limit is 768 MB, not 512 MB.
- New: a free-space floor for uploads, a configuration switch per format, a watchdog in the worker, checks on every file the API opens in the store, an own rate-limit bucket and no session lookup for public image requests, an advisory health check for the worker, and a Cloudflare setting that deployment must apply.
- The test environment file is derived from the development one, and the integration test configuration loads it by itself. Tests no longer depend on the shell having sourced a file.

## 1. Scope

In scope:

- Uploading, processing, storing, serving and deleting images on posts, replies and quotes.
- Required alt text.
- The composer: picking images in the browser, previews, a description per image, processing state.
- The post card: an image grid with blurhash placeholders, an ALT control, a full-screen viewer, thumbnails in quoted posts.
- Compose: MinIO removed, two volumes added, the worker isolated and limited.
- Test isolation and the cleanup of 2a's fixtures.

Out of scope, with its owner:

- NSFW scoring, the composer warning and automatic withholding (sub-project 3).
- Turning on CSAM scanning and purging the CDN on removal (sub-project 3). 2b only shapes the URLs for it.
- Avatars and banners (1b). They will reuse this pipeline.
- Animation and video (v2 in the main design).
- A native image picker (sub-project 5). On native the add-image button is hidden.
- Cropping, editing, reordering, paste and drag-and-drop, and an upload percentage.
- Imports from other platforms (3b). See section 14.
- Backups of the store volume (sub-project 4).

## 2. Architecture

### 2.1 Pieces

- **`packages/media-protocol`** (new, depends only on zod): the contract between the API and the worker. Limits, directory layout and path helpers, the result file schema, failure reasons, and the byte sniffers (format by magic bytes, APNG by its `acTL` chunk, AVIF sequences and HEIC by brand).
- **`apps/worker`** (rewritten): the image processor. It loses `ioredis`, `@korbat/db` and the Foundation job registry, and gains `sharp` and `blurhash`. Files: `config.ts`, `pipeline.ts` (everything that touches sharp), `loop.ts` (one tick: heartbeat, deletions, processing, cleanup), `index.ts`.
- **`apps/api/src/media/`** (new module, shaped like `auth` and `social`): `context.ts` (`MediaError`, dependencies), `files.ts` (the API's side of the protocol and the safe open), `repo.ts` (every SQL statement on `post_media`), `flows/upload.ts`, `flows/status.ts`, `flows/remove.ts`, `flows/serve.ts`, `sweeper.ts`, `routes.ts`, `index.ts`.
- **`apps/api/src/social/`**: creating a post attaches images, deleting one detaches them, and views carry them. It reaches `post_media` only through the media module's interface.
- **Compose**: `minio` and `minio-init` leave. `media-uploads` and `media-store` arrive. The worker is cut off from the network.

### 2.2 The file protocol

```
media-uploads   API read-write, worker read-only   /media/uploads
  tmp/<id>.part          a body being received
  incoming/<id>          a complete upload waiting for the worker
  delete/<id>            a request to delete image <id>

media-store     worker read-write, API read-only   /media/store
  files/<aa>/<id>/small.webp, large.webp           <aa> = first two characters of the id
  results/<id>.json      the outcome, written last
  attempts/<id>          how often processing started
  tmp/                   files being written
  heartbeat              rewritten every 10 seconds
```

A result is `{ "v": 1, "id", "status": "ready", "width", "height", "blurhash" }` or `{ "v": 1, "id", "status": "failed", "reason" }`. Width and height are those of `large.webp`, after rotation.

Rules:

1. Each side writes only its own volume. A file is written under that volume's `tmp/`, `fsync`ed, and renamed into place, so the other side never sees half a file.
2. Ids are UUIDs that the API makes with `randomUUID`. Both sides ignore every entry whose name is not a lowercase UUID (plus `.json` or `.part` where that applies) or that is not a regular file. No name or path from a user ever reaches the file system.
3. The result file is the commit point. An upload without a result is unprocessed and is simply processed again.
4. The upload is deleted by the API once the row is final. A result whose upload is gone has been consumed, and the worker removes it.
5. A delete request is removed by the API once the image folder and result are gone.

### 2.3 The worker

One loop, one image at a time. Each tick (every 500 ms, without overlap):

1. Rewrite `heartbeat` if 10 seconds have passed.
2. For every `delete/<id>`: remove `files/<aa>/<id>/`, `results/<id>.json` and `attempts/<id>`.
3. For every `incoming/<id>` without a result, oldest first: process it.
4. Remove every result whose upload is gone.

Processing one upload:

1. Read `attempts/<id>`. At 3, write a `processing_failed` result and stop. Otherwise write the count plus one. This happens before any decoding, so a file that kills the process is retried at most three times.
2. Sniff the first bytes. Refuse anything that is not an enabled format, and refuse HEIC, APNG and AVIF sequences. No decoder has run yet.
3. Read metadata. Refuse more than one page (`animated_not_supported`), a format that does not match the sniff, an AVIF whose compression is not AV1, more than 16,383 pixels on a side, and more than the format's pixel cap (`image_too_large`). The pixel cap is also passed to sharp as `limitInputPixels`, which enforces it from the header.
4. For each size: `sharp(path, { limitInputPixels, failOn: "error", sequentialRead: true }).autoOrient().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).timeout({ seconds: 30 })`. Sizes are `large` (long edge 2048, quality 82) and `small` (1024, quality 80). Transparency is kept. Output is sRGB without any metadata, which is sharp's default.
5. Blurhash: `small.webp` reduced to fit 32 by 32 pixels, encoded with 4 by 3 components.
6. Write both files, then the result.

A decode error becomes `corrupt_image`. Any other error becomes `processing_failed`. A watchdog ends the process if one upload takes longer than 120 seconds; Docker restarts the container and the attempt counter does the rest.

At start the worker sets `VIPS_BLOCK_UNTRUSTED` before sharp loads, blocks `VipsForeignLoad`, unblocks the enabled formats' classes, and sets `sharp.cache(false)` and `sharp.concurrency(1)`. It logs ids and reasons, never bytes or user data.

### 2.4 The media module

`createMedia(options)` takes the API pool, the uploads and store directories, the enabled formats, the free-space floor, the rate-limit store, the Redis client (for the sweeper's lock), the logger, the auth module's `requireSession` and `resolveSession`, an `enforceUploadLimit` function, and an optional clock. It returns:

- `routes`: upload, status and removal, mounted under `/api/media`.
- `fileRoutes`: the image file route, mounted before session resolution (section 5.5).
- `forPosts`: the interface the social module uses (section 2.5).
- `sweep(now)` and `startSweeper()`: section 4.7.
- `healthCheck`: fails when the heartbeat is older than 60 seconds or free space is under the floor.

`enforceUploadLimit` is built in `src/index.ts` from the social module's write-limit function, so all per-account write limits stay in one table and the two modules do not import each other's internals.

### 2.5 The social module

`createSocial` takes an optional `media` with four functions. Without it, posts carry no images and attaching any is `media_unavailable`, so the 2a tests keep working unchanged.

- `attach(tx, { postId, ownerId, items })`: inside the post's transaction. One statement sets `post_id`, `position` and `alt_text` on rows that belong to the author, are `ready` and are not attached. Fewer updated rows than items rolls the post back with `media_unavailable`.
- `detachAll(tx, postId)`: inside the delete transaction. Deletes the rows and returns their ids.
- `requestDeletion(ids)`: after the commit. Writes the delete requests.
- `forPosts(postIds)`: one query for a page of posts, quoted posts included.

### 2.6 Boundary enforcement

The architecture test gains these rules, each proven by a deliberate violation:

- Code outside `apps/api/src/media/` imports only `media/index.ts`.
- Only the media module mentions `postMedia` or `post_media`.
- The media module does not import from `auth/` or `social/` internals.
- `apps/worker` does not depend on or import `@korbat/db`, `ioredis`, `postgres` or any network client.
- Only `apps/worker/src/pipeline.ts` imports `sharp`.

### 2.7 Contracts

New in `packages/contracts/src/media.ts`: `MEDIA_MAX_BYTES` (20 MiB), `MEDIA_MAX_PER_POST` (4), `MEDIA_ACCEPTED_TYPES`, `ALT_MAX_LENGTH` (1000), `normalizeAltText` (NFC, runs of whitespace to one space, trim), `AltText` (no control characters, 1 to 1000 code points after normalization), `MediaErrorCode`, `MediaFailure`, `UploadResponse`, `MediaStatusResponse` and `MediaView`:

```
MediaView = { id, width, height, blurhash, alt, small, large }
```

`small` and `large` are paths such as `/api/media/<id>/small.webp`, so the server can move images later without a client change.

Changed in `social.ts`: `CreatePostRequest` gains `media: [{ id, alt }]` (at most 4, distinct ids, default empty). `body` may be empty, and a refinement requires text or at least one image. `PostView` and `QuotedPost` gain `media: MediaView[]`, always present. Tombstones carry none.

## 3. Data model changes

`post_media` is reworked in place. It has no rows in any environment, so required columns are added without a backfill.

| Column | Change |
|---|---|
| `owner_id` | new, required, references `profiles` with cascade |
| `status` | new enum `media_status`: `processing`, `ready`, `failed`; default `processing` |
| `error` | new, the failure reason |
| `created_at` | new, required |
| `post_id`, `position` | become optional; set when the image is attached |
| `width`, `height`, `blurhash` | become optional; set when the image is ready |
| `path` | dropped. The location follows from the id |
| `alt_text`, `nsfw_score` | unchanged. `nsfw_score` stays empty until sub-project 3 |

Checks: a `ready` row has width, height and blurhash; an attached row is `ready` and has a position from 0 to 3 and alt text; alt text has at most 1000 characters. Indexes: the existing unique `(post_id, position)`, plus `(owner_id, created_at)` for the pending count and `(status, created_at)` for the sweeper. Row-level security stays as it is.

`posts.body` already allows an empty string. A post without text and without images is refused by the API.

## 4. Lifecycle

### 4.1 Upload

`POST /api/media` with the file as the raw body. The API checks the session, the upload limit, the pending count and free space, then the declared type. It reads the first bytes and sniffs them, streams the body to `tmp/<id>.part` while counting bytes, stops at 20 MiB, inserts a `processing` row, renames the file into `incoming/`, and answers `202 { id, status: "processing" }`. The row comes before the rename, so the worker never processes an upload nobody owns. A disconnect or an error deletes the partial file.

### 4.2 Process

Section 2.3.

### 4.3 Finalize

Whoever looks first finalizes: `GET /api/media/:id` from the composer, or the sweeper. It reads the result through the safe open, updates the row only if it is still `processing`, and deletes the upload. It is safe to repeat.

### 4.4 Attach

`POST /api/posts` with `media`. Section 2.5.

### 4.5 Serve

Section 5.5.

### 4.6 Delete

- Deleting a post detaches its images in the same transaction and requests their deletion after the commit. Serving stops with the commit, because the rows are gone.
- `DELETE /api/media/:id` removes an upload that is not attached.
- The sweeper removes what nobody attached.

### 4.7 The sweeper

Every 30 seconds in the API, under a Redis lock so that one instance runs it. `sweep(now)` is a plain function, which tests call with a moved clock.

1. Finalize `processing` rows that have a result.
2. Fail `processing` rows older than 5 minutes (`processing_failed`), delete their upload and request deletion.
3. Remove rows that were never attached and are older than 24 hours, with their files.
4. Remove delete requests whose image folder and result are gone.
5. Every 10 minutes, reconcile: request deletion of image folders older than an hour that have no row, and delete uploads and partial files older than an hour that have no row. This cleans up after a crash between a commit and a file operation, and after account deletion, where rows go by cascade.

## 5. Endpoints

### 5.1 `POST /api/media`

Session required. Body: the file. `Content-Type` must be one of the accepted types; it is checked and then forgotten. Answers `202 { id, status }`. Errors: section 8.

### 5.2 `GET /api/media/:id`

Session required, owner only, otherwise `not_found`. Answers `{ id, status, error?, width?, height?, blurhash? }` and finalizes first if a result is waiting.

### 5.3 `DELETE /api/media/:id`

Session required, owner only, only while not attached. Answers 204.

### 5.4 `POST /api/posts`

Accepts `media`. Every other rule of 2a applies unchanged: reply and quote targets, blocks, tiers, limits.

### 5.5 `GET /api/media/:id/small.webp` and `/large.webp`

- The post is visible: the file, with `Cache-Control: public, max-age=300` and an `ETag`. No session is looked up.
- The post is withheld or removed: the route resolves the session itself, and serves the author with `Cache-Control: private, no-store`. Everyone else gets 404.
- No row, not ready, not attached, or post deleted: 404.

A block is not checked here. 2a already states that posts are public to anyone who signs out, and its block screens say so; an image follows its post.

`If-None-Match` answers 304 after the same checks. The response always has `Content-Type: image/webp`, and the API's existing headers apply: `nosniff`, a CSP of `default-src 'none'`, and `Cross-Origin-Resource-Policy: same-origin`, which also stops other sites from embedding the images.

Three changes in `app.ts` make this work:

- `fileRoutes` is mounted before `auth.resolveSession`, so public image requests cost one query.
- These requests are exempt from the 300-per-minute global limit and have their own bucket of 1200 per minute per IP. A timeline page can hold 80 images.
- `noStore` sets its header only when the handler set none.

## 6. Limits and abuse controls

| Limit | Value |
|---|---|
| File size | 20 MiB |
| Images per post | 4 |
| Alt text | 1 to 1000 characters, required |
| Pixels | 50 MP for JPEG, PNG, WebP and GIF; 16 MP for AVIF |
| Side | 16,383 pixels |
| Uploads, account younger than 24 hours | 20 per hour |
| Uploads, established account | 120 per hour |
| Uploads waiting to be attached | 20 per account |
| Processing | fails after 5 minutes |
| Unattached uploads | deleted after 24 hours |
| Free space | uploads are refused under 2 GiB free on either volume |
| Image requests | 1200 per minute per IP |

Upload limits are a new row in 2a's tier table and use its mechanism, so sub-project 3 replaces account age with reputation in one place. The free-space floor exists because the volumes share a disk with Postgres: filling the disk with images would stop the database.

## 7. Hardening

### 7.1 The container

`network_mode: none`, read-only root file system, user `node`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit` and `memswap_limit` of 768 MB, one CPU, 64 processes, a 64 MB tmpfs at `/tmp` for libvips. It mounts the uploads read-only and the store read-write, and nothing else. It has no database URL, no Redis URL, no keys. Its health check reads the heartbeat file.

The image decoder is the most exploitable code korbat runs. If it is compromised, the attacker holds two directories, cannot call out, and cannot reach Postgres, Redis or the API.

### 7.2 The decoder

Section 2.3: magic bytes before any decoder, an allowlist of five loader classes, `VIPS_BLOCK_UNTRUSTED`, pixel caps from the header, one image at a time, a timeout per encode, a watchdog per upload, and at most three attempts per file.

`MEDIA_FORMATS` (default `jpeg,png,webp,gif,avif`) is read by the API and the worker. Removing a format refuses it at upload and leaves its loader blocked. When an advisory names a decoder, the operator edits one line and restarts two containers.

### 7.3 The store is untrusted

The API treats every file in the store as written by an attacker. It opens a file, and then checks the open handle: it must be a regular file, on the same device as the store directory, and within a size bound (16 KiB for a result, 32 MiB for an image). A symlink to anything outside the volume lands on another device and fails the check, and checking the handle leaves no window between check and use. Results are parsed with the protocol schema. A file that fails is answered with 404 and logged as a security event.

Image bytes are always sent as `image/webp` with `nosniff` and the API's `default-src 'none'` CSP, so bytes a compromised worker wrote cannot become active content.

### 7.4 Privacy

EXIF, GPS, ICC, XMP, IPTC, embedded thumbnails and gain maps do not survive. The original is deleted after processing and is never backed up. Nothing of the upload request is stored: not the file name (there is none in a raw body), not the declared type.

## 8. Errors

New codes in `MediaErrorCode`, in the standard envelope:

| Code | Status | When |
|---|---|---|
| `unsupported_media_type` | 415 | The declared type or the first bytes are not an enabled format. HEIC gets its own message: export as JPEG |
| `file_too_large` | 413 | More than 20 MiB |
| `too_many_pending_uploads` | 409 | 20 uploads wait to be attached |
| `uploads_unavailable` | 503 | Free space is under the floor |
| `media_unavailable` | 400 | Attaching an image that does not exist, is not yours, is not ready, or is already attached |

Reused: `invalid_request` (more than 4 images, a repeated id, missing or long alt text, a post without text and images), `rate_limited`, `not_found`, `unauthenticated`, `onboarding_required`, `csrf_failed`.

Failure reasons on a status response, not HTTP errors: `unsupported_format`, `animated_not_supported`, `image_too_large`, `corrupt_image`, `processing_failed`. The web app has a sentence for each.

## 9. Configuration and infrastructure

- **API**: `MEDIA_UPLOADS_DIR`, `MEDIA_STORE_DIR` (defaults under `.data/media/` at the repository root, for development on the host), `MEDIA_FORMATS`, `MEDIA_MIN_FREE_BYTES`.
- **Worker**: `MEDIA_UPLOADS_DIR`, `MEDIA_STORE_DIR`, `MEDIA_FORMATS`, `LOG_LEVEL`. `apps/worker/.env.example` is added and `gen-dev-env.mjs` handles it.
- **Compose**: `minio`, `minio-init`, their variables and the development ports 59000 and 59001 are removed. The `miniodata` volume is no longer declared; the volume on disk is left for its owner to delete, and the README says how. The API mounts the uploads read-write and the store read-only. The worker is set up as in 7.1 and no longer depends on Redis.
- **Images**: both Dockerfiles create `/media/uploads` and `/media/store` owned by `node`. The worker image installs inside Alpine and copies `sharp`, `@img`, `detect-libc` and `semver` next to the bundle, as the API image does for argon2.
- **Caddy**: `request_body` with `max_size 25MB` on `/api/media`, as a second line behind the API's own count.
- **Health**: `healthRoutes` takes advisory checks next to the critical ones. A failing advisory check reports `degraded` with status 200, so a stopped worker does not mark the API unhealthy and keep Caddy from starting. The worker is an advisory check.
- **Cloudflare**, recorded for Foundation Task 16 and sub-project 4: Browser Cache TTL "Respect Existing Headers". Without it browsers keep images for 4 hours whatever the origin says.
- **`.gitignore`**: `.data/`.

## 10. Web screens

Dependency: `expo-image`.

**Composer**

- "Add image" opens the browser's file picker, limited to the accepted types, several files at once, at most 4 in total. It is not shown on native.
- A file that is too large or of another type is refused before upload, with the reason.
- Each image shows a local preview at once (`URL.createObjectURL`, released on removal), its state (uploading, processing, ready, or the failure sentence), a description field with a counter, and Remove. Remove also calls `DELETE /api/media/:id`.
- The status is polled once a second until it is final.
- Post is enabled when there is text or an image, the text is within its limit, every image is ready, and every image has a description. The button says what is missing.

**Post card**

- One image: full width, its own ratio held between 3:4 and 2:1. Two to four images fill one 16:9 frame and crop to fill their cell: two side by side; three as one tall cell on the left and two stacked on the right; four as a two-by-two grid.
- Blurhash placeholders, lazy loading, the `small` size in lists.
- An ALT control shows the descriptions. `accessibilityLabel` carries each description to the `<img>`.
- A quoted post shows its images as one row of thumbnails.

**Viewer**

- Pressing an image opens it full screen: the `large` size fitted inside the screen, the description under it, previous and next, arrow keys, Escape. Focus returns to the image that opened it.

`lib/social.ts` gains `uploadMedia`, `mediaStatus` and `removeMedia`. Uploads send the CSRF header like every other write.

## 11. Test isolation

- `scripts/test-db.mjs` creates `korbat_test` in the Compose Postgres if it is missing, applies the per-database grants of `infra/postgres/init/01-roles.sh`, and runs the migrations with the migrate role. It can be run again at any time. Secrets are read from `infra/.env` and never printed.
- `gen-dev-env.mjs` writes `apps/api/.env.test` from `apps/api/.env` on every run: the same values, with the three database URLs pointing at `korbat_test` and the Redis URL at database 15. No second example file is kept.
- `vitest.integration.config.ts` loads `.env.test` itself and stops with instructions when the file is missing. Running `pnpm --filter @korbat/api test:integration` is enough; no file has to be sourced first.
- A global setup refuses to run unless both database names end in `_test` and the Redis database is 15. It then flushes that Redis database and truncates every table of the `public` and `auth` schemas.
- Media tests use temporary directories.
- `scripts/clean-dev-fixtures.mjs` lists what the tests left in the development database: profiles without an account behind them, and accounts whose email matches the tests' patterns. It deletes them only with `--yes`, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin.
- The smoke test deletes the post it made, which also exercises file deletion end to end.

## 12. Testing

- **`media-protocol`**: every accepted format by its bytes; HEIC brands, AVIF sequences and APNG detected; SVG, TIFF, PDF and ZIP refused; short buffers; path helpers refuse anything that is not a UUID; the result schema.
- **Worker**, with real sharp and fixtures made at test time:
  - each enabled format is processed, and SVG and TIFF are refused, which guards the allowlist against a silent typo;
  - a format removed from `MEDIA_FORMATS` is refused;
  - animated GIF, animated WebP and APNG are refused; 17 MP AVIF and 51 MP PNG are refused from the header; a truncated file is `corrupt_image`;
  - outputs are WebP of the right sizes, never enlarged, rotated by EXIF, without EXIF, GPS, ICC or the strings planted in the input, and without a ZIP appended to it;
  - Ultra HDR input is processed;
  - the third attempt fails the file without decoding; delete requests remove folder, result and counter; a result without an upload is removed; the heartbeat is written; names that are not UUIDs and entries that are not regular files are ignored.
- **API unit**: the byte counter stops a chunked body without a length at the limit; the sniff runs before anything is written; the safe open refuses a directory, an oversized file and a file on another device; `noStore` keeps a handler's header; advisory health checks.
- **API integration** against `korbat_test`, with a fake worker that writes results by the protocol: upload, status and finalize; every limit; attach rules (not yours, not ready, already attached, five images, no alt text, repeated id); a post with images and no text; a post with neither refused; images in timelines, threads, profiles and quotes; deleting a post removes rows and requests deletion; serving for visible, withheld, removed, deleted and unattached; `ETag` and 304; the sweeper's five jobs with a moved clock.
- **Architecture**: the rules in 2.6, each with a violation proven to fail.
- **Web**: typecheck and export; a scripted browser check of upload, description, post, grid, viewer and delete.
- **Docker**: the smoke test uploads a JPEG carrying GPS data through Caddy, waits for ready, posts it, and fetches `large.webp`: WebP bytes, the public cache header, no GPS. It then replaces that file with a symlink to `/proc/self/environ` from inside the worker container and expects 404 without any secret in the body. It deletes the post, expects 404, and checks that the folder is gone. It checks that the worker has only a loopback interface, that its memory limit is set, and that it never restarted.
- **Worst case**, in the dry run and after every sharp upgrade: the smoke test's `--worst-case` mode uploads flat-colour files at the caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF) and expects all ready, with `OOMKilled` false and no restart.

## 13. Dependencies

| Package | Where | Licence | Notes |
|---|---|---|---|
| `sharp` 0.35.4 | worker | Apache-2.0; prebuilt libvips LGPL-3.0-or-later | no install scripts; published 2026-08-26 |
| `blurhash` 2.0.5 | worker | MIT | no dependencies |
| `expo-image` 57.0.5 | app | MIT | the version Expo 57 expects; published 2026-09-11 |

Removed from the worker: `ioredis`, `@korbat/db`. All additions follow 1a's method: an exact version, the release-age override on that one command, and `check-lockfile-age.mjs` proving every new lockfile entry is at least 7 days old.

## 14. Effects on other documents and later work

- **Main design**: dated amendments record that volumes replace MinIO, that uploads stream through the API instead of signed URLs, that `post_media` has the shape of section 3, that NSFW scoring moves to row 3, and that the worker only processes images. Scheduled database jobs named there (the IP-hash purge of sub-project 4, the explore refresh of 2c) run in the API under a Redis lock, like the sweeper.
- **3b imports**: the quarantine bucket becomes a quarantine volume. Archives of up to 2 GB cannot pass Cloudflare's 100 MB request limit in one request, with or without MinIO, so 3b needs chunked uploads. Imported images enter this pipeline as uploads.
- **Sub-project 3**: scoring fills `nsfw_score` in the worker's slot; withholding already hides images from everyone but the author; CSAM scanning needs the cacheable URLs this slice provides; removal should purge the CDN.
- **Sub-project 4**: back up `media-store` with the database; tune Cloudflare as in section 9; check whether the Node binary in the image is position independent, as sharp's security page advises.
- **README**: new commands, the test database, and how to delete the old MinIO volume.

## 15. Success criteria

2b is done when:

1. A signed-in person can add up to four described images to a post, reply or quote on the web, and everyone who may see the post sees them in timelines, threads, profiles and quotes.
2. Stored images are fresh WebP encodes without metadata, and the original is gone, proven by the worker tests and the smoke test.
3. The worker runs without network, credentials or capabilities, refuses every format outside the allowlist, and survives the worst-case files within its memory limit without a restart.
4. A symlink planted in the store cannot make the API serve a file from outside the volume, proven on the built stack.
5. Images of withheld and removed posts reach only their author, and images of deleted posts are gone from disk.
6. Integration tests run only against `korbat_test`, and the development database gets no new fixtures.
7. The architecture test passes and fails on each deliberate violation.
8. Semgrep and the dependency audit stay clean, and the smoke test and the browser check pass on the built stack.

## 16. Amendments from the dry run (2026-09-19)

The plan was dry-run task by task in a scratch clone before the execution prompts were written, with every gate run by a script that required its expected output. Where the built system differs from sections 1 to 15, this section is the verified version.

### Schema and packages (sections 3 and 4)

| Spec | Built |
|---|---|
| One migration reshapes `post_media` | Two: `0005` drops `path` and makes post, position, width, height and blurhash optional; `0006` adds owner, status, failure reason, creation time, checks and indexes. drizzle-kit asks interactively when one migration both drops and adds columns, which a scripted run cannot answer |
| `@korbat/media-protocol` has no dependencies | It depends on `@korbat/contracts` for the size names and the failure reasons, so the worker's results and the API's responses share one list |
| The social repository owns its transactions | `createPost` and `deletePost` take a `within(tx)` callback, and `@korbat/db` exports the `DbTx` type; the media module attaches and detaches through the `MediaForPosts` interface, and the social module runs without images (`WITHOUT_MEDIA`) when none is wired |

### Worker (section 5)

- The small size and the blurhash come from one resize to raw pixels: the small WebP and the 32-pixel blurhash input are both made from that buffer, so the image is decoded twice (large, then small) rather than three times.
- In production the worker refuses to start without `VIPS_BLOCK_UNTRUSTED`; the image sets it, and a missing value means the image was changed.
- Ultra HDR has no fixture test. sharp 0.35.4 reports a gain map in its metadata but cannot write one, and the suites make every fixture at run time instead of committing binaries. The primary image of such a JPEG decodes like any JPEG, and every output is a fresh encode, so a gain map cannot survive.

### API (sections 6 to 8)

- Media ids are made lowercase by the contract (`MediaId`), and the file route checks the canonical form before it touches the disk. An id in capitals passed the UUID check and then made the volume layout throw, which answered 500.
- The social routes have their own error handler; it now maps `MediaError` like the app's. Without it, posting an image that was not ready answered 500.
- A deletion request stays for ten minutes after it is written (`DELETION_GRACE_MS`), so a slow worker cannot write files for an image whose request was already withdrawn.
- `noStore` sets `Cache-Control` only when the handler set none, so the file route's `public, max-age=300` survives.
- Caddy's upload limit applies to `/api/media` only, through an `@upload` path matcher inside `handle /api/*`.

### Development and stack (sections 9 and 11)

- The API and worker dev scripts run `tsx watch --env-file=.env`, so no shell has to source a file.
- The worst case on the built stack: the four files at the caps all became ready, and the worker's memory peaked at 383 and 385 MiB of its 768 MiB in two runs, without a restart or an OOM kill. The limit keeps about half in reserve.
- On Docker Desktop on this Windows machine, containers' outbound HTTPS is intermittently degraded: Turnstile verifications timed out at 5000 ms right after a heavy image build and, less often, at other times, and an image build's `pnpm install` failed with `ECONNRESET` while single requests got through. The API failed closed, as designed, and nothing in korbat changes for it. The smoke test tries a Turnstile refusal again every five seconds for up to a minute, where a wrong secret still fails, and the stack steps of the prompts say how to surface a build error their redirect hides.
- The smoke test makes its images with the sharp the worker depends on, resolved through `apps/worker/package.json`, and runs every container command with its standard input closed.

### Web (section 10)

- A HEIC photo is recognized by its name too, because browsers on Windows often give such a file no type; it gets the HEIC advice instead of the generic refusal.
- A quoted post's thumbnails are pictures, not buttons: the quote is one link to the quoted post, and a control inside a control is one that assistive technology cannot reach.
- The blurhash fades into the image in 150 ms, or at once when the system asks for reduced motion.
- The ALT control reports its state with `aria-expanded` and the Post button with `aria-busy`: react-native-web 0.21 ignores the `accessibilityState` prop, which the browser check caught on the ALT control. The older uses of `accessibilityState` in the app were fixed afterwards, in commit `1f5580a` (spec `2026-09-21-screen-reader-states-design.md`).
- The browser check covered sign-up, three uploads with their states, descriptions, the button naming what is missing, posting, the three-image grid, ALT, the viewer with arrow keys, Escape and focus return, an image-only post, and deletion down to the files on disk.
- A task step checks, in the installed source, the four library behaviours the grid and viewer rely on: expo-image puts `accessibilityLabel` into `<img alt>` and loads lazily by default; react-native-web's Modal closes on Escape and gives focus back when it closes.

### Test isolation (section 11)

- `scripts/clean-dev-fixtures.mjs` matches only emails of the tests' shape, `<word>-<uuid>@korbat.local`, and profiles without an account. Deleting profiles cascades to their rows, so the counters of kept profiles and posts those rows touched are recomputed from the rows in the same transaction. It prints the counts and up to 25 of each kind. The prompts run it without `--yes`; deletion was verified on seeded data in the scratch clone, where it also removed 117 accounts and 53 profiles that earlier test runs had left.

## 17. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Tasks 5 and 6 of its prompts). Where this document and the audit design differ, the audit design is current.

- **Reconcile refuses large deletions (section 4.7).** The orphan pass refuses when the images without a row exceed 50 and 2% of the store, unless `MEDIA_RECONCILE=force`; `off` skips the pass for a restore window. A database restored from an older snapshot would otherwise lose every image posted since.
- **The store is never opened blocking (section 7.3).** Entries are inspected with `lstat` before they are opened, and opens are non-blocking, so a FIFO planted in the store cannot hold an API thread.
- **The sweeper is a job (section 4.7).** It runs on the API's job runner: one instance at a time, rounds never overlapping, the lock refreshed while a long reconcile runs.
- **Daily upload caps (section 6).** Besides 20 or 120 an hour, an account may upload 60 images a day in its first day and 500 a day afterwards.

- **Avatars stay deferred (section 12, 1b).** The 1b design leaves `profiles.avatar_path` unused; the pipeline is unchanged. The data export reads each ready image's `large.webp` from the store.

## 18. Changed by 3c (2026-10-09)

`docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` (moderation cases) changes who is served an image and when its row and files go. The pipeline, the file protocol and the worker are unchanged. The NSFW score, the scan for child sexual abuse material and the CDN purge that this document left to sub-project 3 are 3d's.

- **Images follow their own state as well as their post's (sections 4.5 and 5.5).** `post_media` gains `moderation_state` (`visible`, `withheld`, `removed`, `sealed`), which only the database's one writer of moderation state sets from the ledger of measures, and `erased_at`. `serve` answers a public image only when the post and the image are both `visible`, a `withheld` or `removed` one (of the post or of itself) to its author only (`private, no-store`), and 404 to everyone for anything else: a sealed image, an image of a deleted post, and an image whose own or whose post's `erased_at` is set. Those are tested before the author's branch, so a sealed image of a withheld post answers 404 to its author too. The lists (`forPosts`) carry each image's state; anyone but the author gets a placeholder (`HiddenMedia`) for a withheld or removed image of a visible post, and a sealed image is that placeholder for every viewer, marked `sealed` only for its author, without size, `blurhash`, alt text or path. `find` and `status` answer a sealed image without its `blurhash`, and a kept row of a deleted or erased post as a row that does not exist. The export's files (`readyImages`) leave out sealed images, images of deleted posts and erased ones, and the export reads the row again when it opens each file.
- **Holds (section 4.6).** A case holds the images of the post it is about: `media_holds`, and `post_media.hold_until`, placed in the intake's own transaction by `MediaForCases.hold`, which first locks the rows in id order. A row is retained while `hold_until` is in the future or its post is frozen. So "serving stops with the commit, because the rows are gone" no longer holds for a retained row: deleting a post, purging an account and every other delete skip it (the trigger `post_media_keep`, BEFORE DELETE, which answers for each row whatever the statement's own filter), no deletion is requested for its files, and it is served and listed to nobody.
- **The freeze and sealed images.** While a report or finding of child sexual abuse material about a post or about its author's account is unanswered, and for as long as a seal that lists the post stands, the post is frozen: no delete path takes its images, held or not, no erasure takes its snapshots, and no staff member is served them. `seal_media` is a measure on every image a case reaches: a sealed image is served, shown and exported to nobody, its author included, and 3c keeps it; the quarantine and the release are 3d's. Staff see an image only through `MediaForCases.staffImage`, the one function that opens an image file for staff, on the console's own origin, never for a frozen post, a sealed or an erased image, and only a file whose header says it is a WebP of the size its row allows.
- **The disposal predicate (section 4.6).** A retained row outlives the deletion that would have taken it, so one deleter takes it when nothing retains it any more: `MediaForCases.dropDisposable`, run by the moderation module's retention job in batches of 25 (half of the 50 orphans the reconcile pass deletes without `MEDIA_RECONCILE=force`). A row is disposable when it is not retained and its post is `deleted_by_author`, its owner is purged, or its own or its post's `erased_at` is set. Its files are requested after each batch's commit, never before, since a deleted post's images can still be frozen at any moment.
- **The sweeper and retained rows (section 4.7).** The sweeper's own deletes are of uploads on no post, which the keep trigger retains only while a hold stands; `existing()` is unfiltered, so the reconcile pass sees retained rows and leaves their files alone. A deletion request lost to a crash names at most one batch, which the reconcile pass makes good without `force`.
- **`post_media_guard` (section 3).** BEFORE UPDATE of `post_id`, `owner_id`, `alt_text`, `position`, `width`, `height` and `blurhash`: an image never leaves its post, so nothing detaches it into the sweeper's reach; a row is attached only to a post of its owner; the owner never changes; and, but for the migrator, an attached row's alt text, position, size and `blurhash` never change, since on an account's case the alt texts on the kept rows are the only copy of them. `post_media_insert` forces the three new columns to their defaults and refuses a row inserted already on a post. A change of `owner_id` is refused for `korbat_api` by its column grant as well.
- **No DELETE on `posts` or `profiles` for the API's role (section 3).** Migration 0015 revokes it. No code deleted a row of either; a cascade that would take image rows is now only ever the migrator's or the superuser's, and the keep trigger raises on one that would take a retained row.
- **Upload limits (section 6).** They stay on account age: the reputation that sub-project 3 was to put in its place does not exist (the 2a design, its section Changed by 3c).
