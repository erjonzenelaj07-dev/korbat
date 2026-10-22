# korbat import from other platforms (sub-project 3b): design

Status: approved for the dry run under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner, and those marked (counsel) need a lawyer's confirmation before korbat is opened to the public. Inputs: the main design's section 6a and its later amendments, the code at the time of writing, the three source formats from their official documentation, and a check of every library against the 7-day release-age floor. One review round (build fit and security; people and values) shaped this text.

Inputs, as cited: korbat-scratch/research-3b/inputs.md ("inputs N"), the main design
docs/superpowers/specs/2026-09-03-korbat-design.md ("main design"), and the designs of 2b, 3c, 3d, 3e, 3f and the UI
sub-project in the same folder. Paths are relative to the repository root C:/Users/Lenovo/Desktop/cool/korbat unless
they start with korbat-scratch. Written against main at 6babae1; committed before Task 1 as
docs/superpowers/specs/2026-10-21-import-3b-design.md (section 13).

## 1. Context and scope

### 1.1 What the owner asked

On 2026-09-14 the owner asked that people can bring their posts from other social media to korbat if they choose.
The main design's section 6a is the brief, and the roadmap row 3b names what it delivers: archive upload for X,
Mastodon and Bluesky, a quarantine, a sandboxed streaming parser, a preview and a choice, imported posts on the
author's profile only, the same image pipeline and checks as native posts, and a one-click undo. On 2026-10-20 the
owner said "finish the app". The UI sub-project runs before 3b (main design, 2026-10-20 amendment), so every screen
of this design is drawn with that sub-project's tokens, components and words modules.

### 1.2 The idea in one paragraph

A person who leaves another platform takes their own words with them, and nothing else. korbat accepts the official
export file the person downloaded themselves, never a password or a handle. The file goes into a quarantine volume
that no backup reads, and a service with no network, no database and no server secret opens only the few files that hold
the person's own public posts. It writes those posts, already converted to korbat's plain text, and their images
into a work folder. The person sees what was found and what will be left out and why, chooses a date range and
whether to bring replies, and confirms. Images then pass through the same pipeline and the same checks as any
upload, at a pace that keeps anyone's own upload ahead of them, and only then are the posts published, on the author's
profile only, under an "Imported" tab, each with a label that says where it came from and what date the archive
gave it. One action removes them all again. korbat keeps no handle, no link and no id from the other platform.

### 1.3 In scope

- Archive upload in chunks of 8 MiB through Caddy and the API into a new volume, `import-archives`, which no backup
  reads, with resume after a lost connection.
- A new service, `importer` (apps/importer), with no network, no capabilities and a read-only root, which reads the
  archive with korbat's own zip reader and streaming JSON and CAR readers and writes normalised posts and allowlisted
  images into a second volume, `import-work`.
- Three adapters: X (a zip), Mastodon (a zip, from 4.2 on) and Bluesky (a `.car`, text only, off by default).
- The contracts in packages/contracts, and the file protocol in a new package, packages/import-protocol.
- The preview, the choice (a date range, replies, long posts, and every post listed with its own "Leave this one
  out"), the confirmation with the person's statement, the progress, the result and the undo.
- Imported images through 2b's pipeline and 3d's checks, fed to the unchanged worker in a lower-priority lane,
  behind an owner's switch that is off by default.
- Imported posts in a profile tab of their own, out of Following, Latest and Explore, with a provenance label on
  every one.
- Migrations 0043 to 0045: the import tables, the new columns of `posts` and `post_media`, their guards, grants and
  row-level security, and the readers' indexes.
- The account's deletion and purge, the data export and the terms extended to imports.
- The staff console shows the provenance label wherever it shows a post, an import's size on a case, and an admin's
  step-up action that ends a whole import.
- Tests built from fixtures that code writes (never a real archive), the zip-bomb, traversal and large-archive labs,
  and the app's browser check extended to the new screens.

### 1.4 Out of scope, and where it goes

- **Meta (Threads, Instagram, Facebook) and Reddit.** Later adapters (section 14). The adapter contract of section
  5.2 is written so that each is one new folder in apps/importer/src/adapters and one new value of the enum
  `import_source`; the pipeline, the preview, the publisher and the moderation path do not change.
- **Bluesky images.** The repository export holds no image files (inputs 3.3). A second, optional archive of blobs
  checked against the CIDs the posts name is a later extension (section 14). korbat never fetches blobs from a PDS.
- **Mastodon archives in `.tar.gz`** (instances older than 4.2) and **X archives split into parts** are refused with
  a sentence that names the reason (section 5).
- **Video, animated GIFs and polls.** korbat has no video and refuses animated images (2b); polls have no korbat
  form. Each is left out and counted in the preview.
- **A "verified import" mark** (main design 6a, line 246). Not built: checking a code in the other profile's bio is a
  fetch by handle, an outbound request to arbitrary hosts and a public link between a pseudonymous account and a
  named one (decision 7).
- **Links to the original post and the other platform's handle** (main design 6a, line 255, `original_url`). Not
  stored (decision 5).
- **Editing an image's description after posting.** korbat has none for native posts either; an imported image is
  attached only with a description, its source's or one the person writes in the preview (decision 20). An edit for
  every image waits for a later sub-project (section 14).
- **Browser-side trimming of the archive.** The whole archive passes through korbat's server, and the start screen
  says so (decision 28); building a smaller zip in the browser waits for room in the web bundle (section 14).
- **Mapping other platforms' accounts to korbat accounts.** Never: mentions stay plain text, are never linked and
  never notify (main design, line 250 and the 2026-09-30 amendment), and links to the source platform become fixed
  words (section 5.3).
- **Self-quotes as korbat quotes.** A quote's text is kept; a quote of the person's own imported post is not turned
  into a korbat quote in 3b (section 14).
- **Native file picking and background upload on iOS and Android.** The web app is the first target; sub-project 5
  brings the same protocol to the native apps.

### 1.5 Rules this design keeps

- **Pseudonymity.** korbat stores no handle, display name, account id, instance, DID or URL of the other platform,
  shows none, and never links an imported mention to a korbat account. It cannot hide that an imported post's words
  are public elsewhere, so anyone who searches them may find the original and the account that wrote it: the person
  is told so before uploading and beside the statement (decision 28).
- **No impersonation.** Only a file the person uploads; no password of another platform; no fetch by handle, DID or
  URL; no scraping. The person states before publishing that the posts are their own and were public, and the label
  never claims more than korbat knows.
- **Data minimisation.** Only allowlisted post and media files are opened; within them, only the person's own public
  originals are kept, decided from the visibility fields before any other field is read. X's direct messages, IP
  logs, contacts, ad data, likes, follows and deleted posts are in files never opened; Mastodon's direct and
  followers-only posts share `outbox.json` with the public ones, so they pass the parser and are skipped by their
  addressing before their content is used. None is ever stored or logged, not even one by one as a skip (7.1).
- **Moderation visible on the post.** Imported posts follow korbat's rules like any post, can be reported, and show
  their moderation status as any post does.
- **Self-owned.** No third-party service. The only outside parts are 3d's adapters, which stay off by default.
- **A chronological feed that imports never flood.** Imported posts enter no feed on their own and no Explore
  ranking; a person may still repost or quote one, one deliberate act at a time (decision 23).
- **Same rules as native posts.** Every imported image goes through 2b's pipeline and 3d's checks; every write of an
  import is judged by 3e's predicate in the statement that locks the author's profile.
- **Supply chain.** Only the libraries inputs.md section 4 verified, exact pins past the 7-day floor, no AGPL.
- **Migrations.** Hand-written SQL where needed, row-level security and grants as every earlier sub-project; no
  existing migration is edited.

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it
costs. All are marked (owner); those a lawyer should confirm are marked (counsel) as well.

1. **Where the archive is parsed (owner).** Chosen: a new service, `importer` (apps/importer), with the image worker's
   profile: `network_mode: none`, `cap_drop: [ALL]`, a read-only root, no database or Valkey credentials, no secret
   but the per-account key of section 5.4, its own memory, CPU and time limits, the archive volume read-only and a
   work volume it writes (section 7.1). Alternative: parse in the image worker, as 6a's line 237 says; that puts
   archive work into the one FIFO queue every upload waits in and puts a zip, JSON and CBOR parser in the process
   that runs the image decoder, which 2b made images-only (main design, line 291).
2. **The zip reader (owner).** Chosen: korbat's own reader of the central directory, in apps/importer/src/zip/,
   about the size of the writer korbat already owns (apps/api/src/account/zip.ts, 304 lines), inflating with
   `node:zlib` `createInflateRaw` and checking `zlib.crc32`, with every limit of section 7.2 (overlap, ratio, size,
   count, names, symlinks, encryption, ZIP64) written and tested by korbat. Alternative: yauzl 3.4.0 (MIT) under
   the same limits, which leaves the overlap and ratio checks to the caller (inputs 4.1).
3. **The upload protocol (owner).** Chosen: korbat's own chunked protocol: chunks of exactly 8 MiB (the last one
   shorter), each a `PUT` at a stated offset that must equal the bytes already stored, with a per-chunk SHA-256, and a
   `GET` that answers the stored offset so the app resumes after a lost connection (section 7.3). Alternative: tus
   (@tus/server 2.4.5, @tus/file-store 2.1.1), with ready clients, but a new server dependency tree whose extensions
   korbat would switch off one by one, and hooks that repeat korbat's session, CSRF and limit checks.
4. **The quarantine and how long anything lives (owner, counsel).** Chosen: two new volumes in no backup:
   `import-archives` (the API writes, the importer reads) and `import-work` (the importer writes, the API reads). The
   archive is deleted as soon as its scan ends, and at the latest 24 hours after the import was created. The work
   output (the person's own public posts and their images, already selected) is deleted when the import is published,
   stopped, cancelled or undone, 24 hours after the preview is ready if the person never confirms, and at the latest
   72 hours after the scan ended whatever happens. The whole archive, other people's messages in it included, passes
   through korbat's server and its network provider (Cloudflare ends TLS before the tunnel) on its way in: no
   browser-side trimming in 3b (the web bundle has 1.9 KB left under its budget after the UI sub-project), so the
   start screen says so plainly and tells the person they may delete the folders and files korbat never reads, named
   per source, from the archive before uploading; the allowlist does not change. Alternative: a folder of
   `media-uploads`, which backups already skip, but the archives would share the images' free-space floor and the
   worker could read them; for the transit, a smaller zip of the allowlisted entries built in the browser (section 14).
5. **What korbat keeps of the source (owner).** Chosen: on each imported post only the source (`x`, `mastodon` or
   `bluesky`), the date the archive gives it and the import it came from; for finding repeats, a hash of each source
   post's id keyed by a random key of the account's own, erased with the account (sections 5.4 and 6.2). No handle,
   display name, account id, instance, DID, link to the original or source post id is stored, shown or logged. The
   hash is still a pseudonymous id: whoever holds the database or a backup of it can test whether this account
   imported a named public post (section 11.1). This changes 6a's line 255, which listed `original_url`: for X and
   Mastodon that URL holds the person's handle elsewhere, shown beside a pseudonymous korbat account. Alternative:
   store the link and show it to the author only, or to everyone.
6. **The provenance label (owner).** Chosen: every imported post shows "Imported from X, dated 3 Mar 2019" under its
   author line, a pressable line that opens its "Who sees this" sheet at the provenance paragraph, which begins with
   the fact that anyone who searches the post's words may find the original and the account that wrote it, then
   "This account imported it from X on 21 Oct 2026. The archive dates it 3 March 2019 (UTC). korbat did not check who
   wrote it or when." (section 10.6). Readers get the day, never the archive's second, which with the text would
   fingerprint the original. Alternative: 6a's shorter "Imported from X, original date", which claims an original
   date korbat cannot know: X and Mastodon archives can be edited and a Bluesky date is set by the client.
7. **No "verified import" mark (owner).** Chosen: not built (6a, line 246). Checking a code in the other profile's
   bio is a fetch by handle (forbidden by 6a's line 236), an outbound request to any Mastodon instance or did:web
   host, and a public, verified link between a pseudonymous account and a named one. Imports of someone else's
   archive are met by the person's statement (decision 14), reports under R6, the label's plain words one press away
   (decision 6), staff's whole-import end (decision 30), and Bluesky off by default, where copying is easiest
   (decision 16). Alternative: build the check behind an adapter that is off by default, as 3d does for outside parts.
8. **Where imported posts appear (owner).** Chosen: on the author's profile in a tab of their own, "Imported", after
   Posts and Replies, newest first by the archive's date; never in Following, Latest, Explore, the Posts tab or the
   Replies tab; a self-thread shows in full on the post's page. Alternative: mixed into the Posts tab by the
   archive's date, which reads as if the person posted on korbat in 2019 and makes the Posts tab's cursor read an
   expression instead of `created_at`.
9. **Which time a post carries (owner).** Chosen: `created_at` is korbat's time of publication, as for every post,
   because every clock in korbat reads it (write limits, Explore's window, moderation's deadlines, retention,
   cursors); the archive's date is a column of its own, `original_created_at`, which the Imported tab sorts by and the
   label shows. Since every import is then written at once, 3e's flood count, the floor under an admin's finding of a
   spam flood, leaves imported posts out (section 8.5). Alternative: `created_at` set to the archive's date, which
   would put an imported post into every window and deadline as if it were years old.
10. **Which posts can be imported (owner).** Chosen: the account's own original posts and its threads of its own
    replies; replies to other people only when the person turns them on (off by default), then as posts of their own
    without the link to what they answered and without the handle of the person answered (X's and Mastodon's
    leading mentions are removed); X posts dated inside a period `protected-history.js` marks as protected only when
    the person chooses them; reposts, boosts, retweets and likes never; on Mastodon only public and unlisted posts,
    decided from the addressing before any other field is read; on X no Circle tweet and no deleted tweet; polls left
    out (korbat has none); on Bluesky every post self-labelled `porn`, `sexual` or `nudity` left
    out, since R1 forbids sexual content. Every left-out post is counted by reason in the preview. Alternative:
    replies to others on by default, or never offered.
11. **Images marked sensitive (owner).** Chosen: the images of a post its author marked sensitive (Mastodon
    `sensitive`, X `possibly_sensitive`) are left out and counted; the post's text is kept. Bulk input of images the
    author flagged is where R1 material would most likely come from, and korbat has no blur to put them behind.
    Alternative: import them and rely on the R1 check, which is off in every build today (inputs 2.3).
12. **Content warnings (owner).** Chosen: korbat cannot hide a post behind a warning, so a Mastodon post with a
    content warning (`summary`) is left out unless the person turns on "Include posts with a content warning" in the
    preview (off by default); an included one begins with the line "Content warning: <summary>" (the words in a shared
    constant), then an empty line, so readers see it is a warning, read before the content. Alternative: always
    include them with the marked line, or drop the warning, which shows the content without the warning its author
    chose.
13. **Long posts (owner).** Chosen: posts over korbat's 1,000 characters are left out by default; the person may
    choose "Shorten them to 1,000 characters", which cuts at the last space within the first 999 characters (or at
    999 when there is none), adds an ellipsis and marks the post ", shortened on import" in its label. Posts over 30,000
    characters (beyond any source's own limit) are left out as unreadable. Alternative: split a long post into a
    thread of korbat posts, which makes posts its author never wrote as such.
14. **The person's statement (owner, counsel).** Chosen: the confirm step requires a checkbox, "These are my own
    posts, and they were public where I posted them.", with under it "If they are not, korbat can remove them, and it
    can count against your account." Its time is recorded on the import. It answers two facts no archive proves: who
    wrote the posts (inputs 3.4) and whether they were public; for X, posts from protected periods are left out unless
    the person chooses them beside a sentence saying they were not public then (section 5.5). Alternative: no
    statement, relying on reports alone.
15. **Imported images, and while no matcher is on (owner, counsel).** Chosen: images are imported only while the
    owner's switch `IMPORT_IMAGES` is `on`, and the API refuses to start with it `on` while `MEDIA_MATCH` is `off`
    (on an open site `MEDIA_MATCH=test` is refused already, by 3d). So no build imports images today: imports are text
    only until the owner connects a real matcher source, and the preview counts the images left behind with the
    reason. While images are on, the person still chooses whether to bring them ("Bring images", off by default:
    photos can be found by image search and can show other people). Alternative: import images as native uploads
    are, unchecked; a bulk path for thousands of foreign images is not the place to accept what no tool has looked at.
16. **Which sources are on, and Bluesky (owner, counsel).** Chosen: each source has an owner's switch, the list
    `IMPORT_SOURCES` (default `x,mastodon`). Bluesky is off by default: anyone can download anyone's repository
    without signing in (inputs 3.3), so a Bluesky archive proves nothing about who uploads it, and a copied history
    reaches no feed where the person copied would see it. The README says what turning it on accepts. When on,
    Bluesky imports are text only: the export holds no image files and korbat never fetches them from a PDS by DID.
    Alternative: Bluesky on by default, resting on the statement and reports alone; later, an optional second archive
    of blobs, each file accepted only when its SHA-256 equals the digest of a CID a kept post names (section 14).
17. **The worker's lane for imported images (owner).** Chosen: the worker is not changed. The API's import feeder
    puts an imported image into the worker's `incoming/` only when no other upload waits there for the worker, with
    at most two imported images in flight and at most `IMPORT_IMAGES_PER_HOUR` (600 by default) on the site, so a
    person's own upload waits behind at most two imported images (section 7.4). Alternative: a second queue directory
    the worker drains only when `incoming/` is empty (a protocol change in packages/media-protocol and apps/worker),
    or a second worker container if the host has the CPU.
18. **A refused image stops the import (owner, counsel).** Chosen: an import prepares every chosen image before it
    publishes any post. If 3d's matcher refuses one of them, the import stops before anything is published: the
    refused upload is held and told exactly as 3d holds and tells any refused upload, the person reads 3d's notice and
    one sentence that the import stopped, naming the post the image came from by its date and first words (never the
    image) and offering to import the text only, the other prepared images and the work output are deleted unopened,
    and no measure touches the account (main design, lines 370, 371 and 401). One archive therefore spends at most two
    of the site's 20 refusals an hour (the images in flight when the first was refused). An image whose match does not
    act is not published at all (section 8.1): an importer did not choose it image by image. Alternative: skip that
    post and continue, which goes on processing an archive known to hold such material; publish a non-acting match as
    for a native post.
19. **Images whose check is not answered (owner).** Chosen: while a matcher is on, an imported image whose check is
    `unchecked` or `capped` waits for 3d's `match-retry` for up to 24 hours from its upload; an image still not
    `clear` then is left out of its post and counted. Alternative: treat imports as native uploads, which may be
    posted with an unanswered check (3d design, 7.8 step 6).
20. **Images without a description (owner).** Chosen: korbat has no way to edit an image's description after
    posting, for native posts either, so an imported image is attached only with a description: the one its source
    gave (cleaned, at most 1,000 characters) or one the person writes for it in the preview's list of posts; an image
    with neither (every X image, many Mastodon ones, unless described) is left out and counted `no_description`, and
    2b's rule that every attached image has a description holds unchanged. Alternative: attach such images without
    one under a relaxed CHECK, which leaves screen-reader users "No description was given" with no way for the author
    to fix it; or an edit of descriptions for every image first (section 14).
21. **The limits of an import (owner).** Chosen: an archive is a file its uploader writes, so a made-up one is a bulk
    write path. An account may import only once it is at least 7 days old (`IMPORT_MIN_ACCOUNT_AGE_DAYS`) and its
    email is verified (`import_too_soon` otherwise); an account younger than 30 days publishes at most 1,000 posts per
    import (`IMPORT_MAX_POSTS_NEW`), the rest counted `new_account_cap`. One active import per account; three
    published imports per account in seven days (a failed, wrong, cancelled, expired or refused one costs nothing),
    and five imports started per client address in a day, with a sentence of its own; at most 2 GiB uploaded, 50,000
    posts kept and 5,000 images kept per import; at most two archives being uploaded or scanned on the site at once
    (`IMPORT_MAX_ACTIVE`, 2, under a lock). Imports never count against 2a's post limits, 2b's upload limits or 3e's
    flood count (section 8.5), since they reach no feed and never use the upload route; against the bulk path staff
    see an import's size on a case and an admin can end a whole import (section 8.7), and RichText marks every link
    `rel="nofollow ugc noopener"`. Alternative: count imports in the existing buckets, which makes an archive of 3,000
    images six days of a person's daily upload cap; or no age floor, which lets a fresh account publish 50,000 posts.
22. **Undo (owner).** Chosen: one action, "Remove imported posts", tombstones every post of the import through the
    author's own deletion path, in batches of 200 under a job, with its progress on the import screen; it keeps the
    freeze, the holds, evidence and every counter right, as every deletion does. The API role still cannot delete a
    post (migration 0015). Alternative: a migrator-owned hard delete, which would bypass the freeze and the holds.
23. **Counts and reposts (owner).** Chosen: imported posts count in the profile's post count, as every post does, so
    a deletion or an undo needs no branch; anyone may like, reply to, quote or repost an imported post, and a repost
    reaches the reposter's followers as any repost does, one deliberate act at a time under 2a's repost limit; the
    words say so (section 10.9). Alternative: leave imported posts out of the count and out of reposts.
24. **Importing the same archive twice (owner).** Chosen: a later import by the same account skips every post an
    earlier import of the account published and that still exists, and the preview counts them as "already
    imported"; the key is per account, so two accounts importing the same archive are not linked by it. Alternative:
    no check, which doubles a profile with one click.
25. **The import's record (owner, counsel).** Chosen: the `import_jobs` row holds the source, the state, the times, the
    person's choice and counts only, never a file name or a source handle, and no text but the first words of a post
    whose image was refused (at most 80 characters, shown to the person alone, section 8.2); the counts of `not_public`
    skips and the month table leave `scan` when the import leaves `ready`, so nothing derived from private posts is
    kept. It stays while any post of it exists and at least 30 days after its end, and goes with the account's purge.
    Alternative: delete it as soon as the import ends, which takes the undo with it.
26. **Archives korbat refuses (owner).** Chosen: Mastodon archives in `.tar.gz` (instances older than 4.2) and X
    archives split into parts (`isPartialArchive`) are refused with a sentence naming the reason and what can be done;
    for a split X archive, which long-standing accounts most likely have, it says the posts are safe in the archive and
    to try again after korbat's next update, since no source this design used says which part holds
    `data/manifest.js` and the tweets (section 14 holds that research and a text-only read of that part).
    Alternative: add `tar-stream` 3.2.2 for the first and a multi-file upload for the second.
27. **The parsing libraries (owner).** Chosen: `stream-json` 3.7.0 for X's and Mastodon's JSON, and `@ipld/car`
    5.4.7 with `@ipld/dag-cbor` 10.0.2, `cborg` 6.1.3 and `multiformats` 14.0.5 for Bluesky's CAR (the versions of
    2026-10-21; Task 3 pins what is at least 7 days old on its day, and the lockfile-age gate decides), each pinned
    exactly in apps/importer/package.json, every block's CID checked by korbat with `node:crypto` (inputs 4.2, 4.3). Not
    `@atproto/repo` (zod 3 beside korbat's zod 4, a large tree), not `@zip.js/zip.js`, `unzipper` or tus.
    Alternative: korbat's own bounded decoder of the atproto subset of DAG-CBOR, a few hundred lines.
28. **What the import screen says first (owner, counsel).** Chosen: before the upload starts the screen says, one
    sentence each: what an import reads, and that the rest is never opened (for Mastodon, that direct and
    followers-only posts share the posts' file and are skipped by their addressing, never kept or logged); that the
    whole archive passes through korbat's server and its network provider and is deleted when the scan ends, at the
    latest within 24 hours, and which folders and files the person may delete from it first; that anyone who searches
    the words of an imported post can find the original and the account that wrote it; and that korbat did not check
    who wrote the archive. The last two are said again beside the statement. The terms gain a section "Importing
    posts" that says the same, with the licence korbat takes in imported posts and images (the same as for native
    ones), and the data export lists imports (section 11). For counsel, in one list (section 13, Task 8's README):
    holding an archive with other people's messages for up to 24 hours and its transit through the network provider
    (decision 4); the statement as the only proof of authorship and of a post having been public (decisions 14, 16);
    images only behind a real matcher (decision 15); not publishing a non-acting match, holding the refused image and
    the address (decision 18); third parties' personal data in imported posts (handles, replies, photos: the impact
    assessment); the record's 30 days after its end (decision 25); the licence in the terms (section 11.3).
    Alternative: say only what is read and deleted.
29. **No new public figure (owner).** Chosen: `/transparency` gains no count of imports; refused imported uploads are
    counted where 3d already counts refused uploads, and decisions about imported posts where every decision is
    counted. Alternative: a yearly count of imports, which on a small service is a statement about a few known people.
30. **The console (owner).** Chosen: staff see an imported post's label wherever the console shows a post (the case
    page, its snapshot, the composer's preview), and on a case the import's size ("One of 1,240 posts imported
    together"); an admin can end a whole import from a case with the step-up action `import_ended_by_staff`, which
    writes its audit row, mails the person and runs the person's own undo path (section 8.7). There is no console page
    listing imports, archives or staged posts, since nothing in them is a moderation matter until it is published.
    Alternative: an operator's list of active imports, which shows who is moving from where; or no bulk remedy, which
    leaves staff one post at a time against 50,000.

## 3. What exists

A short summary of korbat-scratch/research-3b/inputs.md (sections 1 and 2); its text holds the line numbers. No file
in apps/ or packages/ names an import yet.

### 3.1 The brief and what changed it

- Main design section 6a (lines 230 to 255) is the brief. Later amendments change it: the quarantine bucket is a
  volume and uploads stream through the API (2b, lines 290 and 296); the worker is images-only with no network, no
  credentials and no capabilities (line 291); an R1 score opens a finding and withholds one image only where
  `AUTOMATION_R1_ACTS=on` (3d, line 399); an R2 match refuses and holds the one upload, never aborts anything else,
  suspends nobody and reports to nobody abroad (3d, line 400; 3e, lines 370 and 371); imported @mentions never notify
  (2d, line 335); the UI sub-project runs before 3b (line 414).
- 3d's design (`2026-10-09-transparency-automation-3d-design.md`, lines 4170 to 4175) leaves three questions to 3b:
  what an import does when one of its images is refused (decision 18), whether it waits while checks are unchecked
  (decision 19), and the volume a burst of imports puts against the program's caps (section 8.1). 3d makes no
  backfill, and 3b inherits that.
- 3d's `media-quarantine` volume (infra/compose.yml:468) holds sealed files only: it is not the import quarantine.

### 3.2 Posts

- `posts` (packages/db/src/schema/content.ts:22 to :67): `body` at most 1000 code points (CHECK `posts_body_len`),
  `reply_to_id` and `quote_of_id` (set null on delete), `state`, four counters, `created_at`, `deleted_at`,
  `moderation_level`, `erased_at`, Explore's three columns; indexes `posts_author_created_idx`,
  `posts_created_id_idx`, `posts_reply_to_created_idx`, the partial `posts_latest_idx`; row-level security with one
  policy for the API role.
- The API role may UPDATE only `body`, `state`, `deleted_at` and the four counters, and may DELETE no post or profile
  (packages/db/migrations/0015_greedy_zuras.sql:423, :426). `posts_guard` (last replaced in
  0028_orders_ledger.sql:125) forces an insert's state and level to visible.
- `createSocialRepo().createPost` (apps/api/src/social/repo.ts:535 to :565) writes one post per transaction:
  `guardPair`, `lockActing` (3e's predicate on the locked author row), `lockLive`, the insert, the counters,
  `within` (images attach here), `judgeActing`. `deletePost` (:579) tombstones (`deleted_by_author`, `body = ''`) and
  fixes counters; the flow (apps/api/src/social/flows/posts.ts:90) detaches images and keeps every image a case
  holds or a frozen post owns. `purgeProfile` (:1361) tombstones every post of a deleted account.
- The body rules (packages/contracts/src/social.ts:26 to :59): `POST_MAX_LENGTH` 1000, `normalizePostBody`,
  `PostText` refusing control characters and `FORBIDDEN_FORMAT`.
- Readers: `followingTimeline` (repo.ts:838), `latestTimeline` (:861), `profilePosts` (:873), `profileReplies`
  (:888), and Explore's one candidate predicate in `exploreRules` (:458 to :478), whose comment says "Later rules
  about imports belong here". 3f's rule: every new reader answers a `disabled` post as missing, through `postAccess`
  and `isShown` (apps/api/src/social/visibility.ts).

### 3.3 Images

- The upload (apps/api/src/media/flows/upload.ts:44): declared type, `MEDIA_MAX_BYTES` 20 MiB, the account,
  `enforceUploadLimit`, `MAX_PENDING_UPLOADS` 20, the free-space floor `MEDIA_MIN_FREE_BYTES` (2 GiB), then the
  streamed body, sniffed on its first bytes; with the matcher on, `files.receiveHashed` takes SHA-256, SHA-1 and MD5;
  `repo.insertProcessing` (media/repo.ts:155, with `liveNotSuspended`) and `files.commit` hand it to the worker.
- The file protocol (packages/media-protocol/src/layout.ts): `media-uploads` with `tmp/`, `incoming/`, `delete/`,
  `delete-owed/` (the API writes, the worker reads); `media-store` with `files/`, `results/`, `attempts/`, `tmp/`,
  `heartbeat` (the worker writes, the API reads). Ids are lowercase UUIDs the API makes.
- The worker (apps/worker/src/loop.ts): deletions, then at most one upload from `incoming/`, oldest first, then
  result cleanup; 120-second watchdog; three attempts. It has no network, no capabilities, 768m and one CPU
  (infra/compose.yml:239 to :266).
- `post_media` (content.ts:122 to :160): CHECK `post_media_attached_is_complete` requires a description on an
  attached image; `AltText` requires a visible character (packages/contracts/src/media.ts:51).
- The sweeper (apps/api/src/media/sweeper.ts): `PROCESSING_TIMEOUT_MS` 5 minutes, `UNATTACHED_TTL_MS` 24 hours,
  `ORPHAN_AGE_MS` 1 hour.
- 3d's checks: the worker's `Scorer` (apps/worker/src/score.ts; `R1_CLASSIFIER` is `off` or `test` in every build);
  the matcher seam (apps/api/src/media/match-adapter.ts: `off` or `test`); `finalize` (media/flows/status.ts:18) makes
  an image ready only once its check was answered or timed out, and leaves a capped one processing; tables
  `media_hashes` (`check_state` pending, clear, matched, unchecked, capped), `media_matches`, `upload_refusals`
  (packages/db/src/schema/moderation.ts:1298, :1335, :1383); the automated step `imagesPublished`
  (apps/api/src/moderation/automated.ts:351) after a post's commit; 20 refusals an hour, 20 automated decisions an
  hour and 100 a day (0038_automated_decisions.sql:82). The freeze: `post_frozen` and `frozen_for`
  (0015_greedy_zuras.sql:714 to :723).

### 3.4 Accounts, export, limits and jobs

- Standing (apps/api/src/lib/standing.ts): `liveNotSuspended`, `WRITE_CLOCK` and the four rules; the architecture
  test pins every file that names them (apps/api/test/architecture.test.ts:310 to :323).
- Every account is email-verified at creation (apps/api/src/auth/repo.ts:298).
- Deletion and purge: `confirmDeletion` and `purge` (apps/api/src/account/flows/deletion.ts:28, :52), the job
  `account-purge` every five minutes (apps/api/src/account/purge.ts:59).
- The export (apps/api/src/account/flows/export.ts, the `posts` member at :190; `ExportFormat` in
  packages/contracts/src/account.ts:224, `korbat-export-1`, whose member order is part of the bytes).
- Write limits (apps/api/src/social/tiers.ts `limitsFor`): posts 5 or 30 an hour, uploads 20 or 120 an hour and 60 or
  500 a day; the global 300 requests a minute per address (apps/api/src/app.ts:72); `enforceAccountLimit` fails
  closed.
- Body limits: Hono's 64 KiB JSON limit exempts only `POST /api/media` (app.ts:64 to :67); Caddy allows 25MB for
  `/api/media` and 64KB elsewhere (infra/caddy/Caddyfile:55 to :66).
- Jobs run in the API under a Valkey lock (apps/api/src/lib/jobs.ts `createJob`); the API has 512m
  (infra/compose.yml:124).
- Modules are entered through their index only; the architecture test lists seven
  (apps/api/test/architecture.test.ts:28): auth, social, media, account, staff, moderation, transparency.

### 3.5 The app and the console after the UI sub-project

- The UI design (`2026-10-21-interface-experience-ui-design.md`) runs before 3b; 3b builds on what its ten tasks
  leave: the kit in apps/app/src/components/kit/ (Text, Icon, IconButton, Sheet, Menu, Tabs, ListRow, Skeleton,
  EmptyState, ErrorState, StatusChip, VisuallyHidden, PublicFrame; section 10.1 adds three parts), the toasts, the
  Settings index and SettingsNav, the profile's Tabs, PostCard with "Who sees this" (apps/app/src/lib/reach.ts), the
  words modules, the bare-string scan of apps/app/test/a11y.test.tsx, and the app's browser check
  (apps/app/test/browser/app.browser.ts with fixture-api.ts, at 360, 768 and 1280 px in Light, Dim and Dark).
- The profile is apps/app/src/app/u/[handle]/index.tsx; a post is apps/app/src/app/post/[id].tsx. The console
  (apps/admin) shows posts in a case page and its snapshot, under a strict content security policy.

### 3.6 The source formats and the libraries

The formats are inputs 3.1 to 3.3, as section 5 uses them. X's file names are known mostly from open-source parsers,
so the X adapter is tested against fixtures, not trusted as a contract; Mastodon's `outbox.json` holds every status,
direct messages included; anyone can download anyone's Bluesky repository without signing in. The libraries are
inputs 4's, checked against the 7-day floor, none AGPL (decision 27). Cloudflare's request body limit is 100 MB on
Free and Pro and its proxy read timeout 125 seconds (inputs 5.1), so an archive of up to 2 GiB needs chunks.

## 4. The import flow end to end

An import is one row of `import_jobs` (section 6.1) moving through twelve states. The API writes every state; the
importer service (section 7.1) only reads an archive and writes a work folder. Every timed step runs in one API job,
`import-drive`, every five seconds under a Valkey lock (section 7.5).

### 4.1 The states

| State | Meaning | Next |
|---|---|---|
| `uploading` | The archive's chunks are arriving | `scanning`, `failed` (the first chunk is not an archive), `cancelled`, `expired` |
| `scanning` | The archive is complete and waits for, or is in, the importer | `ready`, `failed`, `cancelled` |
| `ready` | The preview is shown; nothing is published | `preparing`, `publishing`, `cancelled`, `expired` |
| `preparing` | Confirmed; the chosen images pass the image pipeline and the checks | `publishing`, `stopped` |
| `publishing` | Posts are written in batches, oldest first by the archive's date | `done`, `stopped` |
| `done` | Every chosen post that could be published was published | `undoing` |
| `stopped` | Ended early: a refused image, the person's Stop, an admin's end (8.7), or time ran out | `undoing` (when posts were published) |
| `undoing` | "Remove imported posts" is tombstoning the import's posts | `undone` |
| `undone` | Every post of the import is deleted | none |
| `failed` | The archive was refused or could not be read | none |
| `cancelled` | The person cancelled before confirming | none |
| `expired` | The upload or the preview was left for 24 hours | none |

The first five states are active: an account has at most one active import, which a unique index enforces (section
6.1). `undoing` is not active, so a person can remove one import's posts while another import runs.

### 4.2 Choosing the source and uploading

1. The person opens Settings, Import posts (/settings/import) and picks a source the site has on (X and Mastodon;
   Bluesky only when the owner turns it on, decision 16). The screen says, for
   that source, how to download the official archive and what korbat reads from it and never reads (section 10.2).
2. They pick the file. The app checks its size against 2 GiB and its first bytes (a zip's `PK\x03\x04`, a CAR's
   varint and CBOR header, or gzip's `\x1f\x8b`, which gets the `.tar.gz` sentence at once) before anything is sent.
3. `POST /api/imports` with `{ source, bytes }` creates the row in `uploading` after these checks, cheapest first:
   imports switched on (`IMPORTS`) and the source among `IMPORT_SOURCES` (decision 16), the account live and not
   suspended (3e's predicate in the statement that locks the profile row), at least 7 days old with its email verified
   (`import_too_soon`, 403; `users.email_verified_at`, set at creation today, 3.4, read through the auth index), no
   active import of the account, the weekly limit (imports of the account with `confirmed_at` in the last 7 days and
   `posts_published` above 0, counted in the create statement) and the per-address limit, fewer than `IMPORT_MAX_ACTIVE`
   imports in `uploading` or `scanning` on the site (counted in the create's transaction under `pg_advisory_xact_lock`
   on a fixed key, as social/repo.ts's `pairLock` takes its own), the importer's heartbeat younger than 60 seconds, and
   free space on `import-archives` of at least the declared size, plus 4 GiB (the most a scan may write to
   `import-work`, section 7.2), plus `IMPORT_MIN_FREE_BYTES`. A refusal for site reasons answers 503
   `imports_unavailable` ("Imports are paused for now. Try again later."), never a partial file.
4. The app sends the file in chunks of exactly 8 MiB (the last one shorter), one at a time, each a `PUT` with its
   offset and its SHA-256 (section 7.3). After a lost connection or a reload the app reads the stored offset and goes
   on from there; the person sees a progress bar and may cancel.
5. The chunk that completes the declared size closes the file with `fsync`, renames it from `archive.part` to
   `archive`, writes the importer's job file and its queue marker, and moves the row to `scanning` in the same request.
   An upload not complete 24 hours after its creation is `expired` and its part deleted by `import-drive`.

### 4.3 Scanning

1. The importer takes the oldest queue marker, reads the job file (source, per-account key, whether images are on)
   and opens the archive read-only. It refuses at once what is not the declared source's archive, an
   X archive in parts, an encrypted zip, or a zip over any limit of section 7.2, and writes a summary with the failure
   code.
2. Otherwise it reads only the source's allowlisted entries (section 5), keeps only the person's own public posts,
   converts each to korbat's plain text, sorts them by the archive's date, and writes `posts.jsonl` (one
   `ImportedPost` a line), the allowlisted images of kept posts when images are on, and last `summary.json`, the
   commit point, with its counts by reason. It never writes a text, a name or an id from the archive to its log.
3. `import-drive` sees the summary, deletes the archive at once, and runs the intake (section 7.5): it reads every line
   of `posts.jsonl` with the contract's parser and caps, finds the posts this account already imported, builds the month
   table the preview needs, notes where the three newest lines start (the preview's samples), and writes the scan's
   counts to the row, which moves to `ready`, or to `failed` with the failure code. A scan not done 45 minutes after the
   upload ended, or 24 hours after the import was created if that comes first, is `failed` with `scan_timed_out`, and
   its archive and work folder go.

### 4.4 The preview and the choice

The preview (section 10.4) shows what was found: the number of posts and the first and last month, the number of
images and how many will be imported, and every count of what will be left out, each with its reason in plain words.
The person chooses:

- everything, or a range of months (from and to, inclusive);
- whether to include replies to other people (off by default, decision 10);
- what to do with posts over 1,000 characters: leave them out (default) or shorten them (decision 13);
- when the archive has them: posts with a content warning (off, decision 12) and X posts from protected periods (off,
  5.5); while images are imported, whether to bring images at all (off, decision 15);
- post by post: "See every post" lists, 50 a page, every post of the archive as it will read (those the choice
  leaves out dimmed), each with a checkbox "Leave this one out" and, while images are brought, its images with a
  description field for each image its source gave none (decision 20). Each change is saved at once in
  `import_picks` (6.1).

The counts under the choice change as it changes, computed by the app from the month table's groups and the picks,
so the button says exactly what will happen: "Publish 1,240 posts". The person ticks the statement "These are my own
posts, and they were public where I posted them." (decision 14), and confirms. A preview not confirmed within 24
hours of the scan is `expired`, and its work folder is deleted.

### 4.5 Confirming, preparing and publishing

1. `POST /api/imports/:id/confirm` with the choice and the statement stores both, makes the row's random seed
   (section 6.1), and moves it to `preparing` when the choice holds images, else straight to `publishing`.
2. **Preparing** (only with images). The feeder of `import-drive` copies each chosen image from the work folder into the
   media pipeline as an upload of the person's (section 7.4): a fresh `post_media` row marked imported, hashed when the
   matcher is on, sniffed and capped exactly as an upload. It feeds them two at a time, only while no person's own
   upload waits for the worker, and at most `IMPORT_IMAGES_PER_HOUR` on the site. Each image settles as kept (ready,
   with a clear check), left out (failed, refused by the pipeline's rules, a match that does not act, not answered by
   the matcher within 24 hours), or refused by the matcher. Only images that will be attached are fed: those of kept
   posts, with a description (decision 20), when the person chose to bring images. The first refusal stops the import
   (section 8.2). When every image has settled, the row moves to `publishing`.
3. **Publishing.** `import-drive` writes the chosen posts in batches of 200, oldest first by the archive's date, each
   batch one transaction of the social module's batch writer (section 6.5), judged by 3e's predicate. After each commit
   the moderation module's `imagesPublished` runs for every new post with images, as for a native post. A suspension
   that starts makes the next batch wait; the import goes on when the suspension ends, or stops when time runs out
   (4.8).
4. When the cursor reaches the end, the row is `done`; the work folder is deleted. The person sees the result
   (section 10.5) and their profile's Imported tab.

### 4.6 Stopping and undoing

- **Stop.** While `preparing` or `publishing`, "Stop import" moves the row to `stopped` (`by_author`) at once;
  published posts stay, unpublished ones and prepared images go with the work folder.
- **Undo.** On a `done` import, or a `stopped` one with published posts, "Remove imported posts" asks once (a Sheet,
  section 10.5), then moves the row to `undoing`. `import-drive` tombstones the import's posts in batches of 200
  through the author's deletion path (section 6.5): body blanked, state `deleted_by_author`, import columns cleared,
  counters fixed, images detached unless a case or a freeze keeps them, their files asked for after the commit. A post
  the person already deleted is passed over; a post disabled under an authority's order is left as it is, as the
  author's own deletion leaves it, and keeps its import columns (it is answered as missing anyway) until the purge
  clears them. When no post of the import is left that is neither deleted nor disabled, the row is `undone`.
- **Single posts.** Any imported post can be deleted on its own from its More menu, as any post.

### 4.7 Deletion with the account

The account's purge (`purge` in apps/api/src/account/flows/deletion.ts) needs no new state. `purgeProfile`
anonymises the profile, tombstones every post of the account, imported ones included, and clears their import
columns in the same statement; the media purge removes every image row, imported ones included, except those 3c and
3d keep; and the same transaction, through the imports module's `purgeOwner`, deletes every `import_jobs` row of the
account, whatever its state, and its `import_keys` row, which `import_jobs_delete` and `import_keys_delete` allow once
the profile is deleted. After the commit the purge asks for the deletion of every archive and work folder those rows
named. A batch of an import that waits at the
profile's lock meanwhile finds the account deleted and its job gone, and writes nothing. A crash between the commit and
the file requests is caught by the orphan pass of `import-drive` (section 7.5), which deletes every archive and work
folder that names no import row. A termination (3e) purges as a deletion does.

### 4.8 Abandonment and time limits

| What | Bound | Then |
|---|---|---|
| An upload not complete | 24 hours after the import was created | `expired`; the part is deleted |
| A scan not done | 45 minutes after the upload ended, or 24 hours after the import was created if that is sooner | `failed` (`scan_timed_out`); archive and work folder deleted |
| A preview not confirmed | 24 hours after the scan ended | `expired`; the work folder is deleted |
| An image whose check is not answered | 24 hours after its upload | left out of its post, counted |
| An import that cannot finish | 72 hours after the scan ended | `stopped` (`time_ran_out`); published posts stay |
| A finished import's record | 30 days after its end, once no post names it | the row is deleted |

The 72-hour bound covers a suspension that outlasts it and a feeder starved by a busy worker. The work folder never
outlives it.

## 5. Formats and adapters

### 5.1 The contract: `ImportedPost`

packages/contracts/src/imports.ts holds the normalised post every adapter's output becomes, shared by the importer,
which writes it, and the API, which reads it back as untrusted input:

```ts
export const IMPORT_SOURCE_KINDS = ["x", "mastodon", "bluesky"] as const;
export const ImportSource = z.enum(IMPORT_SOURCE_KINDS);

/** One kept post, one line of posts.jsonl. The importer writes it; the API parses every line with this schema. */
export const ImportedPost = z.strictObject({
  /** Its line in posts.jsonl, from 0; lines are in ascending order of `at`. */
  ref: z.number().int().min(0).max(IMPORT_MAX_POSTS - 1),
  /** HMAC-SHA256 of the source and the source post's id under the account's import key, as 64 lowercase hex. */
  key: z.string().regex(/^[0-9a-f]{64}$/),
  /** The date the archive gives the post, UTC, whole seconds. */
  at: z.iso.datetime({ offset: false, precision: 0 }),
  /** post: the account's own top-level post; thread: a reply to its own post; reply: a reply to someone else. */
  kind: z.enum(["post", "thread", "reply"]),
  /** The ref of the post a `thread` item answers, always lower than its own ref; null otherwise. */
  parent: z.number().int().min(0).nullable(),
  /** korbat's plain text: converted, cleaned and normalised (5.3); up to IMPORT_TEXT_MAX code points. */
  text: ImportedText,
  /** Images in the work folder, in order; `alt` is the source's description, normalised, or null. */
  media: z.array(z.strictObject({ file: ImportMediaFile, alt: AltText.nullable() })).max(MEDIA_MAX_PER_POST),
  /** X only: dated inside a period protected-history.js marks as protected (5.5); left out unless chosen. */
  protected: z.boolean(),
  /** Mastodon only: the text begins with a content warning's line (decision 12); left out unless chosen. */
  warning: z.boolean(),
});
```

`ImportedText` is `PostText`'s rule with `IMPORT_TEXT_MAX` (30,000) in place of `POST_MAX_LENGTH`.
`ImportMediaFile` is `<ref>-<position>.<jpg|png|webp>`, the only names the work folder's `media/` may hold. A line
whose `kind` is `thread` must have a `parent`, and only then; a line with neither visible text nor an image is never
written. The contract file also holds `ImportSummary` (the importer's summary, section 7.1), `ImportScanFacts` (the
intake's numbers, 6.1), `ImportChoice`, the views and error codes of section 9, and every number of this design as
a constant (`IMPORT_RULES`), as 3d's `AUTOMATION_RULES` does.

### 5.2 The adapter contract

Each source is a folder in apps/importer/src/adapters/ (x/, mastodon/, bluesky/) exporting one `SourceAdapter`:

```ts
export interface SourceAdapter {
  source: ImportSource;
  /** Entry names this adapter may open: exact names, or one anchored pattern per rule (^...$), never a bare prefix. */
  allowlist: readonly EntryRule[];
  /** From the allowlisted entries' names and sizes only: null when the archive is this source's, else why not. */
  detect(entries: readonly ArchiveEntry[]): ImportFailure | null;
  /** Every item the allowlisted files hold, each kept as a DraftPost or skipped with its reason; never throws on one item. */
  readPosts(archive: AllowedArchive, context: ReadContext): AsyncIterable<AdapterItem>;
}
```

- The zip reader (section 7.2) filters the central directory through `allowlist` before `detect` sees any name, so an
  adapter never learns that `direct-messages.js` exists. For a CAR, the archive is one pseudo-entry whose reader
  yields post records only (5.7).
- `AllowedArchive.open(name)` streams one allowlisted entry, inflated and capped; any other name throws.
- `DraftPost` carries the source post id and its parent's id (held in the importer's memory only), the date, the
  kind, the converted text, the flags (`sensitive`, `long`, `protected`, `warning`) and the media's entry names and
  descriptions.
- `AdapterItem` is `{ kept: DraftPost }` or `{ skipped: SkipReason }`; the core counts every skip by reason.
- The importer's core does the rest the same way for every source: the key (5.4), the thread links, the date checks,
  the sort, the image extraction and the writing. An adapter never writes a file.

So 6a's line 254 holds: each source is its `detect` and its `readPosts`; a later source (Threads,
Reddit) is a new folder, a new value in `IMPORT_SOURCE_KINDS` and `import_source`, and its fixtures.

### 5.3 Text conversion, common to all sources

In apps/importer/src/text.ts, in this order:

1. **HTML to text** (Mastodon only): a tokenizer of korbat's own, never a DOM and never rendering: `<p>` and `</p>`
   become paragraph breaks, `<br>` a line break, an `<a>` its text (Mastodon's link text with the invisible spans it
   adds for long URLs is joined back into the href's full text when the text is a shortened form of it), every other
   tag is dropped with its attributes, and the five named entities and numeric entities are decoded.
2. **Unescape** (X only): `&amp;`, `&lt;` and `&gt;` in `full_text`.
3. **Links**: every t.co link is replaced by the `expanded_url` its `entities.urls` gives, since t.co is a click
   tracker; a t.co link with no entity, and a media link (`entities.media[].url`), is removed.
3b. **Links to the source platform** (all sources): their paths hold the person's handle there, or someone else's,
   so each is replaced by fixed words: on X, a link whose host is `twitter.com`, `x.com` or a subdomain of either
   becomes "(a post on X)" when its path is `/<name>/status/<id>`, else "(a profile on X)"; on Mastodon, a link on the
   host of the Note's own `attributedTo` becomes "(a post on Mastodon)" (`/@<name>/<id>`, `/users/<name>/statuses/<id>`)
   or "(a profile on Mastodon)", and a quote's fallback paragraph (class `quote-inline`, "RE: <link>") is dropped in
   step 1; on Bluesky, a `bsky.app` link or an `at://` URI becomes "(a post on Bluesky)" or "(a profile on Bluesky)".
   Each is counted (`sourceLinks`) and the preview says so. Other links stay as text.
4. **Leading mentions**: on X the automatic `@name` run before `display_text_range[0]` is removed, as X itself hides
   it; on Mastodon the run of mention links (`<a class="u-url mention">` in `h-card` spans) at the very start of an
   item with `inReplyTo` is removed in step 1, so a reply keeps no handle of the person it answered. Mentions inside
   the text stay as typed, and are never linked (the last paragraph).
5. **Cleaning**: every control character but tab and line feed, and every `FORBIDDEN_FORMAT` character (invisible
   direction and spacing characters), is removed; each removal is counted (`cleaned`) and the preview says so.
6. **Normalising**: `normalizePostBody` (NFC, line breaks, at most two in a row, trimmed). Steps 5 and 6 run on image
   descriptions too; a description then over 1,000 code points (Mastodon allows 1,500) or with no visible character
   becomes null (counted `cleaned`), so it always meets `AltText` and never fails the line.
7. **Length**: more than 30,000 code points is skipped (`too_long_to_read`); more than 1,000 is kept with the flag
   `long`, for the person's choice (decision 13); the cut itself is the API's, at publication. A line of
   `posts.jsonl` may be up to 256 KiB (30,000 code points of 4 bytes, plus the JSON and the media names), the one
   cap the intake applies (7.5).

Mentions, hashtags and links stay plain text. An imported `@name`, `@name@instance` or X `@name` names someone on
another platform, never the korbat account of that handle, so RichText never links it: it gains a prop `mentions`
(default true), and PostCard, the post page and QuoteEmbed pass `mentions={post.imported === null}`, so an imported
body links URLs only (a test renders "@ada" in an imported post while an account @ada exists, and finds no `/u/`
link). Emoji shortcodes (`:blobcat:`) stay as typed, since custom emoji images are not imported.

### 5.4 Keys, refs and dates, common to all sources

- **The key.** `key = HMAC-SHA256(accountKey, source + ":" + sourcePostId)`, where `accountKey` is 32 random bytes
  made at the account's first import and kept in `import_keys` (6.1) until the account's purge erases it; the API
  writes it into the job file. There is no server-wide import key, so no key of the server alone links a korbat
  account to a source account, and an account's key links nothing between two accounts (decision 24). The
  source post id is the tweet's `id_str`, the Note's `id` URI, or the record's `at://` URI; it never leaves the
  importer's memory.
- **Refs.** After reading, the core sorts the kept posts by date (ties by key) and numbers them from 0; `parent` is
  the ref of a kept post whose source id the item named. A `thread` item whose parent is not kept, or whose
  parent's date is later than its own, becomes a `post`.
- **Dates.** A date before 2006-03-21 (the first tweet) or more than one day after the import was created is skipped
  (`date_out_of_range`); every date is converted to UTC and cut to whole seconds.
- **Limits.** At most 1,000,000 items are read (`IMPORT_MAX_ITEMS`); beyond it the scan stops and the preview says
  the archive was read in part (`over_item_cap`). At most 50,000 posts are kept (`IMPORT_MAX_POSTS`): the core keeps
  the newest 50,000 by date, because a person moving platforms most likely wants their recent posts, and counts the
  rest as `over_post_cap`. For this it keeps in memory, in a heap of at most 50,000 entries, only each candidate's
  date, key, source id, parent's source id and offset (about 10 MB at the cap); the converted text and the media
  names wait in a scratch file on the work volume, which is deleted when the scan ends (section 7.1).
- **Images.** Only while the job file says images are on. At most 5,000 are kept (`IMPORT_MAX_IMAGES`), those of the
  newest posts first, the rest counted `over_image_cap`; each is copied from its allowlisted entry to
  `media/<ref>-<position>.<ext>` after the sort, so only images of kept posts are ever inflated. A named file missing
  from the archive is counted `missing_file`, one over 20 MiB `too_large`, any other type `unsupported`.

### 5.5 X

**Allowlist.** `data/manifest.js`; `data/tweets.js`, `data/tweets-part<N>.js` (N from 1 to 99) and the older
`data/tweet.js`; `data/note-tweet.js`; `data/twitter-circle-tweet.js`; `data/protected-history.js` (for the
protected periods below, its timestamps and actions only); and, only when images are on, files matching
`^data/tweets?_media/[0-9]{1,20}-[A-Za-z0-9_-]{1,64}[.](jpg|jpeg|png|webp)$`. Every other entry, `account.js`,
`direct-messages*.js`, `ip-audit.js`, `deleted-tweets.js`, `like.js`, `follower.js` and the rest of inputs 3.1's list
included, is skipped by name from the central directory and never inflated.

**Detect.** `data/manifest.js` is present and at most 1 MiB; otherwise `not_this_source`. Its prefix must match
`^window\.__THAR_CONFIG = ` exactly and the rest parse as JSON (never evaluated); `archiveInfo.isPartialArchive`
true is `partial_archive` (decision 26). From it the adapter reads `userInfo.accountId` and the file names under
`dataTypes.tweets.files`, `dataTypes.noteTweet.files` and `dataTypes.twitterCircleTweet.files`, each of which must
also be on the allowlist; `userName` and `displayName` are never read into a variable. Without a manifest's file list
the three fixed names are tried.

**Read.** Each data file's prefix must match `^window\.YTD\.[a-z_]+\.part[0-9]+ = ` exactly and is dropped; the rest
streams through stream-json's parser with `packValues: false` (strings, keys and numbers arrive as chunks), under
korbat's own small assembler (apps/importer/src/json.ts) that builds one element at a time, counting its bytes and
depth, and throws `item_too_large` past 1 MiB or a depth of 64 before more is held; stream-json's own Assembler and
array streamer are not used, since they hold an element whole before its size can be read. Elements are
`{ "tweet": {...} }` or, in 2019 archives, the bare object. For each:

| Field or case | Rule |
|---|---|
| `full_text` starts with `RT @` | skipped, `repost` |
| `id_str` in `twitter-circle-tweet.js` | skipped, `not_public` (the Circle file is read first, ids only, into a set) |
| `edit_info` names later versions | only the highest id of `editTweetIds` is kept; the others are skipped, `older_version` |
| `in_reply_to_status_id_str` set, `in_reply_to_user_id_str` equals the manifest's `accountId` | `thread`, parent by that id |
| `in_reply_to_status_id_str` set, any other user | `reply` (kept only if the person includes replies) |
| no reply field | `post` |
| quote (a trailing status link of twitter.com or x.com) | kept as text; the link becomes "(a post on X)" (5.3 step 3b) |
| `created_at` (`Wed Oct 10 20:19:24 +0000 2018`) | the date, parsed by a strict pattern, UTC |
| truncated post whose `note-tweet.js` entry has the same second and a text that starts with the tweet's visible text before its ellipsis | the note's `core.text` replaces the text; unmatched notes are ignored |
| `possibly_sensitive` true | images left out, `sensitive`; text kept |
| `extended_entities.media` (else `entities.media`) of `type` `photo` | an image: the file `<id_str>-<basename of media_url_https>` in the media folder, no description |
| media `video` or `animated_gif` | not imported, counted `video` |

Protected accounts have no per-tweet mark, but `data/protected-history.js` records when protection was turned on and
off: only its timestamps and actions are read, and a tweet dated inside a protected period is marked `protected`. Such
posts are left out unless the person chooses them in the preview, beside the sentence "If your account on X was
protected, its posts were not public then. Do not import them unless you mean to make them public." (decision 14).
`deleted-tweets.js` is outside the allowlist, so deleted posts are never read.

### 5.6 Mastodon

**Allowlist.** `outbox.json` at the archive's root; and, only when images are on, files matching
`^media_attachments/files/([0-9]{3}/){1,8}original/[0-9a-f]{16}[.](jpg|jpeg|png|webp)$` which a kept Note names. A
deeper path or one with `..` matches neither source's pattern (x.test.ts, mastodon.test.ts).
`actor.json`, `likes.json`, `bookmarks.json`, `avatar.*` and `header.*` are never opened.

**Detect.** `outbox.json` present at the root and at most 1 GiB uncompressed, and `actor.json` present (its name is
read from the central directory; the file is not opened); else `not_this_source`. A gzip archive is refused before the
importer by its first bytes (`tar_gz`).

**Read.** stream-json's parser and korbat's assembler (5.5) stream `orderedItems` one item at a time, each at most
1 MiB and 64 levels deep. The order of the checks is the data-minimisation rule: for each item the adapter reads
`type` first, then the Note's `to` and `cc`, and only for a kept Note any other field.

| Field or case | Rule |
|---|---|
| `type` `Announce` | skipped, `repost`; its embedded object is never read |
| `type` `Create`, Note addressing: `to` holds `https://www.w3.org/ns/activitystreams#Public` | public: kept |
| `to` holds the followers collection and `cc` holds as:Public | unlisted: kept (it reaches the profile only, as on korbat) |
| no as:Public in `to` or `cc` | private, direct or limited: skipped, `not_public`, before any other field is read |
| object `type` `Question` | skipped, `poll` |
| `inReplyTo` names a status of the Note's own actor (its `attributedTo` followed by `/statuses/`) | `thread`, parent by that URI (the core keeps the link only when that parent is kept) |
| `inReplyTo` anything else | `reply` |
| `quote`, `quoteUri` or `_misskey_quote` | kept as text; the quoted post's URI is not added |
| `summary` not empty | the text begins "Content warning: <summary>", then an empty line; marked `warning`, left out unless chosen (decision 12); counted in `warnings` |
| `published` (ISO 8601) | the date |
| `updated` | ignored: only the current version is in the archive |
| `content` | HTML to text (5.3); `contentMap` is not read |
| `sensitive` true | images left out, `sensitive`; text kept |
| `attachment` of `mediaType` image/jpeg, image/png or image/webp | an image: the path from `url`, normalised (a leading slash and anything up to `media_attachments/` dropped) and matched to an allowlisted entry by that exact remaining path; `name` is the description |
| other attachments (video, audio, gifv, a Link card) | not imported, counted `video` or ignored for a card |
| `tag` (mentions, hashtags, emoji) | not read: the text already holds what was typed |

A Note's `attributedTo` is read only to tell a self-reply from a reply, never kept, and is not compared with
`actor.json` (which is never opened): the outbox holds only the account's own statuses (inputs 3.2).

### 5.7 Bluesky

**Allowlist.** The CAR's header, its commit block, the MST nodes reached from the commit's `data`, and the record
blocks whose MST key starts `app.bsky.feed.post/`. No other record is decoded, no blob is read (there are none), and
a `chat.jsonl` or anything else that is not a CAR is refused by its first bytes at upload (`not_an_archive`).

**Detect.** The first bytes are a varint and a DAG-CBOR map `{ version: 1, roots: [cid] }` with exactly one root;
the root's block is a commit `{ did, version: 3, data, rev, prev, sig }`. The DID is used only to recognise the
account's own `at://` URIs in replies; it is never stored, logged or written to the work folder.

**Read.** Two passes over the file (inputs 4.3), since a CAR's blocks come in any order: pass 1 with `@ipld/car`'s
`CarIndexer` records each block's CID, offset and length without decoding, refusing a block over 1,000,000 bytes and
more than 2,000,000 blocks; then the commit is decoded and the MST walked from `data` (at most 48 levels, at most
4,096 entries a node, every node visited once), collecting the record CIDs of the keys `app.bsky.feed.post/<rkey>`;
pass 2 reads and decodes only those records with `@ipld/dag-cbor`. Every block decoded is first hashed with
`node:crypto` and compared with its CID's SHA-256 digest; a mismatch is `unreadable`.

| Field or case | Rule |
|---|---|
| a record under any collection but `app.bsky.feed.post` (reposts, likes, follows, lists, profile, gates) | never decoded |
| `reply.parent.uri` is `at://<the commit's did>/app.bsky.feed.post/<rkey>` | `thread`, parent by that URI |
| `reply` to any other URI | `reply` |
| `embed` `app.bsky.embed.record` or `recordWithMedia` (a quote) | kept as text; the quoted URI is not added |
| `embed` `app.bsky.embed.images`, `gallery` or `video` | not imported: the export has no files; counted `bluesky_no_files` |
| `embed` `app.bsky.embed.external` (a link card) | the card is dropped; the text keeps the link as typed |
| `labels` self-labels `porn`, `sexual` or `nudity` | skipped, `adult_label` (decision 10) |
| `labels` `graphic-media` | kept; it is not sexual content, and readers may report it under the rules |
| `createdAt` (RFC 3339, set by the client) | the date, converted to UTC |
| `text` | taken as is (it holds no HTML); `facets` are not read: links stay as typed, but for 5.3 step 3b |
| `langs`, `tags` | not read |

### 5.8 The rules side by side

| | X | Mastodon | Bluesky |
|---|---|---|---|
| Self-thread | reply to the manifest's account id | `inReplyTo` a Note of the outbox | `reply.parent` under the account's DID |
| Quote | text kept, link replaced by fixed words | text kept, fallback paragraph dropped | text kept |
| Links to the source | fixed words | fixed words (the instance's host) | fixed words (`bsky.app`, `at://`) |
| Not public | Circle tweets skipped; protected periods left out unless chosen | private, direct, limited skipped first | everything is public |
| Images | `photo`, downscaled copies, no description | `original` files, `name` as description | none in the export |
| Sensitive | `possibly_sensitive`: images left out | `sensitive`: images left out; `summary` kept as a marked first line, posts left out unless chosen | adult self-labels: post left out |
| Text | unescape, t.co expanded, leading mentions removed | HTML to text, a reply's leading mentions removed | as is |
| Long posts | `note-tweet.js`, up to 25,000 | instance limit | 300 graphemes, never long |

## 6. The database

Three migrations, 0043 to 0045, each a drizzle-generated part for the tables, columns and indexes the schema files
declare, followed by hand-written SQL for the triggers, grants and checks, as 0016 to 0042 are written: every
function owned by the migrator, `SET search_path = public, pg_temp`, every object schema-qualified, EXECUTE taken from
PUBLIC, errors raised with their code as the message under SQLSTATE P0001 (or 42501 for a forbidden column), enum
values compared as text. No existing migration is edited. The schema gains packages/db/src/schema/imports.ts and
changes packages/db/src/schema/content.ts.

### 6.1 `import_jobs`, `import_picks` and `import_keys`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid primary key | made by the API (`randomUUID`); it names the import's folders |
| `owner_id` | uuid not null, references `profiles` | no on delete clause: no profile row is ever deleted |
| `source` | `import_source` (`x`, `mastodon`, `bluesky`) | |
| `status` | `import_status` (the twelve states of 4.1) | forced to `uploading` at insert |
| `declared_bytes` | bigint not null | CHECK between 1 and 2147483648 (`IMPORT_MAX_BYTES`) |
| `received_bytes` | bigint not null default 0 | CHECK between 0 and `declared_bytes`; only grows |
| `created_at` | timestamptz not null | forced to `clock_timestamp()` at insert |
| `uploaded_at`, `scanned_at`, `confirmed_at`, `ended_at` | timestamptz | each set once, by the move that names it |
| `failure` | text | CHECK in the closed list `IMPORT_FAILURES` (section 9.3); set exactly when `status` is `failed` |
| `stop_reason` | text | CHECK in `refused_image`, `by_author`, `by_staff`, `time_ran_out`; set exactly when the import was stopped (it stays through `undoing` and `undone`) |
| `staff_ended_at`, `staff_rule_id` | timestamptz; text | set together, once, by the admin's `import_ended_by_staff` (8.7), in the move into `stopped` or `undoing` |
| `refused_at_original`, `refused_words` | date; text | the archive's date and the first words (at most 80 code points, CHECK) of the post whose image was refused (8.2), set together, shown to the person alone |
| `scan` | jsonb | the intake's numbers (`ImportScanFacts`): counts by reason, the month table, the sample refs and offsets, the pages; never a text; CHECK an object of at most 262,144 bytes |
| `choice` | jsonb | `ImportChoice` (months from and to, replies, long posts, warnings, protected, images); CHECK an object of at most 1,024 bytes |
| `stated_at` | timestamptz | the person's statement; set with `choice`, never without it |
| `seed` | bytea | 32 random bytes made at confirmation, from which the import's post and image ids are derived (6.5); cleared when the import ends (`done` or `stopped`) |
| `post_cursor` | integer not null default 0 | lines of `posts.jsonl` handled; only grows |
| `image_cursor` | integer not null default 0 | images handed to the feeder; only grows |
| `posts_published`, `images_kept`, `images_left_out`, `posts_removed` | integer not null default 0 | progress counts; only grow |

Indexes: `import_jobs_one_active` unique on `owner_id` where `status` in (`uploading`, `scanning`, `ready`,
`preparing`, `publishing`), which is the one-active rule; `import_jobs_status_idx` on (`status`, `created_at`) for
`import-drive`; `import_jobs_owner_idx` on (`owner_id`, `created_at`) for the account's list.

Two triggers, plain (not security definer), skipped for the migrator as every guard is:

- `import_jobs_insert`, before insert: forces `status` `uploading`, `created_at`, `received_bytes` 0, the four
  progress counts and both cursors 0, and every other column but `id`, `owner_id`, `source` and `declared_bytes` to
  null; it refuses an owner whose profile is deleted (`not_found`). The live and suspension check is the API's
  statement's, under 3e's predicate (section 8.5), not the trigger's.
- `import_jobs_guard`, before update: `id`, `owner_id`, `source`, `declared_bytes` and `created_at` never change;
  `status` moves only along the arrows of 4.1, and into `undoing` only from `done`, or from `stopped` with
  `posts_published` above 0; `ended_at` is set by the move into `done`, `stopped`, `undone`, `failed`, `cancelled` or
  `expired` and at no other time; `choice`, `stated_at`, `seed` and `confirmed_at` are set together, once, by the move
  out of `ready`; `seed` may then only become null; `uploaded_at` is set by the move into `scanning` with
  `received_bytes` equal to `declared_bytes`; `scanned_at` by the move out of `scanning`; `scan` by the move into
  `ready`, and once more by the move out of it, which drops its `not_public` count, its month table and its samples,
  keeping `fromRef` and the counts the result screen shows; `staff_ended_at` and `refused_at_original` are set once, by
  the moves that name them (8.7, 8.2); counts and cursors never go down. Every refusal raises `import_column` under
  42501.

A third, `import_jobs_delete`, before delete, refuses deleting a row in an active state or in `undoing` unless its
owner's profile is deleted (the purge's own transaction anonymises the profile before it deletes the rows, 4.7).
Deleting a row that a post still names fails on the foreign key (6.2).

`import_picks` (`import_job_id` uuid references `import_jobs` on delete cascade; `ref` integer; `left_out` boolean not
null default false; `alts` jsonb, an array of at most four `AltText` or null, CHECK at most 8,192 bytes; primary key
(`import_job_id`, `ref`)) holds the person's choices post by post (4.4). `import_picks_guard`, before insert or update,
refuses unless the job is `ready`; `import-drive` deletes a job's picks when it ends, and the cascade in any case.

`import_keys` (`owner_id` uuid primary key, references `profiles`; `key` bytea, CHECK 32 bytes; `created_at`) holds
each importing account's random key of 5.4, inserted at its first import (`on conflict do nothing`). It is never
updated; `import_keys_delete`, before delete, refuses unless the owner's profile is deleted, so only the purge
erases it.

### 6.2 New columns of `posts`

| Column | Type | Rule |
|---|---|---|
| `import_job_id` | uuid, references `import_jobs` | no on delete clause: a job row cannot go while a post names it |
| `import_source` | `import_source` | the source, for the label |
| `original_created_at` | timestamptz | the archive's date, for the Imported tab and the label |
| `import_shortened` | boolean | the post was cut to 1,000 characters on import |
| `import_key` | bytea | the key of 5.4, 32 bytes |

CHECK `posts_import_columns`: the five are all null (a native post, or a tombstone) or all set. Every native post is
untouched: the columns are null and nothing that writes them today changes.

Indexes:
- `posts_import_key_idx`, unique, on (`author_id`, `import_key`) where `import_key` is not null: a post is imported
  once per account while it exists (decision 24).
- `posts_imported_idx` on (`author_id`, `original_created_at`, `id`) where `import_job_id` is not null and
  `reply_to_id` is null: the Imported tab.
- `posts_import_job_idx` on (`import_job_id`, `id`) where `import_job_id` is not null: the undo, the foreign key's
  checks and the job's count of posts.
- `posts_author_native_idx` on (`author_id`, `created_at`, `id`) where `import_job_id` is null: Following's own
  branch and the Posts and Replies tabs, so a followed account's 50,000 imported posts are never scanned there.
- `posts_latest_idx` is replaced by the same index with `and import_job_id is null` added to its predicate.

`posts_import_guard`, before insert or update, plain, skipped for the migrator:

- An insert with `import_job_id` set must name a job whose `owner_id` is the post's `author_id`, whose `status` is
  `publishing` and whose `source` is `import_source`; its `original_created_at` must lie between 2006-03-21 and one
  day after the job's `created_at`; its `quote_of_id` must be null; and its `reply_to_id`, when set, must name a post
  of the same job. So an import can write only its own author's posts, only while it publishes, and never a reply to
  or a quote of anyone.
- An update may change the five columns only to null, all at once, and only in the statement that makes the post's
  state `deleted_by_author` or on a row already in that state (the author's deletion, the undo, the purge); no update
  ever sets them. Refusals raise `import_column` under 42501.

Grants: the API role gains UPDATE on the five columns (posts' column grants of 0015 name seven; the guard decides what
an update may do). It still has no DELETE on `posts`.

### 6.3 New columns of `post_media`

| Column | Type | Rule |
|---|---|---|
| `imported` | boolean not null default false | the image came from an import; it never changes |
| `import_job_id` | uuid, references `import_jobs` on delete set null | the running import that owns the upload; it lets the sweeper leave it alone and the import clean it up |

CHECK `post_media_attached_is_complete` does not change: an imported image is attached only with a description
(decision 20). CHECK `post_media_import_link`: `import_job_id is null or imported`.

`post_media_import_insert`, before insert, plain, skipped for the migrator: an insert with `imported` true must name an
`import_job_id` whose job has the row's `owner_id` and status `preparing`; one with `imported` false must name none.
The API role gets no UPDATE on either column, so neither changes after the insert; `on delete set null` runs as the
table's owner. `post_media_import_attach`, before update of `post_id`: an imported image is attached only to a post
whose `import_job_id` is its own `import_job_id`.

### 6.4 Row-level security and grants

| Table | RLS | API role |
|---|---|---|
| `import_jobs` | enabled, one policy for the API role (`import_jobs_api_all`), as every table | SELECT, INSERT, DELETE (under `import_jobs_delete`), UPDATE of every column but `id`, `owner_id`, `source`, `declared_bytes` and `created_at`, all under `import_jobs_guard` |
| `import_picks` | enabled, one policy for the API role | SELECT, INSERT, UPDATE of `left_out` and `alts`, DELETE, under `import_picks_guard` |
| `import_keys` | enabled, one policy for the API role | SELECT, INSERT, DELETE (under `import_keys_delete`); no UPDATE |
| `posts` | unchanged | UPDATE of the five new columns under `posts_import_guard`; INSERT as before, under `posts_guard` and `posts_import_guard` |
| `post_media` | unchanged | INSERT of the two new columns under `post_media_import_insert`; no UPDATE of them |

`korbat_auth` gets nothing on any of them; `korbat_notify` nothing. The import module names 3e's predicate in one
statement only, the one that creates an import (section 8.5); every other write of an import is judged inside the
social and media repositories, which already name it.

### 6.5 The writers

Every write of a post or an image row stays in the module that owns the table; the new `imports` module
(apps/api/src/imports/) calls them through the social and media modules' indexes.

- **Derived ids.** A post's id is `uuidFrom(SHA-256(seed || "post:" || ref))` and an image's
  `uuidFrom(SHA-256(seed || "image:" || ref || ":" || position))`, where `uuidFrom` takes the first 16 bytes, sets
  the version-4 and variant bits and writes lowercase hex, so `isMediaId` accepts every image id. A parent's id is
  computed, not looked up, and a repeated batch inserts nothing twice (`on conflict do nothing`). Outsiders cannot
  predict an id without the seed, which is cleared when the import ends.
- **`social.publishImportedBatch(job, lines, now)`** (apps/api/src/social/repo.ts), one transaction per batch of at most
  200 lines: `lockActing` on the author's row `for no key update` (3e's predicate, by `WRITE_CLOCK`); then the job row
  `for update`, which must still be `publishing` at the cursor the caller read; every parent the batch's counter
  statement will write (the parents of its `thread` lines already in `posts`) taken with `lockPostsInOrder`
  (social/repo.ts:1455, in id order, as `createPost` and `deletePost` take theirs); one insert of every post of the
  batch the choice keeps (a line is kept when its ref is at least `scan.fromRef`, its marks pass the choice and its pick
  does not leave it out; a `thread` line whose parent is left out is written as a top-level post), with `created_at` the
  transaction's `now` plus the line's place in the batch in microseconds, so a thread's replies keep their order in
  `replies`, which sorts by `created_at`; the parents' reply counts and the author's post count in one statement each,
  as `purgeProfile` writes them; the batch's settled images attached through `media.attach` (6.3's rules) with the
  source's description or the person's from the pick; the cursor and the counts; and `judgeActing`. The body is the
  line's text, cut for a shortened post (decision 13); a line whose cut text and kept images leave nothing visible is
  skipped. After the commit, `moderation.imagesPublished` runs for each new post with images. A refusal of the predicate
  rolls the batch back and the import waits (4.5).
- **`social.removeImportedBatch(job, now)`**, one transaction per batch of at most 200 posts: the author's row
  `for no key update`; the batch, selected by id from
  `import_job_id = $1 and state <> 'deleted_by_author' and moderation_level <> 'disabled'` (an empty batch is the
  caller's sign to move to `undone`), and every post they reply to, taken with `lockPostsInOrder` (`for no key update`,
  in id order, the order 3c's reports take posts in); the tombstones (`deleted_by_author`, `deleted_at`, `body = ''`,
  the five import columns null); the counters in one statement each; `media.detachAll` for each tombstoned post, inside
  the transaction, whose keep trigger leaves every image a case holds or a frozen post owns; `posts_removed`. The files
  of the rows that went are asked for after the commit, as the deletion flow asks for them
  (apps/api/src/social/flows/posts.ts:90).
- **`deletePost`** and **`purgeProfile`** set the five import columns to null in the statement that tombstones, so a
  deleted imported post keeps nothing of its source.
- **`media.insertProcessing`** (apps/api/src/media/repo.ts:155) takes an optional `{ importJobId }`: with it, the
  upload's row is written with `imported` true and the job's id in the same statement (the owner's row `for key share`
  with 3e's predicate, the hashes when the matcher is on, the closing judgment), so media/repo.ts names
  `liveNotSuspended` and `closingJudgment` no more often than today.
- **`media.deleteImportLeftovers(tx, jobId)`** (media/repo.ts): deletes the job's rows with `post_id` null, in id order,
  under the keep trigger, `returning id`; their files are asked for through the media index, so the imports module
  never names `post_media` or `requestDeletion`.
- **`media.attach`** attaches imported images unchanged: every imported image has a description (decision 20); the
  trigger `post_media_refused` still refuses a refused or held upload.

### 6.6 Retention, and what the purge erases

| What | Kept | Erased by |
|---|---|---|
| The archive (`import-archives/jobs/<id>/`) | until its summary is read; never beyond 24 hours after the import was created | `import-drive`; the purge's request; the orphan pass |
| The work folder (`import-work/jobs/<id>/`) | until the import is `done`, `stopped`, `cancelled`, `expired`, `failed` or `undone`; never beyond 72 hours after the scan | the importer, on the API's request |
| Prepared images not published | until the import leaves `preparing` or `publishing` | `import-drive`, through the media module's deletion (rows held by a refusal stay, as 3d keeps them) |
| `import_jobs` row | while a post names it, and at least 30 days after its end | `import-drive`'s retention step; the account's purge |
| Imported posts | as any post, until the author, the undo or the purge deletes them | the deletion paths of 6.5 |
| Import columns of a deleted post | never: cleared in the tombstoning statement; a disabled post keeps them until the purge | `deletePost`, `removeImportedBatch`, `purgeProfile` |
| `post_media.import_job_id` | until its job row goes | the foreign key's `set null` |
| The seed | from confirmation until the import ends | the move into `done` or `stopped` |
| The account's import key (`import_keys`) | from the first import until the account goes | the account's purge |

The purge (4.7) leaves what 3c, 3d and 3f keep for every account: a case's copy, a sealed or held image, a preserved
post.

### 6.7 The migrations

- **0043_imports.sql.** The enums `import_source` and `import_status`; the tables `import_jobs`, `import_picks` and
  `import_keys` with their checks and indexes; RLS and the policies; the grants; the triggers `import_jobs_insert`,
  `import_jobs_guard`, `import_jobs_delete`, `import_picks_guard` and `import_keys_delete`. Hand-written after the
  drizzle part: the triggers, the column grants, and a comment that names each CHECK's constant in
  packages/contracts/src/imports.ts, which a database test holds equal.
- **0044_imported_posts.sql.** The five columns of `posts` and the two of `post_media`; the CHECKs
  `posts_import_columns` and `post_media_import_link`; `posts_import_key_idx` and `posts_import_job_idx`; the
  triggers `posts_import_guard`, `post_media_import_insert` and `post_media_import_attach`; the grants of 6.4; and
  `decision_actions_check` replaced with 0032's body and one change, `and p.import_job_id is null` in the flood count
  (8.5).
- **0045_import_readers.sql.** The readers' indexes: `posts_imported_idx`, `posts_author_native_idx`, and
  `posts_latest_idx` dropped and created again with its new predicate. Kept apart from 0044 so that the index builds
  on a large `posts` table run in a migration of their own, which the README's upgrade notes name as the slow one.

Each migration's drizzle snapshot is regenerated in packages/db/migrations/meta, as every earlier sub-project's.

## 7. The services

### 7.1 The importer

**The app.** apps/importer, a TypeScript app built like apps/worker: `package.json` (`@korbat/importer`, type module,
the scripts `build`, `typecheck`, `test` and `test:lab`), `build.mjs` (esbuild, one bundle, no native module),
`Dockerfile` on the worker's base image (`node:24.21.0-alpine` at the worker's digest), the runtime stage copying only
`dist/`, creating `/import/archives` and `/import/work` owned by `node`, `USER node`. Dependencies, exact pins:
`@korbat/contracts` and `@korbat/import-protocol` (workspace), `stream-json` 3.7.0, `@ipld/car` 5.4.7,
`@ipld/dag-cbor` 10.0.2, `cborg` 6.1.3, `multiformats` 14.0.5, `pino` 10.3.1 and `zod` 4.6.5 (the versions the
workspace already pins). These are the versions of 2026-10-21; on the day Task 3 runs it pins the four IPLD packages
(`@ipld/car`, `@ipld/dag-cbor`, `cborg`, `multiformats`) to the versions the lockfile then resolves that are at least
7 days old, so one copy of each is installed (`cborg` 6.1.4, published 2026-10-19, passes the floor on 2026-10-26 and
would otherwise resolve beside a direct 6.1.3). Transitive dependencies (`stream-chain`, `varint`) resolve under
pnpm-workspace.yaml's release-age floor; Task 3 records every resolved version, and scripts/check-lockfile-age.mjs
decides.

**The Compose service**, in infra/compose.yml beside `worker`:

```yaml
  importer:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/importer/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 512m
    memswap_limit: 512m
    cpus: 0.5
    pids_limit: 32
    tmpfs: ["/tmp:size=16m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      IMPORT_ARCHIVES_DIR: /import/archives
      IMPORT_WORK_DIR: /import/work
    volumes:
      - import-archives:/import/archives:ro
      - import-work:/import/work
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/import/work/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4
```

The two volumes join the `volumes:` list with a comment each: `import-archives` ("Archives waiting for the importer,
deleted when read and within 24 hours. In no backup, by decision: an archive holds the person's messages and other
people's data.") and `import-work` ("The importer's output, deleted within 72 hours. In no backup."). The API mounts
`import-archives` read-write at `/import/archives` and `import-work` read-only at `/import/work`. Neither the worker
nor any other service mounts them.

**The file protocol**, in a new package packages/import-protocol (`layout.ts`, `limits.ts`, `summary.ts`, `lines.ts`,
`open.ts`), shared by the API and the importer as packages/media-protocol is shared by the API and the worker:

```
import-archives (the API writes, the importer reads)
  jobs/<id>/archive.part   the archive while chunks arrive
  jobs/<id>/archive        the complete archive
  jobs/<id>/job.json       { v: 1, id, source, accountKey, images, createdAt }
  queue/<id>               the API's marker: this archive waits for a scan (oldest mtime first)
  delete/<id>              the API's request: delete the work folder of <id>, and stop scanning it
import-work (the importer writes, the API reads)
  jobs/<id>/scratch        the scan's scratch file (5.4), deleted when the scan ends
  jobs/<id>/posts.jsonl    one ImportedPost a line, in date order
  jobs/<id>/media/<ref>-<n>.<ext>   allowlisted images of kept posts, as found in the archive
  jobs/<id>/summary.json   the commit point, written last (ImportSummary)
  attempts/<id>            how often a scan of <id> started
  tmp/                     files being written; renamed into place
  heartbeat                rewritten every ten seconds
```

Ids are lowercase UUIDs made by the API; `isImportId` refuses anything else before a path is built, as `isMediaId`
does. Every file is written under `tmp/`, flushed and renamed, so the API never sees half a file.

**The API's one opener.** The importer parses hostile input, so the API trusts nothing it wrote, not even a path:
every file of `import-work` the API reads (`summary.json`, `posts.jsonl`, the samples and the preview's pages, each
image the feeder streams or the preview shows) is opened by `openWorkFile` of packages/import-protocol, which
`lstat`s the path and requires a regular file whose `st_dev` is the `import-work` mount root's (a symlink, or a
symlinked folder anywhere on the path, leads elsewhere and is refused), opens it with `O_RDONLY | O_NOFOLLOW` where
the platform has it, `fstat`s the descriptor and requires the same device and inode, and reads only through that
descriptor. A refused file counts as `missing_file`, and the API logs the job id and the code. So an importer taken
over by a crafted archive cannot make the API copy a file of `media-store` into an import.

**The loop** (apps/importer/src/loop.ts), after the worker's: each tick handles deletion requests (removing the work
folder; a request for the archive being scanned aborts that scan), then at most one archive from `queue/` whose job
has no summary and no deletion request, oldest first, then sleeps 1 second when idle. A scan:

1. counts the attempt first (`attempts/<id>`); at a third start it writes the summary `failed: interrupted` without
   opening the archive, so a file that kills the process cannot loop;
2. reads `job.json` (at most 4 KiB, parsed with its schema), clears any earlier output of the job, and opens the
   archive by file descriptor (never following a symlink: `O_NOFOLLOW`, a regular file, at most `IMPORT_MAX_BYTES`);
3. runs the zip reader or the CAR reader, the adapter, the core (section 5), writing `posts.jsonl` and the images;
4. writes `summary.json`: `{ v: 1, id, status: "scanned", posts, images, skipped: { reason: count }, imagesSkipped:
   { reason: count }, cleaned, warnings, sourceLinks, protectedPosts, readInPart }` or `{ v: 1, id, status: "failed",
   failure }`, counts only.

A watchdog of 30 minutes per scan (`IMPORTER_WATCHDOG_MS`) ends the process, as the worker's does; Docker restarts it
and the attempt counter does the rest. The scratch file and the work folder's `tmp/` count against the volume, not
the 16 MB tmpfs. The process holds at most one item, one heap of keys and one image stream at a time.

**What it logs.** The job id, the phase, timings, the failure code, and the counts by reason once, at the end; a line
per item only for `unreadable` and `item_too_large` (its reason and its index in the stream), never for a skip, so the
logs hold no trace of each private post the scan passed over. Never a text, a description, a file name from the archive,
an entry name, a source id, a handle or a DID. A source-scan test (apps/importer/test/log.test.ts) refuses a log call
whose fields name anything but these.

### 7.2 The zip reader and its limits

apps/importer/src/zip/ (`central.ts`, `entry.ts`, `limits.ts`), korbat's own (decision 2):

1. Find the end of central directory record in the file's last 65,557 bytes; follow the ZIP64 locator and record when
   present. A file under 22 bytes, without the record, with a comment that runs past the end, or with more than one
   disk, is `not_an_archive`.
2. Read the central directory, at most `ZIP_MAX_ENTRIES` (200,000) entries and at most 64 MiB of directory, and for
   each entry check, before any name reaches an adapter: the name is at most 512 bytes of valid UTF-8 (or CP437 when
   bit 11 is clear, decoded to ASCII only); no NUL, no backslash, no drive letter, no leading slash, no `.` or `..`
   segment, no empty segment. An entry whose name fails any of these can match no allowlist rule: it is never opened,
   only counted. A directory (trailing slash) or a symlink (`externalFileAttributes >>> 16` with type `0o120000`) is
   ignored and never opened.
3. Filter the names through the adapter's allowlist. Only allowlisted entries are checked further and opened. Two
   central entries with one allowlisted name refuse the archive (`bad_entry_name`), since a reader that takes either
   could be steered.
4. For each allowlisted entry: encryption (flag bit 0) is `encrypted`; a method other than 0 (stored) or 8 (deflate)
   is `unreadable`; its uncompressed size is at most 1 GiB for a data file and 20 MiB (`MEDIA_MAX_BYTES`) for an
   image; its compression ratio (uncompressed over compressed) is at most 100; its data range lies inside the file
   and does not overlap any other allowlisted entry's range (the overlapping-files bomb); the sum of the allowlisted
   entries' uncompressed sizes is at most 4 GiB (`too_large_uncompressed`). The entry and data-file limits are
   above inputs 4.1's 100,000 and 512 MiB: a long-standing X account's archive holds tens of thousands of media files
   beside its data, and a generated `tweets.js` of 60,000 tweets is 400 MB (12.5), which leaves 512 MiB too little room.
5. Opening an entry reads its local header and refuses one whose name, method or flag bit 0 differs from the central
   entry, and, when flag bit 3 is clear, one whose CRC or sizes differ. When bit 3 is set (an entry streamed by its
   writer, as Java's `ZipOutputStream` writes every deflated one), the local CRC and sizes may be zero (or 0xFFFFFFFF
   with a ZIP64 extra) and the central entry's are used. The data range starts after the local header's own name and
   extra lengths (which may differ from the central entry's), and the overlap check of step 4 includes the data
   descriptor (12, 16 or 24 bytes). It inflates with `node:zlib` `createInflateRaw`, counting bytes and stopping one
   byte over the central size (`unreadable`), and checks the CRC-32 with `zlib.crc32` at the end. Nothing is ever
   extracted to a path built from an entry name: a data file streams straight into the adapter's parser, and an image
   streams into `jobs/<id>/media/<ref>-<n>.<ext>`, a name the core makes.

### 7.3 The chunked upload in Caddy and the API

| Number | Value | Why |
|---|---|---|
| `IMPORT_CHUNK_BYTES` | 8 MiB (8,388,608 bytes), fixed in the contracts | under Cloudflare's 100 MB; at 1 Mbit/s one chunk takes about 67 seconds, inside the 125-second proxy read timeout |
| `IMPORT_MAX_BYTES` | 2 GiB (2,147,483,648 bytes) | 6a's cap; 256 chunks, under the global 300 requests a minute |
| Caddy's body limit for a chunk | 9MB | the chunk plus slack, behind the API's own count |
| Chunks per account | 600 an hour (`import-chunk`) | a 2 GiB archive with retries; the global limit still applies |

- Caddy (infra/caddy/Caddyfile, the API's `handle /api/*`): a matcher `@import_chunk` for `PUT` on
  `path_regexp ^/api/imports/[0-9a-f-]{36}/archive$` with `request_body @import_chunk { max_size 9MB }`, and the
  `@json` matcher gains `not @import_chunk`'s path and method, so every other route keeps 64KB.
- Hono (apps/api/src/app.ts): the JSON body limit's exemption grows from exactly `POST /api/media` to that and exactly
  `PUT /api/imports/:id/archive` (the same id pattern).
- The route reads three headers: `Import-Offset` (decimal, the byte at which the chunk starts), `Content-Length`
  (required; at most 8 MiB; exactly 8 MiB unless the chunk ends the archive) and `Import-Chunk-Sha256` (64 lowercase
  hex). It refuses, in this order: an import that is not the caller's or not `uploading` (`not_found`, `wrong_state`);
  an offset that is not the stored size (`wrong_offset`, 409, with the stored size, so a retry learns where to go on);
  a length that breaks the rules above or runs past the declared size (`chunk_too_large`, 413); free space under
  `IMPORT_MIN_FREE_BYTES` (`imports_unavailable`, 503). It then streams the body onto the end of `archive.part`
  (opened with `O_APPEND`, never following a symlink), counting bytes and hashing as they arrive, and stops one byte
  over the length. A short body, a hash that differs, or a lost connection truncates the file back to the stored size
  (`chunk_mismatch`, 400), so the file only ever holds whole chunks that passed. The first chunk's first bytes must be a
  zip's local header or a CAR's header for the declared source, checked before they are kept; otherwise the import
  moves to `failed` (`tar_gz` for gzip's first bytes, else `not_an_archive`) and the route answers `not_an_archive`.
- After a chunk the row's `received_bytes` is updated in one statement that also requires the old value, so two
  requests racing for one offset cannot both win; the file's own size is the truth the route reads first, and a
  row behind its file (a crash between the write and the update) is set to the file's size on the next request.
- The last chunk `fsync`s, renames `archive.part` to `archive`, writes `job.json` and `queue/<id>`, and moves the row to
  `scanning` with `uploaded_at`.
- `GET /api/imports/:id` answers `receivedBytes` for the app's resume. The app sends one chunk at a time, waits for its
  answer, and on a network error reads the import again before it sends anything.

### 7.4 The worker's lower-priority lane for imported images

The worker is not changed (decision 17). The lane is the feeder in apps/api/src/imports/feeder.ts, a step of
`import-drive`, for the one import in `preparing` that has waited longest (one import is fed at a time):

1. It feeds only when no other upload waits for the worker: no file in `media-uploads/incoming/` without a result in
   `media-store/results/` that is not an imported image's. A person's own upload therefore waits behind at most the
   imported images already in flight.
2. At most `IMPORT_IMAGES_IN_FLIGHT` (2) imported images are in `processing` without a result on the site at once.
3. At most `IMPORT_IMAGES_PER_HOUR` (600 by default, an owner's setting that may be lowered) imported images are fed
   on the site in any hour, counted in the limit store (`import-images-site`).
4. To feed one image it computes the derived media id (6.5), streams the work folder's file into
   `media-uploads/tmp/<id>.part` through the media module's own receive path (the 20 MiB cap, the first-bytes sniff
   that refuses animated and unsupported images, the three hashes while the matcher is on), writes the row with
   `media.insertProcessing` and the job's id (6.5), and commits the file to `incoming/<id>`. A file the sniff refuses
   is left out (`unsupported`), never retried. The job's `image_cursor` moves in the same transaction as the row; that
   transaction takes the job row `for no key update` after the owner's row and before the insert, and writes nothing
   unless the job is still `preparing`, so a Stop that commits first leaves no new row.
5. Each round it finalizes its in-flight images through the media module's `finalize` (the sweeper would too, every
   30 seconds) and settles each. Images are on only while a matcher is (decision 15), so every imported image has a
   check: `ready` with a check of `clear` is kept; `ready` with a check of `matched` (a match that does not act: not
   exact, or of another class) is left out of its post as `flagged` and never published (section 8.1); `failed` is
   left out; an image still `unchecked` or `capped` 24 hours after its row was written is left out (decision 19); an
   upload refusal stops the import (section 8.2).

The sweeper (apps/api/src/media/sweeper.ts) leaves imported rows of a running import alone: `failStale` and
`deleteUnattachedBefore` gain `and import_job_id is null`, and `pendingCount` gains `and not imported`, so a person's
own limit of 20 pending uploads never counts imported images. For every import that has left `preparing` or
`publishing` and still has unattached rows, each round (not once, on the move), `import-drive` calls
`media.deleteImportLeftovers` (6.5), which deletes them and asks the worker for their files, as the sweeper asks.

At 600 images an hour, the cap of 5,000 images per import takes a little over eight hours; the 72-hour bound of 4.8
leaves room for a busy worker.

### 7.5 The job `import-drive`

apps/api/src/imports/drive.ts, `createJob({ name: "import-drive", intervalMs: 5_000, lockTtlMs: 60_000 })`, each round
a plain function of the clock that tests call with any time, each step safe to repeat:

1. **Scans done.** For each import in `scanning` with a `summary.json`: delete the archive folder and the queue marker;
   read the summary (at most 64 KiB, `ImportSummary`); on `failed`, move to `failed` and ask for the work folder's
   deletion; on `scanned`, run the intake and move to `ready`.
2. **The intake.** Read `posts.jsonl` line by line, each line at most 256 KiB (5.3 step 7) and parsed with
   `ImportedPost`; refs must run 0, 1, 2 in order and every image file named must exist and be at most 20 MiB. A line
   that fails is counted `unreadable` and dropped from the month table. For an account younger than 30 days, every
   readable line but the newest 1,000 is counted `new_account_cap` and left out of the month table, and `scan.fromRef`
   names the lowest ref that may be published (decision 21). In batches of 1,000 keys, ask which keys the account
   already has on posts (`posts_import_key_idx`) and count them `already_imported`. Build the month table (per month and
   group of marks: posts, images, and images without a source's description), note every 50th line's byte offset (the
   preview's pages) and pick the three newest lines as samples (ref and byte offset). Write it all to `scan` in the move
   to `ready`. Bounded at 50,000 lines and 1 GiB.
3. **Time limits.** The bounds of 4.8, each one statement.
4. **Feeding.** The feeder of 7.4 for the import in `preparing` that has waited longest; an import whose images have
   all settled moves to `publishing`.
5. **Publishing.** For each import in `publishing`, up to ten batches of 200 lines a round (about 2,000 posts every 5
   seconds), through `social.publishImportedBatch`; at the end of `posts.jsonl`, move to `done` and ask for the work
   folder's deletion.
6. **Undoing.** For each import in `undoing`, up to five batches of 200 a round through `social.removeImportedBatch`;
   when its batch is empty (no post of the import is left that is neither deleted nor disabled), move to `undone`.
7. **Retention.** Delete the picks of every import that has ended, and the rows of imports that ended more than 30
   days ago and that no post names.
8. **Orphans** (every tenth round). Delete every folder in `import-archives/jobs/` and every queue marker, and ask
   for every work folder, whose id names no row, once older than one hour (`ORPHAN_AGE_MS`); withdraw deletion
   requests the importer has carried out.

A suspended author's batch is refused by 3e's predicate and the round passes on to the next import; the job never
holds a lock across rounds.

### 7.6 Rate limits

| Bucket | Limit | Key | Where |
|---|---|---|---|
| `import-week` | 3 published imports in 7 days (`confirmed_at` in the window, `posts_published` above 0) | account | counted from `import_jobs` in the create statement (4.2 step 3), not in the limit store |
| `import-address-day` | 5 imports created in a day | client address (`clientIpKey`) | the imports route |
| `import-chunk` | 600 chunks an hour | account | `limitsFor("import-chunk")` |
| `import-act` | 20 confirms, cancels, stops and undos an hour | account | `limitsFor("import-act")` |
| `import-pick` | 3,000 picks an hour | account | `limitsFor("import-pick")` |
| `import-images-site` | `IMPORT_IMAGES_PER_HOUR` (600) | the site | the feeder |
| global | 300 requests a minute | client address | unchanged (apps/api/src/app.ts:72) |

Every limit fails closed (503) when the store cannot count, as `enforceAccountLimit` does. Imports never count in
the `post`, `reply` or `upload` buckets (decision 21).

### 7.7 Settings

In apps/api/src/config.ts and infra/compose.yml's `api` environment, with infra/.env.example (no new secret: the
keys of 5.4 are per account, in the database):

| Setting | Default | Meaning |
|---|---|---|
| `IMPORTS` | `on` | `off` refuses every new import with `imports_unavailable`; running imports finish |
| `IMPORT_IMAGES` | `off` | `on` imports images; the API refuses to start with `on` while `MEDIA_MATCH` is `off` (decision 15) |
| `IMPORT_SOURCES` | `x,mastodon` | the sources a new import may name (decision 16); `bluesky` joins only by the owner's choice, which the README explains |
| `IMPORT_MAX_ACTIVE` | 2 | imports in `uploading` or `scanning` on the site at once |
| `IMPORT_IMAGES_PER_HOUR` | 600 | the feeder's site-wide pace; 0 to 600 |
| `IMPORT_MIN_FREE_BYTES` | 2 GiB | free space kept on `import-archives`, beyond a new import's declared size and the 4 GiB a scan may write |
| `IMPORT_ARCHIVES_DIR`, `IMPORT_WORK_DIR` | `/import/archives`, `/import/work` | the mounts |

## 8. Moderation and safety

### 8.1 R1 and the matcher on imported images

An imported image enters through the media module's own receive path, so through the scorer's and the matcher's
seams, the attach block and the outbox, as 3d's section 16 expects, with no check of its own:

- **The matcher.** While `MEDIA_MATCH` is on, the feeder hashes the file as an upload is hashed and `finalize` asks the
  source before the image is ready (3d design, 7.8 step 3). An acting match refuses and holds the upload (8.2). An
  image whose match does not act is not published: 3d publishes such a native upload and puts it before a person
  afterwards, since its uploader chose it, but an importer chose none of thousands image by image, so korbat does not
  publish first and ask later. It is left out of its post (`flagged`,
  "Images korbat could not accept"), an admin is alerted through moderation's `staffAlert`, its match record is kept
  as 3d keeps the record of an upload with a match that never reached a post, and its file goes with the import's
  leftovers. Nothing publishes it later; the author may post it as any upload, which meets 3d's native rule.
- **The scorer.** As for a native image: scored while `R1_CLASSIFIER` runs a model, and at publication
  `imagesPublished` opens a finding and, only where `AUTOMATION_R1_ACTS=on`, withholds that one image (main design,
  line 399). No build has a model today (inputs 2.3).
- **While the matcher is off.** No image is imported (decision 15), and the preview counts the images left behind.
  3d makes no backfill, and nor does 3b: an import confirmed while images were off stays text only.
- **The caps.** An import meets 3d's caps as native uploads do: 20 refusals an hour, 20 automated decisions an hour and
  100 a day for R1 and for R2 (0038_automated_decisions.sql:82). Three things keep a burst of imports from spending
  them: the feeder's site-wide pace (600 images an hour), at most two imported images in flight, and the stop at the
  first refusal, so one archive spends at most two refusals (both in flight when the first was found). Beyond the
  refusals' cap an upload stays `processing` with its check `capped`, as 3d leaves any; for an imported image that
  wait counts against the 24 hours of decision 19. Beyond a cap on decisions, which an import meets only after its
  posts are published, the automated step writes `capped` and alerts `automation_capped`, as for native posts.
- **Sensitive and adult-labelled content.** The adapters leave out the images of posts their authors marked sensitive
  and every Bluesky post self-labelled `porn`, `sexual` or `nudity` (decisions 10 and 11), before any check runs.

### 8.2 What a refusal does to the import

When the feeder finds that `finalize` stored an upload refusal for one of the import's images:

1. In one transaction: the import moves to `stopped` with `stop_reason` `refused_image`; its unattached rows other than
   the refused one are deleted through `media.deleteImportLeftovers` (the refused row is held for good by 3d's
   `upload_refusals_hold` and the keep trigger leaves it); the seed is cleared.
2. After the commit: the deleted rows' files are asked for; the work folder's deletion is asked for, so the archive's
   other images are deleted without anyone opening them; nothing of the import was published, since images are
   prepared before any post (decision 18).
3. The person is told by 3d's own notice of the refused upload (3d design, 7.12, the screen
   /settings/cases/uploads/[id]), mailed as 3d mails it, and the import screen names the post the image came from,
   never the image (`import.stopped.refused_image`: its date and first words, read from the work line before the
   work folder goes and kept on the row as `refused_at_original` and `refused_words`), links to that notice, and
   offers "Import the text only" (a new upload with images left out).
4. Nothing else happens to the account: no suspension, no restriction, no strike (main design, lines 370, 371 and 401).
   The refusal holds the account's address for a report as every refusal does (3d, 3f). The person may start another
   import later, within the weekly limit; its images go through the same checks.

### 8.3 Text and reports

- Text is never removed or withheld by a program (main design, line 401). An imported post can be reported, by anyone,
  signed in or not, under a rule or the law, exactly as any post: the report form, the notice path, the case, the
  decision, the appeal and the author's case screens do not change.
- Imported posts follow the rules like any post, and a final decision that one breaks a rule counts a strike (3e) as
  for any post. The preview says so before anything is published (`import.rules`, with a link to /rules).
- **Impersonation.** An import of someone else's archive is met by the person's statement (decision 14), by reports
  under R6 ("No spam, scams, impersonation or coordinated manipulation"), and by a label that never claims who wrote
  the post. A decision under R6 may remove the imported posts it names, as any decision may, and an admin may end the
  whole import (8.7).
- Imported @mentions never notify (main design, line 335) and are never linked to a korbat account (5.3): korbat has
  no notifications yet, and when 2d brings them, an imported post's text is never read for mentions.

### 8.4 The provenance label

Every imported post carries its label wherever a card shows it (decision 6, section 10.6). The label is made from
the post's own columns and nothing else, so it can never name the other platform's account.

### 8.5 Suspensions and standing

- An import starts only for a live account that is not suspended: `POST /api/imports` inserts the row in a statement
  that locks the profile row `for key share` with 3e's predicate and ends with the closing judgment, as
  `insertProcessing` does. That statement is in apps/api/src/imports/repo.ts, so the architecture test's
  `STANDING_PREDICATE` pins gain that file for `liveNotSuspended` and `closingJudgment`, once each; no other file of the
  module names them.
- Every batch of writes, the feeder's image rows and the publisher's posts alike, is judged by 3e's predicate in the
  statement that locks the profile row, by `WRITE_CLOCK`, and ends with the closing judgment (lib/standing.ts's four
  rules). A suspension that starts mid-import stops the next batch: the import waits, its screen says
  `import.paused`, and it goes on when the suspension ends, or stops at the 72-hour bound.
- A deletion or a termination purges the import with the account (4.7).
- The undo is the author's own deletion, which a suspended author may still make, as `deletePost` allows today.
- The write routes for a suspended account, each listed in `SUSPENDED_WRITES` of
  apps/api/test/integration/standing-route-walk.test.ts, whose app is built with the imports module: `POST
  /api/imports` refused; `PUT .../archive` allowed (it only completes an upload that ends within 24 hours, and its
  scan publishes nothing); `POST .../confirm` refused (it starts writes); `.../cancel`, `.../stop`, `.../undo` and
  `PUT .../lines/:ref` (9.2) allowed (they only end, delete or choose).
- 3e's flood count, the floor under an admin's finding of a spam flood (`decision_actions_check`, last replaced in
  0032_orders_review.sql:316, and `standing.flood` in apps/api/src/moderation/standing-repo.ts:120), counts only posts
  with `import_job_id` null: an import is published at once by design and is no flood. Migration 0044 replaces the
  function with that one change.

### 8.6 Moderation states on imported posts

An imported post is a post: its `state` and `moderation_level` are the ledger's (3c), it is withheld, removed or
disabled like any post, its images can be sealed, a frozen post keeps its rows through the undo, and every reader
answers a `disabled` post as missing through `postAccess` and `isShown` (3f design, line 237). The new reader of 9.2
(the Imported tab) goes through `visibleTo` and the block rules, as `profilePosts` does, and is listed with the
readers that the 3f rule's test walks.

### 8.7 The staff console's view of imports

- The case page's target (`CaseTarget`'s post member in packages/contracts/src/moderation.ts) gains, last, `imported:
  { source, at, importId, importSize, importedAt } | null`, read from the post's own columns and its job row while they
  hold it (`importSize` is the job's `posts_published`); the console (apps/admin/src/screens/Case.tsx, words in
  apps/admin/src/words.ts) prints "Imported from X, dated 3 Mar 2019" under the post's link and "One of 1,240 posts
  imported together on 21 Oct 2026". The case's evidence copy (3c) does not change.
- **Ending a whole import.** An admin may end the import a case's post came from with a new step-up action,
  `import_ended_by_staff` (`STAFF_STEP_UP_ACTIONS` in packages/contracts/src/staff.ts: target type `import`, the job's
  id; params `{ caseId, ruleId }`), through `POST /api/staff/imports/:import/end` under the admin role. In one
  transaction it writes its audit row (apps/api/src/staff/audit.ts), sets `staff_ended_at` and `staff_rule_id`, moves an
  import in `preparing` or `publishing` to `stopped` (`by_staff`), and then, from `stopped` or `done`, to `undoing` when
  it published posts; `import-drive` removes them through `removeImportedBatch`, the person's own undo path, so freezes,
  holds and evidence stay right. The person is mailed through the auth module's `mailAccount` (template
  `import_ended_by_staff`: the rule, and the case's decision, which can be appealed as any), and the import's screen
  says `import.endedByStaff`.
- There is no console page, route or `staff.js` command that lists imports, archives or staged posts (decision 30).
  An operator reads the import service's health from `docker compose ps` and the API's log lines for `import-drive`,
  which carry counts and codes only.

## 9. The API

### 9.1 The imports module

apps/api/src/imports/ is the eighth module (`MODULES` in apps/api/test/architecture.test.ts gains `imports`): `index.ts`
(`createImports(deps)` returning `routes`, `startJobs(lock)`, `purgeOwner` and `endByStaff`), `context.ts`
(`ImportDeps`, `ImportError`), `routes.ts`, `repo.ts` (which names `import_jobs`; outside the module only the social
batch writers lock its row), `files.ts` (the two volumes, through packages/import-protocol's layout), `feeder.ts`,
`intake.ts`, `drive.ts`, and `flows/` (`create.ts`, `chunk.ts`, `picks.ts`, `confirm.ts`, `end.ts`). It reaches posts
and images only through the social and media modules' indexes (`publishImportedBatch`, `removeImportedBatch`,
`insertProcessing` with `importJobId`, `deleteImportLeftovers`, `attach`, `finalize`, the receive path) and the
moderation module's `imagesPublished`; it names neither `post_media` nor `requestDeletion`
(apps/api/test/architecture.test.ts:113 and :207). apps/api/src/app.ts mounts its routes after the session's resolution,
behind `requireSession` and the CSRF check, like the social routes; `AppDeps` gains `imports?: Imports` and `onError`
(app.ts:99 to :127) an `ImportError` branch, with `Retry-After` for `rate_limited` and the `details` member carrying
`receivedBytes` for `wrong_offset`, so no refusal of 9.4 reaches the client as 500.

### 9.2 Routes

| Method and path | Body | Answer | Notes |
|---|---|---|---|
| `POST /api/imports` | `CreateImportRequest` `{ source, bytes }` | 201 `ImportView` | 4.2 step 3's checks; `import-week`, `import-address-day` |
| `GET /api/imports` | none | `{ imports: ImportView[], sources }` | the account's imports, newest first, at most 20, and the sources `IMPORT_SOURCES` turns on |
| `GET /api/imports/:id` | none | `ImportView` | the owner's only; anyone else gets `not_found` |
| `PUT /api/imports/:id/archive` | the chunk, raw | `{ receivedBytes }` | 7.3; `import-chunk` |
| `GET /api/imports/:id/lines?page=<n>` | none | `{ lines: ImportLineView[], pages }` | `ready` only; lines 50n to 50n+49 with their marks and picks, read through `openWorkFile` from the page's offset (the intake keeps every 50th line's offset in `scan` while `ready`, at most 1,000) |
| `PUT /api/imports/:id/lines/:ref` | `ImportPickRequest` `{ leftOut, alts }` | `ImportPickView` | `ready` only; writes `import_picks`; `import-pick` |
| `GET /api/imports/:id/media/:file` | none | the image's bytes | `ready` only, images on; the owner's only; through `openWorkFile`, sniffed as JPEG, PNG or WebP (else `not_found`), with that type, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` |
| `POST /api/imports/:id/confirm` | `ConfirmImportRequest` `{ choice, statement: true }` | `ImportView` | `ready` only; `import-act` |
| `POST /api/imports/:id/cancel` | none | `ImportView` | `uploading`, `scanning` or `ready`; asks for the files' deletion |
| `POST /api/imports/:id/stop` | none | `ImportView` | `preparing` or `publishing`; `stop_reason` `by_author` |
| `POST /api/imports/:id/undo` | none | `ImportView` | `done`, or `stopped` with posts; moves to `undoing` |
| `GET /api/profiles/:handle/imported` | `Pagination` query | the timeline page of `PostView`s | the Imported tab; public, as `/posts` is |

`GET /api/imports/:id` and the list are read often by the app's progress screen; they go under the global limit and
read one row each, never the work folder, except the preview's three samples (read once per request from their byte
offsets, at most 256 KiB each, only in `ready`). The lines and media routes go under the global limit; `import-pick`
allows 3,000 picks an hour per account.

### 9.3 Contracts

In packages/contracts/src/imports.ts, exported from the package's index:

- `ImportSource`, `ImportStatus` (the twelve states), `IMPORT_ACTIVE_STATES`, `IMPORT_FAILURES` (`not_this_source`,
  `not_an_archive`, `tar_gz`, `partial_archive`, `encrypted`, `too_many_entries`, `too_large_uncompressed`,
  `bad_entry_name`, `unreadable`, `nothing_to_import`, `scan_timed_out`, `interrupted`), `IMPORT_STOP_REASONS`
  (`refused_image`, `by_author`, `by_staff`, `time_ran_out`), `IMPORT_SKIP_REASONS` (`repost`; `reply`, `too_long`,
  `warning`, `protected` and `left_out` (counted by the app from the month table and the picks when the choice leaves
  them out); `not_public`, `older_version`, `poll`, `adult_label`, `too_long_to_read`, `date_out_of_range`,
  `item_too_large`, `unreadable`, `empty`, `already_imported`, `over_post_cap`, `over_item_cap`, `new_account_cap`),
  `IMPORT_IMAGE_SKIPS` (`video`, `sensitive`, `unsupported`, `too_large`, `missing_file`, `bluesky_no_files`,
  `images_off`, `not_chosen`, `no_description`, `over_image_cap`, `failed`, `not_checked`, `flagged`).
- `ImportedPost` and `ImportedText` (5.1); `ImportSummary` (the importer's `summary.json`), `ImportScanFacts` (what the
  intake stores in `scan`: the counts, `sourceLinks`, `months: { month, groups: [marks, posts, images,
  imagesUndescribed][] }[]` where `marks` is the set of a line's marks (reply, long, warning, protected) as bits,
  `first`, `last`, `fromRef`, `samples: { ref, offset }[]`, `pages: offset[]`), `ImportChoice` (`from` and `to` as
  `YYYY-MM` or null for all, `replies`, `warnings`, `protected` and `images` booleans, `long: "leave" | "shorten"`),
  `ImportLineView` (`ref`, `at` as a day, `kind`, `marks`, `text`, `media: { file, alt }[]`, the pick's `leftOut`
  and `alts`), `ImportPickRequest` (`leftOut`, `alts`: at most four `AltText` or null), `ImportPickView` (the pick and
  the picks' counts by month and marks, so the app's totals stay exact), `CreateImportRequest` (`source`, `bytes`
  from 1 to `IMPORT_MAX_BYTES`), `ConfirmImportRequest` (`choice`, `statement: z.literal(true)`).
- `ImportView`: `id`, `source`, `status`, `createdAt`, `endedAt`, `declaredBytes`, `receivedBytes`, `chunkBytes`,
  `failure`, `stopReason`, `endedByStaff` (the rule's id, when an admin ended it), `scan` (the facts, without
  offsets) and `samples` (three texts, only in `ready`), `choice`, `picks` (their counts), `progress` (`imagesTotal`,
  `imagesSettled`, `postsTotal`, `postsPublished`, `postsRemoved`, `postsLeft`), `paused` (true while the author is
  suspended), `refusalId`, `refusedAt` and `refusedWords` (for `refused_image`), and `undoable`. No text but the
  samples and the refused post's first words, no file name, no source id.
- `IMPORT_RULES`: every number of this design (chunk bytes, the caps, the hours, the batch sizes, the zip limits),
  mirrored by the CHECK constants of 0043 and 0044 and held equal by a database test.
- `ImportErrorCode`: `imports_unavailable`, `import_active`, `rate_limited` (shared), `archive_too_large`,
  `wrong_state`, `wrong_offset`, `chunk_too_large`, `chunk_mismatch`, `not_an_archive`, `statement_required`,
  `nothing_chosen`, `import_too_soon`, `account_suspended` (shared), `not_found` (shared).
- In packages/contracts/src/social.ts: `PostView` gains, last, `imported: { source, at, shortened } | null` (`at` the
  archive's day, `YYYY-MM-DD`: readers never get the second, which with the text would fingerprint the original);
  `ProfileView` gains `hasImported` (a visible imported top-level post exists); the Explore status's reasons gain
  `imported`.
- In packages/contracts/src/staff.ts: `STAFF_STEP_UP_ACTIONS` gains `import_ended_by_staff` (8.7); in
  moderation.ts, `CaseTarget`'s post member gains `imported` (8.7).
- In packages/contracts/src/account.ts: `ExportedPost` gains, last, `imported: { source, originalCreatedAt, shortened }
  | null`, and `ExportFormat` gains a last member, `imports` (section 11.2), each "added to korbat-export-1 without a
  new format name", as earlier members were.
- packages/contracts/src/media.ts does not change: every attached imported image has a description (decision 20),
  `post_media.alt_text` keeps its rule, and every view and the export keep reading it as today.

### 9.4 Errors

| Code | Status | Sentence, or its key in 10.9 (the app's words module holds each) | When |
|---|---|---|---|
| `imports_unavailable` | 503 | `import.unavailable` | `IMPORTS=off`, the site's active cap, the importer's heartbeat, free space, the limit store |
| `import_active` | 409 | `import.active` | a second active import |
| `rate_limited` | 429 | `import.limit` (`import-week`), `import.limit.network` (`import-address-day`) | the two buckets; the shared text for the others |
| `import_too_soon` | 403 | `import.tooSoon` | an account younger than 7 days, or an email not verified |
| `archive_too_large` | 413 | `import.tooLarge` | `bytes` over the cap |
| `wrong_state` | 409 | This import has moved on. Reload to see where it is. | an action the state does not allow |
| `wrong_offset` | 409 | (not shown; the app resumes from `receivedBytes`) | a chunk at the wrong place |
| `chunk_too_large` | 413 | (not shown; the app's own error) | a chunk over 8 MiB or past the declared size |
| `chunk_mismatch` | 400 | (not shown; the app sends the chunk again, at most three times) | a short body or a hash that differs |
| `not_an_archive` | 400 | `import.notArchive` | the first bytes |
| `statement_required` | 400 | Confirm that these are your own posts. | a confirm without the statement |
| `nothing_chosen` | 400 | `import.publish.nothing` | a choice whose month table counts zero |
| `account_suspended` | 403 | the 3e sentence | 3e's predicate |
| `not_found` | 404 | the shared sentence | someone else's import, or none |

### 9.5 Limits

The rate limits are section 7.6's; the bounds of 9.2 and 9.4 hold; `confirm` refuses `from` and `to` outside the
scan's months and an empty choice; every JSON body stays under the 64 KiB limit. The cut of decision 13 runs in
`publishImportedBatch` with `PostText`'s rule.

## 10. The screens

Every screen is built from the UI sub-project's kit (apps/app/src/components/kit/), its tokens and its motion rules,
inside AppShell, with skeleton rows while loading, ErrorState on failure, one level-1 heading, a document title from
lib/page-title.tsx, and every sentence in a new words module, apps/app/src/lib/import-words.ts (keys below). The API
calls and the chunked uploader live in apps/app/src/lib/imports.ts. Nothing is kept on the device: no draft of the
choice, no file handle, no progress.

### 10.1 Where import lives

- Two routes: apps/app/src/app/settings/import/index.tsx (/settings/import: start an import, and the account's
  imports) and apps/app/src/app/settings/import/[id].tsx (/settings/import/<id>: one import, drawn by its state).
- The Settings index (apps/app/src/app/settings/index.tsx) gains a ListRow "Import posts" after Account, with the
  value "Ready to review" while an import is `ready`, and the icon `import`, a new name in the closed list of
  apps/app/src/components/icons.ts mapped to Lucide's `Import` in Icon.tsx and Icon.web.tsx; SettingsNav gains
  "Import" after Account, with `current="import"` on both screens.
- Every state's view starts with a level-2 heading. When the state changes while the screen is open, it announces one
  polite sentence (`import.now.*`) and, when the focused element no longer exists, moves focus to that heading
  (tabIndex -1), so a screen-reader user hears that the preview is ready or the scan failed (WCAG 2.2 4.1.3, 2.4.3).
- New kit parts, each with kit.test.tsx cases, 44 px targets, the focus token and a name for the a11y scan:
  kit/Checkbox.tsx (`role="checkbox"`, `aria-checked`, its label as its name; ReportForm's statement checkbox,
  apps/app/src/components/moderation/ReportForm.tsx:67, moves onto it), kit/ProgressBar.tsx (the four aria values
  and a value text, a static bar under reduced motion), and kit/MonthPicker.tsx (a Button that opens a Sheet holding a
  ListRow radio group of the scan's months; no native select, which React Native lacks on its three platforms).
- The web is the only platform in 3b: on iOS and Android the start screen says the import is on the web for now
  (`import.webOnly`); sub-project 5 brings the file picker and the uploader there.

### 10.2 Start

1. Heading "Import posts", `import.intro`, then the two sentences of decision 28, `import.found` and
   `import.unchecked`.
2. "Where from?": a radio group of ListRows, one per source the site has on (`sources` of `GET /api/imports`;
   Bluesky only when the owner turned it on, decision 16), each with a one-line description.
3. Once a source is chosen: "How to get your archive" as numbered steps for that source; "What korbat reads" and
   "What korbat never reads" as two short lists (from `import.reads.*` and `import.never.<source>`); then
   `import.transit` and `import.trim.<source>` (decision 4).
4. "Choose your archive": a Button that opens the browser's file picker (`accept` `.zip` for X and Mastodon, `.car`
   for Bluesky). The app checks the size (at most 2 GB) and the first bytes (section 4.2, step 2) and names any problem
   at once, under the button, as `role="alert"` text.
5. With a good file: the file's size and the Button "Upload and read" (primary). It creates the import and starts
   the upload; the screen moves to /settings/import/<id>.

Below, "Your imports" lists the account's imports as ListRows (source, state in words, date), each a link to its
screen; empty: no list.

### 10.3 Uploading, and reading the archive

- **Uploading.** A ProgressBar (`role="progressbar"`, `aria-valuemin` 0, `aria-valuemax` 100, `aria-valuenow`, and
  `aria-valuetext` "120 MB of 840 MB"), `import.uploading`, and a secondary Button "Cancel import" (with a Sheet
  asking once). Announced politely at each tenth.
- **Resuming.** When the screen opens on an `uploading` import with no file in hand (after a reload, on another tab),
  it says `import.resume` with the file Button; the app
  checks the chosen file's size against the declared one, then sends from `receivedBytes`.
- **Reading.** In `scanning`: an indeterminate spinner (reduced motion: a static icon), `import.reading` (up to 45
  minutes; the preview waits under Settings for 24 hours after reading), and "Cancel import". The app polls
  `GET /api/imports/:id` every 3 seconds while the page is visible.
- **Failed.** ErrorState with the failure's sentence (`import.failure.*`) and a link "Start again".

### 10.4 Preview and choose

In `ready`, one column of four Sections:

1. **What we found.** `import.found.posts`, `import.found.images` (or `import.found.imagesOff`), the three newest posts
   as PostCard previews in a static variant (no actions, no links, mentions unlinked), each with the label of 10.6, and
   the Button "See every post", which opens the list below.
2. **What will be left out.** One ListRow per non-zero reason (title the count and the reason's words, description
   one line of why), for posts and then for images; `import.cleaned` and `import.sourceLinks` when their counts are not
   zero.
3. **Choose.** A radio group "Everything" / "A range of months", the latter showing two MonthPickers, "From" and "To";
   a Switch "Include replies to other people" (off) with its description; a radio group "Posts over 1,000
   characters": "Leave them out" (default) / "Shorten them to 1,000 characters"; when the archive has them, the
   Switches `import.choose.warnings` (with `import.warnings`) and, for X, `import.choose.protected` (with its
   description), both off; while images are imported, the Switch `import.choose.images` (off) with its description
   and, when on, `import.choose.images.noAlt`. Under the choice, live, `import.choose.result`, computed from the month
   table's groups and the picks, announced politely after the person stops changing the choice for 500 ms.
4. **Confirm.** `import.rules` with the link "Read the rules"; `import.found` and `import.unchecked` again; the
   statement Checkbox (decision 14) with `import.statement.after` under it; the primary Button "Publish 1,240 posts",
   which stays focusable with `aria-disabled` until the statement is ticked and while the choice leaves nothing, its
   reason shown as text under it (ink-medium, tied by `aria-describedby`), and which then moves focus to the Checkbox
   when pressed; and the secondary "Cancel import". Above the Section, `import.keptUntil`, from the scan's time plus
   24 hours.

**The list of posts.** "See every post" shows the lines in the archive's order, 50 a page (`GET .../lines`), each a
static PostCard with a Checkbox "Leave this one out"; a post the current choice leaves out is shown dimmed with its
reason. While images are brought, each image is shown (`GET .../media/:file`) and one without its source's
description has a description Field (at most 1,000 characters): written, the image is imported; empty, it is left out
(decision 20). Each change is saved at once (`PUT .../lines/:ref`), so a reload loses nothing.

### 10.5 Progress, result and undo

- **Preparing and publishing.** A progress bar per phase ("Preparing images: 340 of 1,200", "Publishing posts: 800 of
  1,240"), `import.leave`, and a secondary danger Button "Stop import", which asks once in a Sheet
  (`import.stop.ask`, "Stop import" / "Keep going"). While the author is suspended: a Notice `import.paused` and no
  progress motion.
- **Done.** A success Notice `import.done` with the counts left out during publication (images not checked in time or
  not accepted, posts left empty by a cut), a primary link "See your Imported tab" (to `/u/<handle>?tab=imported`)
  and, below a divider, the danger secondary Button "Remove imported posts".
- **Stopped.** The reason's sentence (`import.stopped.*`); for `refused_image`, the post's date and first words, the
  link "Read the notice" to /settings/cases/uploads/<refusalId> and the link "Import the text only" (a new import of the
  same source with images left out); for `by_staff`, `import.stopped.by_staff`; the published count and, when it is not
  zero and staff did not end it, "Remove imported posts".
- **Remove.** The Sheet asks `import.remove.ask` with "Remove posts" (danger) and "Keep them"; then a ProgressBar
  "Removing posts: 400 of 1,240", and at the end `import.removed`. The haptic `warning` fires on the Sheet, `success`
  at the end.
- **Cancelled, expired, undone.** One sentence each, and the link "Start a new import". While `endedByStaff` is set,
  the undoing and undone screens say `import.endedByStaff` instead, with the link to the case's decision.
- A toast "Import started" after the confirm, with no action, since the person is already on the import's screen
  (the UI design's 5.4: toasts announce, never decide).

### 10.6 The label and the Imported tab

- **PostCard** (apps/app/src/components/social/PostCard.tsx), for a post whose `imported` is set: a line under the
  author line, in the `meta` text variant, ink-medium, with the `import` icon (aria-hidden): "Imported from X, dated 3
  Mar 2019", and ", shortened on import" appended for a shortened post. The line is a pressable (role button, 44 px)
  that opens "Who sees this" at its provenance paragraph, with the accessible name "Imported from X, dated 3 March
  2019. About imported posts". The date is the view's day, in UTC. QuoteEmbed shows the short form "Imported from X".
  The focused post of a thread shows the same line. The body is rendered with RichText's `mentions` false (5.3), and
  RichText marks every link `rel="nofollow ugc noopener"` (decision 21).
- **Who sees this** (apps/app/src/lib/reach.ts and WhoSeesThis.tsx): for an imported post, `import.reach` replaces
  the Latest-and-Following line and the Explore line, and the provenance paragraph `import.provenance` follows, its
  first sentence the fact of decision 28. reach.test.ts gains the imported branches and the check that no sentence
  names an account elsewhere.
- **The profile** (apps/app/src/app/u/[handle]/index.tsx): the Tabs gain "Imported" after Replies when
  `hasImported` is true (for every reader), reading `GET /api/profiles/:handle/imported`; its rows are PostCards in
  the order of the archive's dates, newest first; its empty state (when the last one was removed meanwhile) says "No
  imported posts." The tab's key is `imported`, and `?tab=imported` opens it.
- **Explore status.** The author's own imported post's "Who sees this" never calls `/explore` (the status is known);
  lib/explore.ts gains the reason `imported` for completeness: "Not in Explore: imported posts enter no feed on their
  own."

### 10.7 The console

apps/admin/src/screens/Case.tsx prints, under a post target's link, "Imported from X, dated 3 Mar 2019" and "One of
1,240 posts imported together on 21 Oct 2026." when the target's `imported` is set, with the words in
apps/admin/src/words.ts (`importedLine`, `importedSize`). For an admin it adds the danger Button "End this import",
which asks for the rule and the step-up of `import_ended_by_staff` (8.7) as the console's other step-up actions do,
and says what follows: "Every post of this import is removed, as if the person removed them, and the person is told."
The console's content security policy is unchanged (no new asset). apps/admin/test/cases.test.tsx gains the lines and
the action, refused for a moderator.

### 10.8 The browser check

apps/app/test/browser/app.browser.ts gains, with answers in fixture-api.ts (an import in each state, a scan with every
reason, a page of the list of posts, a profile with `hasImported`, an imported post with and without a shortened mark
and with "@ada" in its text): the start screen, a source chosen, the preview with a range chosen, a post left out in
the list and the statement ticked, the progress, the result and the Remove sheet at 360, 768 and 1280 px in Dark; the
preview, the Remove sheet and the profile's Imported tab in Light, Dim and Dark for contrast; the preview and the
Remove sheet at 320 by 640 px with the Largest text size; the reading screen under reduced motion (the static icon
drawn); keyboard only, every control in order with visible focus, the publish Button reached while `aria-disabled`;
one state change (scanning to ready) with focus on the new heading and its sentence announced; the ProgressBar's
value text; the label's press opening the sheet; no `/u/ada` link; at 360 px no horizontal scroll and no clipped
label. The upload runs against the fixture server, which takes chunks and answers offsets, with a generated file of
20 MB (three chunks), one refused chunk and a resume.

### 10.9 Words

apps/app/src/lib/import-words.ts. `{n}` and the other braces are filled by the screen; numbers go through
`Intl.NumberFormat`, months through lib/time.ts.

| Key | Sentence |
|---|---|
| import.title | Import posts |
| import.nav | Import |
| import.intro | Bring your own posts from another platform. They go on your profile's Imported tab, not into anyone's feed, and nothing is published until you confirm. People can still repost or quote them, as any post. |
| import.found | Anyone who searches the words of an imported post can find the original, and your account there. If korbat is where you stay anonymous, import only what you would post here today. |
| import.unchecked | korbat does not check who wrote an archive: import only your own. |
| import.webOnly | Importing works on korbat's website for now. |
| import.whereFrom | Where from? |
| import.source.x | X (Twitter) |
| import.source.mastodon | Mastodon |
| import.source.bluesky | Bluesky |
| import.source.x.desc | The archive from Settings, Your account, Download an archive of your data. |
| import.source.mastodon.desc | The archive from Preferences, Import and export, Request your archive. |
| import.source.bluesky.desc | The file from Settings, Account, Export my data. Text only: it holds no images. |
| import.how.title | How to get your archive |
| import.how.x | 1. On X, open Settings, Your account, Download an archive of your data. 2. Confirm your password there, on X. 3. X emails you when the archive is ready, which can take a few days. 4. Download the .zip file. |
| import.how.mastodon | 1. On your Mastodon server, open Preferences, Import and export, Data export. 2. Choose Request your archive. 3. When it is ready, download the .zip file. Servers older than version 4.2 give a .tar.gz file, which korbat cannot read. |
| import.how.bluesky | 1. In Bluesky, open Settings, Account, Export my data. 2. Choose Download profile data. 3. Keep the .car file it saves. |
| import.reads.title | What korbat reads |
| import.reads.body | Only the files that hold your posts and their images. Of those, only your own public posts: not reposts, not posts for followers only, not direct messages. |
| import.never.title | What korbat never reads |
| import.never.x | Your messages, contacts, followers, likes, login history, ad data and deleted posts. These files stay unopened. |
| import.never.mastodon | Your direct messages and posts for followers only are in the same file as your public posts. korbat skips them by who they were addressed to, and keeps and logs nothing of them. Your likes, bookmarks, followers and profile files stay unopened. |
| import.never.bluesky | Your likes, follows, lists and profile. The file holds no messages. |
| import.transit | Your whole archive passes through korbat's server and its network provider on the way in. korbat deletes it when it has been read, at the latest within 24 hours. |
| import.trim.x | Before uploading you may delete from the archive everything except, in its data folder, manifest.js, the tweets files (tweets.js, the tweets-part files or tweet.js), note-tweet.js, twitter-circle-tweet.js, protected-history.js and the tweets_media folder. korbat never reads the rest. |
| import.trim.mastodon | Before uploading you may delete from the archive everything except outbox.json, actor.json and the media_attachments folder. korbat never reads the rest. |
| import.trim.bluesky | The .car file holds only your repository; there is nothing to delete. |
| import.choose | Choose your archive |
| import.chosen | {name}, {size} |
| import.start | Upload and read |
| import.tooLarge | Archives can be at most 2 GB. |
| import.notArchive | This file is not a {source} archive. |
| import.tarGz | This is a .tar.gz archive from a Mastodon server older than version 4.2. korbat can only read the .zip archives of newer servers. |
| import.yours | Your imports |
| import.uploading | Keep this page open while your archive uploads. It must finish within 24 hours of starting. |
| import.uploaded | {done} of {total} |
| import.resume | Your upload stopped at {done} of {total}. Choose the same file to go on. |
| import.wrongFile | This file is not the same size as the one you started with. |
| import.reading | Reading your archive. This can take up to 45 minutes. You can leave this page: your preview waits under Settings, Import posts, for 24 hours after reading. |
| import.settings.ready | Ready to review |
| import.now.ready | Your archive was read. Choose what to publish. |
| import.now.failed | Your archive could not be read. |
| import.now.done | Your posts were published. |
| import.cancel | Cancel import |
| import.cancel.ask | Cancel this import? korbat deletes the archive and everything read from it. |
| import.cancel.keep | Keep it |
| import.found.posts | {n} posts from {first} to {last} |
| import.found.images | {n} images, {kept} of them can be imported |
| import.found.imagesOff | Images are not imported on this site yet. Your posts come without them. |
| import.samples | Your newest posts, as they will look |
| import.seeAll | See every post |
| import.list.leaveOut | Leave this one out |
| import.list.describe | Describe this image (it is left out without a description) |
| import.list.dimmed | Left out by your choice: {reason} |
| import.left.title | What will be left out |
| import.skip.repost | Reposts of other people's posts |
| import.skip.reply | Replies to other people (you can include them below) |
| import.skip.not_public | Posts that were not public |
| import.skip.older_version | Earlier versions of posts you edited |
| import.skip.poll | Polls, which korbat does not have |
| import.skip.adult_label | Posts you labelled as adult content, which korbat's rules do not allow |
| import.skip.too_long_to_read | Posts too long to read |
| import.skip.too_long | Posts over 1,000 characters (you can shorten them below) |
| import.skip.date_out_of_range | Posts with a date that cannot be right |
| import.skip.item_too_large | Entries too large to read |
| import.skip.unreadable | Entries korbat could not read |
| import.skip.empty | Posts with nothing korbat can show |
| import.skip.already_imported | Posts you already imported |
| import.skip.over_post_cap | Older posts beyond the limit of 50,000 |
| import.skip.over_item_cap | The archive was read in part: it holds more than korbat reads in one import |
| import.skip.new_account_cap | Older posts beyond 1,000, the limit until your account is 30 days old |
| import.skip.warning | Posts with a content warning (you can include them below) |
| import.skip.protected | Posts from when your account was protected (you can include them below) |
| import.skip.left_out | Posts you chose to leave out |
| import.image.video | Videos and animated images, which korbat does not have |
| import.image.sensitive | Images of posts you marked as sensitive |
| import.image.unsupported | Images in a format korbat does not take |
| import.image.too_large | Images over 20 MB |
| import.image.missing_file | Images missing from the archive |
| import.image.bluesky_no_files | Images, which Bluesky's export does not contain |
| import.image.images_off | Images, which this site does not import yet |
| import.image.over_image_cap | Images beyond the limit of 5,000 |
| import.image.failed | Images korbat could not process |
| import.image.not_checked | Images that could not be checked in time |
| import.image.not_chosen | Images, which you chose not to bring |
| import.image.no_description | Images without a description |
| import.image.flagged | Images korbat could not accept |
| import.cleaned | Characters korbat cannot show were removed from {n} posts. |
| import.sourceLinks | Links to posts and profiles on {source} were replaced by words, because they show account names there. |
| import.warnings | {n} posts have a content warning. korbat cannot hide them behind it. |
| import.choose.title | Choose |
| import.choose.all | Everything |
| import.choose.range | A range of months |
| import.choose.from | From |
| import.choose.to | To |
| import.choose.replies | Include replies to other people |
| import.choose.replies.desc | They are published as posts of their own, without what they answered. |
| import.choose.long | Posts over 1,000 characters |
| import.choose.long.leave | Leave them out |
| import.choose.long.shorten | Shorten them to 1,000 characters |
| import.choose.warnings | Include posts with a content warning |
| import.choose.protected | Include posts from when your account was protected |
| import.choose.protected.desc | If your account on X was protected, its posts were not public then. Do not import them unless you mean to make them public. |
| import.choose.images | Bring images |
| import.choose.images.desc | Photos can be found by image search and can show other people. |
| import.choose.images.noAlt | {n} images have no description. Write one for each in the list of posts, or it is left out. |
| import.choose.result | This publishes {posts} posts and {images} images to your Imported tab. |
| import.rules | Imported posts follow korbat's rules like any post. One that breaks them can be removed and count against your account. |
| import.rules.link | Read the rules |
| import.statement | These are my own posts, and they were public where I posted them. |
| import.statement.after | If they are not, korbat can remove them, and it can count against your account. |
| import.publish | Publish {n} posts |
| import.publish.needStatement | Tick the statement to go on. |
| import.publish.nothing | Your choice leaves no posts to publish. |
| import.keptUntil | This preview is kept until {time}. Then the import is cancelled. |
| import.started | Import started |
| import.preparing | Preparing images: {done} of {total} |
| import.publishing | Publishing posts: {done} of {total} |
| import.leave | You can leave this page. The import goes on, and your posts appear on your Imported tab when they are ready. |
| import.paused | Your import is paused while your account is suspended. |
| import.stop | Stop import |
| import.stop.ask | Stop this import? Posts already published stay; you can remove them afterwards. |
| import.stop.keep | Keep going |
| import.done | {n} posts were published on your Imported tab. |
| import.done.view | See your Imported tab |
| import.stopped.refused_image | This import stopped because korbat refused one image, in your post dated {date} that begins "{words}". Nothing from it was published. |
| import.stopped.notice | Read the notice |
| import.stopped.textOnly | Import the text only |
| import.stopped.by_staff | korbat's staff ended this import under {rule}. {n} posts were published before it stopped and are being removed. |
| import.endedByStaff | korbat's staff removed the posts of this import under {rule}. You can appeal the decision on its case. |
| import.stopped.by_author | You stopped this import. {n} posts were published before it stopped. |
| import.stopped.time_ran_out | This import ran out of time. {n} posts were published before it stopped. |
| import.remove | Remove imported posts |
| import.remove.ask | Remove all {n} posts from this import? This deletes them for everyone. It cannot be undone. |
| import.remove.confirm | Remove posts |
| import.remove.keep | Keep them |
| import.removing | Removing posts: {done} of {total} |
| import.removed | The posts from this import were removed. |
| import.cancelled | You cancelled this import. Its archive was deleted. |
| import.expired | This import was not finished within 24 hours, so korbat deleted it. |
| import.again | Start a new import |
| import.failure.not_this_source | This file is not a {source} archive. |
| import.failure.not_an_archive | This file is not an archive korbat can read. |
| import.failure.tar_gz | This is a .tar.gz archive from a Mastodon server older than version 4.2. korbat can only read .zip archives. |
| import.failure.partial_archive | This is one part of an X archive split into several, which korbat cannot read yet. Your posts are safe in your archive; try again after korbat's next update. |
| import.failure.encrypted | This archive is protected by a password, which korbat cannot read. |
| import.failure.too_many_entries | This archive holds more files than korbat reads. |
| import.failure.too_large_uncompressed | This archive unpacks to more than korbat reads. |
| import.failure.bad_entry_name | This archive has file names korbat does not accept. |
| import.failure.unreadable | Part of this archive could not be read. It may be damaged; download it again. |
| import.failure.nothing_to_import | korbat found no public posts of your own in this archive. |
| import.failure.scan_timed_out | Reading this archive took too long. |
| import.failure.interrupted | Reading this archive failed twice. |
| import.active | You already have an import in progress. |
| import.unavailable | Imports are paused for now. Try again later. |
| import.limit | You have published three imports this week. Try again later. |
| import.limit.network | Many imports were started from your network today. Try again tomorrow. |
| import.tooSoon | You can import posts once your account is 7 days old. |
| import.label | Imported from {source}, dated {date} |
| import.label.shortened | , shortened on import |
| import.label.short | Imported from {source} |
| import.label.a11y | Imported from {source}, dated {date}. About imported posts |
| import.reach | Imported posts are not in Latest, Following or Explore. They show on their author's profile, under Imported, and wherever someone reposts or quotes them. |
| import.provenance | Anyone who searches the words of an imported post may find the original and the account that wrote it. This account imported it from {source} on {imported}. The archive dates it {date} (UTC). korbat did not check who wrote it or when. |
| import.tab | Imported |
| import.tab.empty | No imported posts. |
| import.explore | Not in Explore: imported posts enter no feed on their own. |
| title.import | Import - Settings - korbat |

## 11. Privacy and transparency

### 11.1 What is stored, and for how long

| Data | Where | How long |
|---|---|---|
| The archive, unopened beyond its allowlisted files | `import-archives`, in no backup | until its scan ends; never beyond 24 hours after the import was created |
| The person's own public posts, converted, and their images | `import-work`, in no backup | until the import ends; never beyond 72 hours after the scan |
| The import's record: source, state, times, choice, statement time, counts | `import_jobs` | while any post of it exists, and at least 30 days after its end; deleted with the account |
| On each imported post: source, the archive's date, shortened or not, the key | `posts` | while the post exists; cleared when it is deleted |
| The account's random import key | `import_keys` | until the account is purged |
| The person's picks: posts left out, descriptions written | `import_picks` | until the import ends |
| Imported images | `media-store`, as any image, in the backup | while their post exists |

Never stored, logged or shown: the other platform's handle, display name, account id, instance, DID, post ids, links to
the originals, the archive's file name, any file outside the allowlist, any post that is not the person's own and
public. The importer's and the API's logs carry ids, codes, counts and timings only (7.1).

The key on each post is not nothing: source post ids of public accounts are public, so whoever holds the database
or a backup of it, with the account's key beside it, can test whether this korbat account imported a named account's
public posts. No key of the server's alone does this (the keys are per account, 5.4), and the purge erases the key
with the account; the README says so.

### 11.2 The data export

apps/api/src/account/flows/export.ts: each post of the `posts` member gains, last, `imported: { source,
originalCreatedAt, shortened }` or null; the document gains a last member, `imports`, the account's imports newest
first, each `{ id, source, status, createdAt, endedAt, statedAt, choice, counts: { postsPublished, postsRemoved,
imagesKept, imagesLeftOut } }`. Both are "added to korbat-export-1 without a new format name". The archive itself and
the work folder are never exported: they are deleted long before an export could be asked for, and they hold the
other platform's data, not korbat's.

### 11.3 The terms and the privacy text

apps/app/src/lib/terms.ts gains a section "Importing posts", joining the draft without a new `TERMS_VERSION`, as
earlier sub-projects' sentences joined it: what an import reads and never reads; that the whole archive passes
through korbat's server and its network provider, and korbat deletes it within 24 hours of the start and its other
files within three days; that imported posts are korbat posts, under the rules, on the profile's Imported tab and in
no feed on their own; that anyone who searches their words may find the originals; that korbat keeps on each post
only the source, the day the archive gives and a keyed hash, never the other account; that the person states the
posts are their own and were public; that the person grants korbat for imported posts and images the same licence
as for native ones, and must be able to grant it (old posts often hold other people's photos and screenshots); that
a false statement can lead to removal under R6 and count against the account; that other people named or pictured
in imported posts can ask for removal like anyone named in a post; that images go through the same checks as
uploads; and that one action removes them. The terms hold no licence sentence for native posts at 6babae1, so "What
you can post" gains one for every post and image, native or imported (korbat may store, show and send what you post
as the service needs, until you delete it, except what the rules' records keep), and "Importing posts" points to it.
"Your data" gains the import's record and its retention. terms.test.tsx holds these sentences to the numbers in
`IMPORT_RULES`, and holds that both sections name that one licence. The privacy policy and the impact assessment are
sub-project 4's, with the counsel list of decision 28 there.

### 11.4 Transparency

`/transparency` gains no figure (decision 29). A refused imported upload is one more refused upload in 3d's table of
uploads refused; a decision about an imported post is one more decision by ground and kind of measure; an R1
finding on an imported image is counted where 3d counts findings (an imported image with an R2 match is never
published, 8.1). The rules page's section "Automation" gains one
sentence: "Imported images pass the same checks as uploaded ones, and korbat imports images only while it can check
them."

## 12. Testing

No test opens a real archive. Every archive is built by code from fixtures that name no real person, and every
fixture plants canary strings (`CANARY-DM`, `CANARY-IP`, `CANARY-LIKE`, `CANARY-PRIVATE`, `CANARY-DELETED`) in the
places korbat must never read, and the person's own names elsewhere (`CANARY-HANDLE` as X's `userName`, the Mastodon
actor's path and a Bluesky handle; `CANARY-NAME` as `displayName`; a fixture DID) in the manifest, `attributedTo`,
the commit and self-quote and self-link URLs inside post texts, so a test can prove none reached an output, a row or
a log line (after 5.3 step 3b's replacement).

### 12.1 Fixtures built by code

- apps/importer/test/fixtures/zip.ts: a small zip writer for tests (stored and deflate through `node:zlib`, ZIP64 on
  demand) with switches for every crafted case: overlapping data ranges, a ratio over 100, a size that lies, a bad
  CRC, the encryption bit, method 12, a symlink entry, names with `..`, a leading slash, a drive letter, a backslash, a
  NUL, 513 bytes, and two central entries with one name; and `dataDescriptor` (flag bit 3, zero local sizes, the
  descriptor after the data) and `zip64Local` (0xFFFFFFFF local sizes with a ZIP64 extra) for good archives.
- x.ts: `manifest.js`, `tweets.js` in the current and the 2019 element shape, `tweet.js` (2018), `tweets-part1.js`,
  `note-tweet.js`, `twitter-circle-tweet.js`, `protected-history.js` with one protected period, media files, and the
  canaries in `direct-messages.js`, `ip-audit.js`, `like.js` and `deleted-tweets.js`; posts covering every row of
  5.5's table, a self-quote, a link to the person's own profile and a tweet inside the protected period.
- mastodon.ts: `outbox.json` with public, unlisted, private, direct and limited Notes, an Announce embedding a Note, a
  Question, a quote with its `quote-inline` paragraph, a content warning, `sensitive` media, a thread, a reply to
  another server beginning with two mention links, a link to one of the person's own statuses, and media paths with
  and without a leading slash; the canaries in the private and direct Notes, in `likes.json` and in `actor.json`.
- bluesky.ts: a CAR written with `@ipld/car`'s writer and `@ipld/dag-cbor`, a commit, a two-level MST, posts covering
  5.7's table and a post linking `bsky.app/profile/<the fixture's handle>`, `app.bsky.feed.like` and
  `app.bsky.graph.follow` records holding canaries, blocks in a shuffled order, an extra block outside the tree, and
  switches for a block whose bytes do not match its CID and for 1,000,001-byte blocks.
- packages/import-protocol/src/fixtures.ts: `writeScanOutput(dir, posts, summary, images)`, which the API's tests
  use to stand in for the importer, as packages/media-protocol/src/fixtures.ts stands in for the worker.

### 12.2 Unit tests

- packages/contracts/test/imports.test.ts: `ImportedPost` (refs, kinds and parents, text limits, media names),
  `ImportChoice`, `IMPORT_RULES` against the values this design states.
- packages/import-protocol/test/: layout ids refuse anything but a lowercase UUID; the summary and line readers' caps;
  `openWorkFile` refuses a symlink, a symlinked folder, a file on another device and anything but a regular file.
- apps/importer/test/: `zip.test.ts` (every limit of 7.2 refuses with its code; a good ZIP64 archive, a good archive
  with data descriptors and one with ZIP64 local sizes read);
  `text.test.ts` (5.3, each step, with right-to-left text and direction marks, step 3b's fixed words for each source,
  a Mastodon reply's leading mentions removed, a description over 1,000 characters becoming null); `x.test.ts`,
  `mastodon.test.ts`, `bluesky.test.ts` (every row of 5.5 to 5.7, detect for each failure, a tweet inside a protected
  period marked `protected`, a content warning marked `warning`, the media patterns refusing deeper and `..` paths);
  `json.test.ts` (the assembler's 1 MiB and depth caps); `core.test.ts` (keys stable per account and
  different between accounts, refs in date order, a thread whose parent is left out or later becomes a post, the
  newest 50,000 kept, dates out of range); `loop.test.ts` (attempts, the third start fails `interrupted`, a deletion
  request aborts a scan, the summary written last); `log.test.ts` (the source scan of 7.1; no log line per skipped
  item); `minimisation.test.ts` (no canary, handle, name or DID in `posts.jsonl`, `summary.json`, the media folder,
  the scratch file or the captured log, for each source).
- apps/api/test/: `imports-chunk.test.ts` (offsets, lengths, the hash, truncation back to whole chunks, the first-bytes
  check, a row behind its file), `imports-intake.test.ts` (line caps, a 75 KB CJK note kept, refs in order, unreadable
  lines, the month table, samples, a symlinked `posts.jsonl` refused), `config.test.ts` (`IMPORT_IMAGES=on` with
  `MEDIA_MATCH=off` refuses to start; `IMPORT_SOURCES` defaults to `x,mastodon` and refuses an unknown source),
  `architecture.test.ts`, re-pinned in two tasks: Task 4 (`imports` among `MODULES`; the standing pins gain
  imports/repo.ts, 8.5) and Task 5 (the `REQUEST_DELETION` counts of the media files that ask for imported images'
  files, 6.5), tiers.

### 12.3 Integration tests (apps/api/test/integration/)

- `import-schema.test.ts`: every trigger of 6.1 to 6.3 for the API role (forced columns, each allowed and refused
  move of 4.1, one active import, deletes, the five post columns set only at insert by a publishing job of the author
  and cleared only by a tombstone, a reply only within the job, no quote, an imported image only on its import's post
  and never without a description, picks written only while `ready`, an import key deleted only with its profile);
  the grants; RLS on; each CHECK's literal equal to `IMPORT_RULES`; 0044's `decision_actions_check` passes over
  imported posts in its flood count and is otherwise 0032's.
- `http-imports.test.ts`: create (each refusal of 4.2 step 3, in order: a source switched off, an account 6 days old
  `import_too_soon`, three published imports in 7 days while failed and cancelled ones cost nothing; two concurrent
  creates by two accounts against `IMPORT_MAX_ACTIVE` 1, one refused), chunks over HTTP through the app (sizes, a
  resume after a refused chunk, the 64 KiB limit untouched elsewhere), cancel, the list, someone else's import, each
  `ImportError` answered with its status (never 500).
- `imports-scan.test.ts`: `import-drive` with `writeScanOutput` standing in for the importer: archive deleted on the
  summary, intake, `ready`, `failed`, the 45-minute and 24-hour bounds, expiry of a preview, orphans.
- `imports-publish.test.ts`: confirm; batches of 200 with derived ids; a repeated round writes nothing twice; thread
  order in `replies`; counters; a batch beside a report holding one of its parents ends without a deadlock; a choice's
  range, replies, long posts (the cut at a space, the mark), warnings and protected posts; left-out picks skipped; an
  account younger than 30 days publishing at most 1,000; keys already imported skipped; a suspension mid-import makes
  the batch wait and the import go on after it; the 72-hour stop; imported posts absent from Following, Latest,
  Explore's candidates, the Posts tab and the Replies tab, present in the Imported tab in the archive's date order with
  `imported.at` a day, and answered as missing when disabled; an import of 1,000 posts leaves 3e's `atOnce.flood`
  false.
- `imports-picks.test.ts`: the lines' pages and their offsets, a pick saved and read back, `alts` checked as
  `AltText`, the media route only for the owner, only in `ready`, only a sniffed image, through `openWorkFile`.
- `staff-import-end.test.ts`: `import_ended_by_staff` by an admin with step-up (a moderator refused), its audit row,
  the move to `undoing` from `publishing` and from `done`, the posts removed through the undo path, the person's mail,
  and `CaseTarget.imported` with the import's size.
- `imports-media.test.ts`: the feeder feeds only while no other upload waits, at most two in flight, at the site's
  pace; the sweeper and `pendingCount` leave imported rows alone; with the `test` matcher a clear image is attached,
  an unchecked one is left out after 24 hours, a non-acting match is left out (`flagged`), never attached, and an
  admin alerted, and an acting match stops the import before any post with 3d's notice and hold, the row's date and
  first words of its post, the other rows and the work folder deleted; a symlinked image file and a symlinked
  `media/` folder, each pointing at a file of the store, are refused (`missing_file`) and nothing of the store is
  copied.
- `imports-undo.test.ts`: the undo tombstones every post in batches, clears the columns, fixes every counter, keeps
  the images of a frozen post and of a case, leaves a disabled post as it is with its columns and still ends `undone`
  (also with 200 or more disabled posts in one import); a single imported post deleted from its menu clears its
  columns.
- `account-deletion.test.ts` and `account-export.test.ts` gain the purge's import steps (rows and the import key
  gone, columns cleared, a disabled post's too, files asked for, a waiting batch writing nothing) and the export's two
  additions.

### 12.4 The browser check

Section 10.8's steps in apps/app/test/browser/app.browser.ts; the console's case lines and action in its unit test.

### 12.5 Labs

apps/importer/test/lab/, run in the importer Dockerfile's build stage (the runtime stage holds only `dist/`):
`docker build --target build`, then
`docker run --network none --memory 512m --memory-swap 512m --cpus 0.5 --read-only --tmpfs /tmp:size=16m` with
`pnpm --filter @korbat/importer test:lab`; not in every gate. apps/importer/test/lab/README.md (as
apps/api/test/lab/README.md) gives the command and where each lab writes its measurements:

- `zip-bomb.lab.ts`: the overlapping-files bomb (a 10 MB file declaring terabytes), a ratio bomb within one entry, a
  central directory of 1,000,000 entries, ZIP64 records that lie about sizes and offsets; each is refused within 5
  seconds and under 64 MB of memory.
- `json-bomb.lab.ts`: one 900 MB string, a depth of 1,000,000 brackets and a key of 500 MB in a data file; each is
  refused `item_too_large` within 5 seconds and under 64 MB of memory.
- `traversal.lab.ts`: every crafted name of 12.1 and a symlink to `/etc/passwd`; each is refused or ignored, and
  nothing is written outside `jobs/<id>/`.
- `large-archive.lab.ts`: a generated X archive of 1.9 GiB (60,000 tweets, a `tweets.js` of 400 MB, 5,000 images), a
  Mastodon outbox of 50,000 Notes and a CAR of 2,000,000 blocks: each scans within the 30-minute watchdog, the peak
  memory stays under 400 MB, and the API's intake of 50,000 lines runs within its 512m.

### 12.6 Gates

- Every task: typecheck and unit tests of each package it changes (`pnpm --filter <package> typecheck` and `test`).
- Batch ends: the runner's whole integration suite, as every sub-project's batches; from Task 7 on, also
  `pnpm --filter @korbat/app test:browser`.
- Stack tasks: the stack rebuilt and scripts/smoke-auth-stack.mjs run, which gains an import of a generated Mastodon
  archive through the real importer (Task 4: to `ready`; Task 8: confirmed, read on the Imported tab, removed).

## 13. Tasks

Eight tasks in build order, in five batches: Tasks 1 and 2, 3 and 4, 5 and 6, Task 7 alone (with the app's browser
check), and Task 8 alone. Each runs the gates of 12.6.

**Task 1. Contracts and the file protocol.** Goal: the shapes every later task builds on. Creates
packages/contracts/src/imports.ts (5.1, 9.3, `IMPORT_RULES`), packages/import-protocol/ (package.json,
tsconfig.json, src/index.ts, layout.ts, limits.ts, summary.ts, lines.ts, open.ts, fixtures.ts). Changes
packages/contracts/src/index.ts, pnpm-lock.yaml. Tests: packages/contracts/test/imports.test.ts,
packages/import-protocol/test/layout.test.ts, readers.test.ts and open.test.ts (`openWorkFile` against a planted
symlink, a symlinked folder and a file on another device). Not a batch end; no stack rebuild.

**Task 2. The database.** Goal: section 6. Creates packages/db/migrations/0043_imports.sql,
0044_imported_posts.sql, 0045_import_readers.sql with their meta snapshots, packages/db/src/schema/imports.ts
(`import_jobs`, `import_picks`, `import_keys`). Changes packages/db/src/schema/content.ts (the seven columns, the
CHECKs, the indexes) and schema/index.ts. Tests: packages/db/test/schema.test.ts (its table count, 69 at 6babae1,
becomes 72; `post_media_import_link` joins post_media's checks; posts' new check and indexes),
enum-literals.test.ts (one case: 0043 to 0045 add no value to an existing enum; their two enums are created whole),
apps/api/test/integration/import-schema.test.ts (with 0044's `decision_actions_check`). Batch end (Tasks 1 and 2); no
stack rebuild.

**Task 3. The importer.** Goal: sections 5, 7.1 and 7.2. Creates apps/importer/ (package.json with the exact pins of
7.1 as resolved on the day, tsconfig.json, build.mjs, vitest.config.ts, Dockerfile, src/index.ts, config.ts, loop.ts,
scan.ts, core.ts, text.ts, html.ts, json.ts, zip/central.ts, zip/entry.ts, zip/limits.ts, car/reader.ts, car/mst.ts,
adapters/types.ts, adapters/x/index.ts, adapters/mastodon/index.ts, adapters/bluesky/index.ts), its fixtures and unit
tests (12.1, 12.2), its labs and test/lab/README.md (12.5). Changes pnpm-lock.yaml. Checks:
scripts/check-lockfile-age.mjs; the labs run once in the build stage and their measurements are recorded. Not a
batch end; no stack rebuild.

**Task 4. Upload, scan, the preview and the service.** Goal: 4.2, 4.3, 4.4's routes, 7.3, 7.5 steps 1 to 3, 7 and 8,
7.6, 7.7, 8.5's create. Creates apps/api/src/imports/ (index.ts, context.ts, routes.ts, repo.ts, files.ts,
intake.ts, drive.ts, flows/create.ts, flows/chunk.ts, flows/picks.ts, flows/end.ts with the cancel). Changes
apps/api/src/app.ts (the routes, the body limit's exemption, `AppDeps.imports`, the `ImportError` branch of
`onError`), apps/api/src/config.ts, apps/api/src/index.ts (the module and its job), apps/api/src/social/tiers.ts
(the import buckets), apps/api/Dockerfile (the two mount points owned by `node`), apps/api/test/architecture.test.ts
(`MODULES` and the standing pins), apps/api/test/integration/standing-route-walk.test.ts (the imports module in the
walk's app: create refused; chunk, picks and cancel allowed), infra/compose.yml (`importer`, the two volumes, the
API's mounts and settings), infra/caddy/Caddyfile (`@import_chunk`), infra/.env.example,
scripts/smoke-auth-stack.mjs (an import to `ready`). Tests: imports-chunk.test.ts, imports-intake.test.ts,
config.test.ts, http-imports.test.ts, imports-scan.test.ts, imports-picks.test.ts. Batch end (Tasks 3 and 4); stack
task: the stack rebuilt with the importer, `docker compose ps` shows it healthy with no network, and the smoke test
runs.

**Task 5. Imported images.** Goal: 4.5 steps 1 and 2, 6.5's media writers, 7.4, 7.5 step 4, 8.1 and 8.2. Creates
apps/api/src/imports/feeder.ts, flows/confirm.ts. Changes apps/api/src/imports/drive.ts (feeding; the leftovers each
round), routes.ts and flows/end.ts (the stop); apps/api/src/media/repo.ts (`insertProcessing` with `importJobId`,
`deleteImportLeftovers`, `pendingCount`, `failStale`, `deleteUnattachedBefore`), media/files.ts (receiving from a
work file through `openWorkFile`), media/index.ts, media/sweeper.ts; apps/api/test/architecture.test.ts (the
`REQUEST_DELETION` counts); standing-route-walk.test.ts (confirm refused, stop allowed). Tests:
imports-media.test.ts. Not a batch end; no stack rebuild.

**Task 6. Publishing, readers, undo and the account.** Goal: 4.5 steps 3 and 4, 4.6, 4.7, 6.5's social writers, 7.5
steps 5 and 6, 8.3 to 8.7 and the API half of 9.3. Changes apps/api/src/imports/drive.ts, routes.ts, index.ts
(`purgeOwner`, `endByStaff`) and flows/end.ts (the undo); apps/api/src/social/repo.ts (`publishImportedBatch`,
`removeImportedBatch`, the readers' filters, `profileImported`, `exploreRules`' marker, `deletePost` and
`purgeProfile` clearing the columns), social/routes.ts (`/profiles/:handle/imported`), social/views.ts (the day),
social/index.ts; apps/api/src/moderation/standing-repo.ts (the flood count); apps/api/src/account/flows/deletion.ts
and export.ts; apps/api/src/staff/routes.ts and the case view's target (`import_ended_by_staff`,
`CaseTarget.imported`), the auth module's mail template `import_ended_by_staff`; packages/contracts/src/social.ts,
account.ts, moderation.ts and staff.ts (9.3), with the app's and the console's test fixtures that build a `PostView`
or a `CaseTarget`; standing-route-walk.test.ts (undo allowed). Tests: imports-publish.test.ts, imports-undo.test.ts,
staff-import-end.test.ts, the account tests' additions, http-social's Imported tab and the 3f readers' walk,
explore's candidates. Batch end (Tasks 5 and 6); no stack rebuild.

**Task 7. The screens and the console.** Goal: section 10 and 11.3. Creates apps/app/src/app/settings/import/
index.tsx and [id].tsx, apps/app/src/lib/imports.ts (the API and the chunked uploader with `crypto.subtle.digest`),
apps/app/src/lib/import-words.ts (every key of 10.9), apps/app/src/components/import/ (SourcePicker.tsx,
UploadProgress.tsx, Preview.tsx, PostList.tsx, ImportProgress.tsx, ImportResult.tsx), and kit/Checkbox.tsx,
kit/ProgressBar.tsx, kit/MonthPicker.tsx. Changes components/icons.ts, Icon.tsx and Icon.web.tsx (`import`),
components/moderation/ReportForm.tsx (onto Checkbox), components/social/RichText.tsx (`mentions`, `rel`),
components/social/PostCard.tsx (the pressable label, `mentions`), app/post/[id].tsx, lib/reach.ts and
components/social/WhoSeesThis.tsx, app/u/[handle]/index.tsx (the tab), lib/social.ts, lib/explore.ts,
app/settings/index.tsx, components/SettingsNav.tsx, lib/terms.ts (the section and the licence), the words of /rules'
"Automation" section, apps/admin/src/screens/Case.tsx and src/words.ts (the two lines and "End this import"),
test/browser/app.browser.ts and fixture-api.ts. Tests: import-screens.test.tsx (each state's screen, its words, its
controls' names, the heading and the announcement on a change), imports-uploader.test.ts (chunks, hashes, resume,
retries with a fake fetch), kit.test.tsx (Checkbox, ProgressBar, MonthPicker), rich-text.test.tsx ("@ada" in an
imported post is no link while an account @ada exists; every link's `rel`), reach.test.ts's imported branches,
post-card.test.tsx's label, terms.test.tsx, lifecycle.test.tsx (SettingsNav's pages gain `import`),
apps/admin/test/cases.test.tsx. Batch end (Task 7 alone), with the app's browser check; no stack rebuild.

**Task 8. Documentation and the stack.** Goal: the record. The design (parts 1 to 5 joined as
docs/superpowers/specs/2026-10-21-import-3b-design.md) is committed before Task 1, as every sub-project's is; this task
fills its section 15 from the dry run. README.md gains "Importing posts" (what it reads and never reads, the two
volumes and why they are in no backup, the settings of 7.7, `IMPORT_IMAGES`' precondition, `IMPORT_SOURCES` and what
turning Bluesky on accepts, what the per-account import key still lets whoever holds the database do (11.1), the labs
and how to run them, migration 0045 as the slow one in Upgrading), the Backups section names `import-archives` and
`import-work` as excluded, and Before going public names every point of section 2 for counsel (decision 28's list:
decisions 4, 14, 15, 16, 18, 25 and 28 and the licence of 11.3); the main design's section 6a is marked delivered and
section 9 gains the dated amendment "sub-project 3b" (delivered; line 246's mark not built; line 255's `original_url`
not stored; line 237's parse in a service of its own; line 244 as 3d amended it, with the stop of decision 18; line 249
as a profile tab; the decisions of section 2; status and order: next 2d engagement, 4 hardening, 5 native builds).
scripts/smoke-auth-stack.mjs runs the whole import: confirm, the post on the Imported tab, undo. Batch end (the whole
integration suite); stack task: the stack rebuilt from clean and the smoke test run.

## 14. What is left for later

- **More sources.** Threads, Instagram, Facebook and Reddit as adapters: a folder, an enum value (a migration adding
  the value to `import_source`), fixtures and words; nothing else changes.
- **Bluesky images.** An optional second archive of blobs (`goat blob export`, zipped), each file accepted only when
  its SHA-256 equals the digest of a CID a kept post names (decision 16).
- **Archives refused today.** Mastodon `.tar.gz` (`tar-stream` 3.2.2 or a later version past the floor) and X archives
  in parts: first, from the open-source parsers inputs 3.1 cites, which part holds `data/manifest.js` and the tweets;
  if one part does, accept that part text only, counting the other parts' images `missing_file` (decision 26).
- **The archive in the browser.** When the web bundle has room: build, in the browser, a zip of the allowlisted
  entries only (copying local headers and compressed bytes, no inflating) and upload that, so X's messages, contacts
  and IP logs never leave the device (decision 4); and read the zip's central directory there to tell an X archive
  from a Mastodon one before uploading. The server keeps every check of 7.2.
- **Editing descriptions.** An "Add a description" for any image after posting, native or imported, which needs a
  route, a column grant and a guard (decision 20).
- **Self-quotes.** A quote of the person's own imported post as a korbat quote.
- **Native apps.** The file picker and a background upload of the same protocol in sub-project 5.
- **Capacity.** A second worker for imported images, or the worker's own import lane, if the host's measurements ask
  for it (decision 17).
- **2d.** Imported posts' @mentions never notify and are never stored as mentions; 2d's mention parser skips posts
  whose `import_job_id` is set, and its share cards show the provenance label.
- **Sub-project 4.** The privacy policy's section on imports and the impact assessment (decision 28); per-address
  limits tuned with Cloudflare's rules; the restore drill confirming that the two import volumes are absent from
  backups by design.

## 15. Amendments from the dry run
