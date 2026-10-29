# korbat engagement (sub-project 2d): design

Status: approved for the dry run under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner, and those marked (counsel) need a lawyer's confirmation before korbat is opened to the public. Inputs: the main design's row 2d and its amendment of 2026-09-30, the later designs that touch it (2a, 2b, 1b, 3c to 3f, the UI sub-project and 3b), the code at the time of writing, and the official documentation of link previews. One review round (build fit and security; people and values) shaped this text.

Inputs, as cited: korbat-scratch/research-2d/inputs.md ("inputs N"), the main design
docs/superpowers/specs/2026-09-03-korbat-design.md ("main design"), and the designs in the same folder, named by their
sub-project ("the 3c design", "the UI design"). Paths are relative to the repository root
C:/Users/Lenovo/Desktop/cool/korbat unless they start with korbat-scratch. Written against main at 0bc2dcc and
checked against 3b's replay (main at ebc8778): every name 3b adds (`posts.import_job_id`, `PostView.imported`, its
migrations 0043 to 0048) is used as 3b's code has it.
Committed before Task 1 as docs/superpowers/specs/2026-10-22-engagement-2d-design.md (section 13).

## 1. Context and scope

### 1.1 What the owner asked

On 2026-09-30 the owner added an engagement slice to the roadmap, before sub-project 4: in-app notifications for
replies, mentions, quotes and follows; mentions stored as data; avatars through the 2b pipeline and sub-project 3's
image checks; share cards for public posts and profiles, served by korbat itself; and help on a new account's first
visit (main design, section 6, row 2d, and section 9, 2026-09-30). The UI sub-project then handed 2d the uploaded
avatar in the monogram's place and the author's per-post "hide counts" (UI design, sections 1.4 and 14). On
2026-10-20 the owner said "finish the app". The owner is not asked questions during the design: every choice a
reasonable owner might want to change is listed in section 2.

### 1.2 The idea in one paragraph

korbat tells a person what other people did with them, and only when they come to look. A reply, a mention, a quote
or a follow writes one row for its recipient in the same transaction as the act, under the recipient's own rules
(who may reach them, and which kinds they want at all), and never across a block or from a muted account. The rows
are read on one screen, Activity, through the same visibility rules every other read of a post uses, so a reply that
moderation later withholds simply stops being shown, and nothing outside that screen counts or badges anything.
Follows are grouped by day; conversations never are. The decisions korbat told the person about their own content
appear in the same list, read only from the reads that already hide anything held. A handle typed in a post is stored
with the account it named at that moment and links to it only while that account still holds the handle, so a person
who renames is not found through old posts. An avatar is an upload like any other, made square by the worker, checked
like every image, served under the same cache rule, and reset by a moderator the way a display name is. A link to a
public post or profile shared elsewhere unfurls into a card that names only korbat, or, once its author has turned
previews on, shows exactly what a signed-out reader sees, built by the API and stitched into the web shell by Caddy,
while robots.txt turns away every crawler but the link-preview fetchers and search engines are asked not to index any
of it. A new account's empty Following feed becomes a short Getting started panel that points to Latest, Explore's
published rule and the handle box, and goes away by itself.

### 1.3 In scope

- **Activity.** The table `activity_items` and the per-account `activity_state` (the seen marker and the per-kind
  rules), written by `createPost` and `follow` in their own transactions and cleaned by `deletePost`, `block` and the
  purge; a retention job; the routes under `/api/activity`; the Activity screen with its tabs All and Conversations, its
  "New since you last looked" divider and its new-entries pill; the Activity page of Settings.
- **Moderation entries.** The decisions told to the author (3c, 3e, 3f and 3d's automated decisions) and 3d's author
  notices (releases, refused uploads, lost images) as entries of the same list, read only through the author-side reads
  (`toldToAuthor`, `authorNotices`) and one new told-only function for lost images.
- **Mentions as data.** The table `post_mentions`, one parser in packages/contracts shared by the server and the app,
  written by `createPost`, read into `PostView.mentions`, and drawn by `RichText` as links only where a mention was
  stored.
- **Avatars.** An upload of kind `avatar` in `post_media`, cropped square by the worker into the two usual file names,
  set and removed by its owner, served publicly under 3d's cache rule, gated by 3c's readers' test, held as evidence by
  an account case, reset by the new measure `reset_avatar` (with `restore_avatar`), sealed by an account case's seal,
  quarantined and released by 3d's paths, and erased with the account; the `Avatar` component's `src`.
- **Share cards.** Two API routes that answer a post's or a profile's card as a header, Caddy's `/post/*` and new
  `/u/*` handles that stitch it into a copy of the shell, a per-account switch for link previews (off by default), a
  `robots.txt` open only to the link-preview fetchers, and `X-Robots-Tag: noindex` on every page that names an account
  and on every API answer.
- **Hide counts.** A per-post switch, set by its author in the composer or the post's More menu, that hides the post's
  like and repost counts from everyone else.
- **First visit.** A Getting started panel in place of the empty Following feed's state, with the handle box on phones.
- **Migrations** named `activity`, `post_options`, `avatars`, `avatar_kinds` and `avatar_moderation`, numbered by the
  dry run after 3b's.
- The data export, the account's deletion and purge, the terms' privacy section and the README extended to all of
  the above; the app's browser check, the fixture API and the integration suite extended; crawler fixtures for cards.

### 1.4 Out of scope, and where it goes

- **Web push and mail for social events.** Not built (decision 9). Web push routes every person's notification
  metadata through a browser vendor's push service and needs the service worker sub-project 4 has not built; a mail
  about a reply is a re-engagement prompt. Native push stays in sub-project 5 (main design, row 5), where its design
  must keep decision 4's rule or reverse it explicitly.
- **Likes and reposts as Activity entries.** Not built (decision 3); they are the first candidates for a later change.
- **Mention suggestions in the composer.** Not built (decision 13): suggesting accounts from a typed prefix is a handle
  search, which korbat keeps out.
- **Named suggestions of accounts to follow.** Not built (decision 25); Explore is the published rule the Getting
  started panel points to.
- **Choosing the crop of an avatar freely.** The picker offers three positions along the longer side (decision 14); a
  free crop with pinch and drag needs a gesture library on the web, which the bundle has no room for.
- **A JPEG card image.** Cards use the WebP files korbat already serves (decision 22); a JPEG variant waits for evidence
  that an unfurler that matters drops WebP.
- **Search engines indexing korbat.** Refused by design (decision 20).
- **Expo SDK 58 and server rendering of the React app.** Not adopted; the card is stitched into the existing shell
  (decision 19).
- **Editing posts.** korbat has none, so a mention is added only at creation and removed only by deletion or
  moderation (section 4.4).
- **Native apps.** The Activity screen, the avatar picker and the cards work on the web first; sub-project 5 brings
  them to iOS and Android with their own file picker.

### 1.5 Rules this design keeps

- **A chronological feed and no engagement dark patterns.** Nothing outside the Activity screen counts, badges or
  marks new activity: no dot, no number, no word on the nav item, nothing in the page title, nothing while korbat is in
  the background, no mail and no push (UI design, decision 7 and section 1.7; AppShell.tsx's "Nothing here counts or
  badges anything"). Inside the screen a divider and a pill say what is new, as the feed's pill does.
- **Calm.** Follows are grouped by day; replies, mentions and quotes are never grouped, since each is a conversation to
  answer. Activity entries are never toasts (UI design, section 5.4).
- **Pseudonymity.** No contact upload, no phone number, no "find friends" step. A share card shows what the public page
  shows signed out and no more, never a count, a moderation state, a standing or an email, and previews of a person's
  posts and profile are off until that person turns them on.
- **Moderation visible and never leaked.** An entry about another person's act is shown only while its post is
  visible to the recipient through `postAccess`; an entry about moderation comes only from the reads that already hide
  a held notice; nothing reveals a block, a mute, a suspension's details or a state the recipient may not see.
- **Blocks both ways, everywhere.** No entry, mention link or card crosses a block in either direction, and a block
  deletes the pair's entries in the transaction that makes it, as it deletes their likes and reposts.
- **Data minimisation and retention with an end.** An entry holds ids and a kind, never a text; it lives 90 days; the
  seen marker and the rules live as long as the account; everything goes with the account's purge.
- **Same rules as every image.** An avatar passes 2b's pipeline and every gate of 3c, 3d and 3e; no program takes a
  measure on an account (3d design, section 16), and an avatar R1's check flags is kept from others only while the
  owner's hold for review is on, as a post's image is (7.6).
- **Self-owned.** No third-party service, library or font. No new package: every piece is built from what korbat
  already pins (sharp in the worker, Hono, Drizzle, zod, Caddy's standard templates module).
- **Migrations.** Hand-written SQL where needed, row-level security and grants as every earlier sub-project; no
  existing migration is edited; 2d's migrations take the next free numbers after 3b's.
- **The UI's language.** Every new sentence in a words module, every screen titled from `TITLE_WORDS`, the kit's
  components and tokens, labels that never clip at 360 px, and the app's JavaScript within its stated budget
  (section 10.9).

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it
costs. All are marked (owner); those a lawyer should confirm are marked (counsel) as well.

### 2.1 Activity

1. **The name (owner).** Chosen: "Activity" for the screen, the nav label and the Settings page; `activity` for the
   API module (apps/api/src/activity/), the contracts (packages/contracts/src/activity.ts) and the job; `activity_items`
   and `activity_state` for the tables. "Notice", "notify" and "alert" stay 3c's, 3d's and 3f's, whose tables, role
   and service already use them (inputs 2.5). Alternative: "Notifications", the common word, whose 13 letters break in
   the 80 px rail where "Bookmarks" already needs all of it (AppShell.tsx's comment), and which collides with 3f's
   `notify` service and `authority_notifications` in every search of the code.
2. **The kinds of entry (owner).** Chosen: four social kinds, `reply` (to the recipient's post), `mention` (the
   recipient's account named in a post), `quote` (of the recipient's post) and `follow` (of the recipient); and
   moderation entries for every notice korbat already tells the recipient about their own content or account: a
   decision told to its author (3c, 3e and 3f's decisions and 3d's automated ones), a release of sealed images, a
   refused upload and a lost image (3d design, section 16). Alternative: moderation stays in Settings, Cases and mail
   only; 3d asked for its four notices to be entries if 2d builds a list.
3. **Likes and reposts do not notify (owner).** Chosen: no entry for a like or a repost. 2a's rule that liker lists
   are never exposed to anyone stands (2a design, Decisions, Visibility), and a stream of small approvals is the
   engagement loop korbat leaves out. Alternatives: named reposts grouped per post and day (a repost is already public
   on the reposter's profile, so it reveals nothing new; it costs one kind and one setting); likes as an anonymous count
   per post since the last visit ("12 likes on your post"), which says only what the public count says; named likes,
   which reverse 2a's decision and need the main design amended.
4. **How a person learns that something arrived (owner).** Chosen: only by opening Activity. Nothing on the nav item,
   in the page title, on the app icon or anywhere else says that something is new, and nothing asks for new entries
   unless the Activity screen is open. Alternative: an opt-in setting, off by default, that puts the word "new" on the
   Activity nav item; it is the first sign of activity on navigation korbat would draw, and it costs one request on
   every route's first load, the third of the three the UI design's section 11.3 allows.
5. **The seen marker lives on the server (owner).** Chosen: one time per account, `activity_state.seen_at`, moved
   forward when the Activity screen shows its first page, so an entry is marked new once on every device. This is the
   first per-account reading marker korbat keeps on the server; the feed's reading place stays on the device (UI design,
   decision 8), because a feed's place is per device and per tab while Activity is one list per account. Alternative:
   the marker on the device, cleared at the session's end like `korbat.place`; each device then shows the same entries
   as new.
6. **Grouping (owner).** Chosen: follows are grouped by the UTC day they arrived in ("Ada and 4 others followed you"),
   with up to three names and the count; replies, mentions, quotes and moderation entries are never grouped. A day is
   a fixed bucket, so a group never splits across pages; a group is labelled with the time of its newest follow, as
   every entry is, so a UTC day never shows as a day in the reader's own zone. Alternative: Bluesky's 48-hour window,
   which moves as follows arrive and needs grouping in the client across page edges; or no grouping at all.
7. **Who may reach a person (owner).** Chosen: one setting per kind on Settings, Activity: replies, mentions and quotes
   each "Everyone", "Accounts older than 2 days", "Accounts you follow" or "Off"; follows "On" or "Off"; every default
   is Everyone or On. "Accounts older than 2 days" leaves out accounts made in the last 48 hours (the age korbat's write
   limits and Explore already use, a rule and never a reputation), which quiets a pile-on by fresh accounts without
   silencing everyone the person does not follow. A setting that excludes an act means no row is written; a change
   applies to new acts only. Alternatives: no age choice, which leaves "Accounts you follow", Off, mutes and blocks as
   the only answers to a sock-puppet pile-on; or keeping excluded rows and hiding them, which stores more.
8. **A mute silences Activity (owner).** Chosen: while a person mutes an account, its acts write no entry for them and
   its earlier entries are hidden; an unmute shows the earlier ones again. A mute stays silent and one-way, so the muted
   account learns nothing. Privacy's explanation, "A mute only hides an account from your timelines", changes to name
   Activity too (section 10.8). Alternative: mutes stay timelines-only, as 2a built them (social/repo.ts:21).
9. **No web push and no mail (owner).** Chosen: neither. Alternative: web push behind an owner's switch, off by default,
   which sends when and how often each person is notified to Google, Mozilla or Apple, needs a service worker and VAPID
   keys, and is a re-engagement channel; or a daily mail digest, which is one.
10. **Entries after the fact (owner).** Chosen: an entry whose post is withheld, removed or disabled is hidden at read
    through `postAccess` and shown again if the post is restored; an entry whose post its author deletes is deleted in
    the deletion's transaction; a block deletes the pair's entries both ways; a follow entry is shown only while the
    follow stands; entries an account caused stay when it is later suspended or terminated, as its posts stay visible
    with no label (3e design, line 725); an account's purge deletes every entry it caused or received. Alternative:
    keep a deleted post's entries as "a post that was deleted"; or hide a suspended actor's entries, which would tell
    the recipient that the actor was suspended.
11. **Retention (owner, counsel).** Chosen: an entry is deleted 90 days after it was written, by the job
    `activity-retention`; the seen marker and the settings live until the account goes. Alternative: the newest 1,000
    entries per account, which keeps a quiet account's entries for years.

### 2.2 Mentions

12. **Which mentions count and what they link to (owner).** Chosen: the first 20 distinct handles of a post, in text
    order, that name a live account are stored with that account and the handle as written, whatever blocks exist;
    whether one links is decided per reader (a reader who blocks, or is blocked by, the mentioned account sees plain
    text) and whether it notifies per recipient (no entry crosses a block, 5.2), so the stored text never tells a third
    reader that a block exists. A stored mention links only while its account still holds the handle as written: after
    a rename it shows as plain text, so a person who renames to step away is not found through old posts, and the entry
    already sent stays. The first 10 stored notify, the author and a reply's parent author (who gets the reply entry
    instead) not counted. A reply notifies its parent's author only, never the thread's other authors. A post with more
    handles is accepted; the rest stay plain text. Alternatives: refuse a post that names more than 10 accounts, which
    turns a limit into a mistake to correct; let a stored mention follow its account's current handle, which leads every
    post that ever named a person to their new name (the rename screen and the README would then have to say so); leave
    a mention across a block unstored, which shows every reader as plain text that the two accounts had a block.
13. **No mention suggestions (owner).** Chosen: the composer suggests no account from a typed prefix; a person types
    the whole handle, as the handle box asks today. Suggesting from a prefix is a handle search, a ready tool for
    finding accounts to target, which korbat keeps out (main design, 2026-09-30, "Unchanged"). Alternative: an
    exact-handle check while typing, through `GET /api/profiles/:handle`, that marks a typed handle as found; it adds a
    request per handle and tells nothing the handle box does not.

### 2.3 Avatars

14. **Storage and crop (owner).** Chosen: an avatar is a `post_media` row of the new kind `avatar`, uploaded through
    `POST /api/media` with `kind=avatar`, so the owner, status, files, hashes, R1 score, matcher, holds, purge outbox,
    quarantine and erasure of 2b and 3d apply to it, the last three with the small changes of sections 6.4 and 6.5
    (they knew only images on posts). The worker crops it square at one of three positions
    along the longer side (start, centre, end), which the picker shows over the local file before upload, and writes
    a 400 px square as `large.webp` and a 128 px square as `small.webp`; the uncropped image is never stored.
    Alternative: a table of its own (as 3d's section 16 assumed), with each gate rebuilt; or a free crop in the browser,
    which needs a gesture library the bundle has no room for.
15. **What the checks do to an avatar (owner).** Chosen: an upload the matcher refuses is refused and held as any
    upload; an avatar whose R1 score is at or over the threshold, or that the matcher flags without acting, opens a
    program's finding on an account case with the avatar in scope and takes no measure, whatever
    `AUTOMATION_R1_ACTS` says, because no program takes a measure on an account (3d design, section 16); a moderator
    decides, with `reset_avatar`. While `AUTOMATION_R1_ACTS` is on, an avatar whose R1 score is at or over the threshold
    is also kept from everyone but its owner (the monogram shows) until a person decides, as an image in a post is
    withheld (7.6); with it off, nothing changes. Alternatives: refuse to set such an avatar, which tells the person how
    to get past the check, which is why 3d did not build the composer's warning (main design, 2026-10-19); show a
    flagged avatar to everyone until a moderator decides, whatever the owner chose for R1.
16. **Moderation of an avatar (owner).** Chosen: the account-case measure `reset_avatar`, interim or final, with its
    reversal `restore_avatar`, as 3c's `reset_display_name`: a compare-and-set against the report's snapshot, the
    monogram as the placeholder, written once; the author may set a new avatar at any time, judged on its own if
    reported, except the very picture the moderator removed (the same file by its SHA-256), which is refused as the
    account's picture for 30 days with words that say why; the reversal puts nothing back. An account's report
    snapshots the avatar by reference and holds its row; an account case's seal reaches the account's avatar rows as it
    reaches its posts' images. Alternatives: hold the avatar against its author's edits for the measure's length, which
    is a partial suspension 3e reserves for measures with a statement of their own; accept the same picture again at
    once, so that every return of an impersonating photo needs a new report and decision.
17. **What a suspended account may still change (owner).** Chosen: its avatar stays, with no label, as the profile does
    (3e design, section 2), and the account cannot set a new one while suspended, as it cannot change its display name.
    It may still remove its picture, turn link previews off and hide a post's counts: each only reduces what others
    see, as withdrawing from Explore does today; setting an avatar, turning previews on and showing counts stay refused
    by 3e's predicate. The route walk's `SUSPENDED_WRITES` records each (9.4). Alternative: refuse all three while
    suspended, which leaves a person whose picture or name is being passed around during a suspension only the deletion
    of the whole account.
18. **`profiles.avatar_path` goes (owner).** Chosen: the column, never written since 1b, is dropped; the profile's
    avatar is the `post_media` row whose `profile_id` names it. Alternative: keep the dead column and its grant.

### 2.4 Share cards and indexing

19. **How a card is served (owner).** Chosen: the API answers `GET /api/cards/post/:id` and
    `GET /api/cards/profile/:handle` with the card's head block, built and escaped in TypeScript, in one response header
    (`Korbat-Card`, base64); Caddy's `/post/*` and new `/u/*` handles ask it, as `/post/*` asks the status route today,
    and serve `card.html`, a copy of the exported shell made at the image's build with one template action that
    inserts the decoded header, through Caddy's standard `templates` module. Nothing the API sends is evaluated as a
    template. Alternatives: the API answers the whole document (the API image then needs the web export, built twice
    with the same hashes); answers by User-Agent to known crawlers only (every unlisted fetcher gets the bare shell);
    expo-router's server output on Expo SDK 58 (a new service and an SDK move for a head).
20. **No indexing and no collection (owner, counsel).** Chosen: `robots.txt` allows `/post/`, `/u/` and `/api/media/`
    only to the link-preview fetchers the design supports, named by their robots.txt tokens (Twitterbot,
    facebookexternalhit, Slackbot-LinkExpanding, Discordbot, LinkedInBot), so they still make cards, and disallows
    everything to every other agent: search engines, archives, data brokers and crawlers collecting text and images for
    model training. Pages that name an account keep `X-Robots-Tag: noindex` (every page of the app's site except `/`,
    `/rules`, `/transparency`, `/explore/about` and `/terms`), every API answer carries it, and every card has a robots
    meta tag. A search engine's index of korbat would rebuild the keyword search korbat keeps out. A crawler that
    ignores robots.txt is out of korbat's reach; what the terms may forbid is counsel's (11.3). Alternatives: a
    robots.txt open to every agent, relying on `noindex`, which a collector never reads; or index public posts and
    profiles, which makes korbat searchable by anyone's words through a third party.
21. **Link previews, per account (owner, counsel).** Chosen: off by default for every account; while off, a shared link
    to the person's posts or profile unfurls into a generic card that names only korbat. The switch on Settings,
    Privacy, "Show a preview when someone shares a link to my posts or profile", turns previews on, with one sentence
    saying what a preview shows and where; no prompt, panel or banner asks the person to turn it on. A card shows only
    what a signed-out reader sees, but other platforms keep their copy beyond korbat's reach (X for about 7 days, Meta
    until a re-scrape, every Mastodon instance its own), so a deleted post may still show there. Whether "on" by default
    could suit Art. 25(2) GDPR and, with members from 16, Art. 28 DSA is counsel's (11.3). Alternative: on by default,
    with a row of the Getting started panel pointing to the switch, which hands each shared post's name, text and
    picture to other platforms' stores without the person's act.
22. **What a card shows (owner).** Chosen: a post's card: the author's display name and handle as the title, the
    post's text cut to 200 characters as the description (an imported post's label first), its first image that is
    shown to everyone with its description, else the author's avatar, else no image; the time it was posted. A
    profile's card: the display name and handle, the bio cut to 200 characters, the avatar. Never a count, the
    verified badge, a moderation state, a standing or anything a signed-out reader does not see. Cards use the WebP
    files korbat serves. Alternative: a JPEG card variant from the worker for Meta, whose documentation lists only JPEG,
    GIF and PNG; counts in the description.
23. **The served page title (owner).** Chosen: the `<title>` the server sends stays the shell's "korbat", and the
    app's own title ("Post - korbat", "Profile - korbat") replaces it once the bundle runs; names appear only in the
    card's Open Graph tags, which every unfurler reads before `<title>`. A browser's history then never holds a handle
    (UI design, decision 16). Alternative: the card's name in `<title>`, which the history keeps when the bundle fails
    to load.

### 2.5 The screens, the budget and the record

24. **Where Activity sits in the nav (owner).** Chosen: second, after Home, for an account: Home, Activity, Bookmarks,
    Profile and Settings in the rail and the full nav; on a phone the tab bar keeps four items, Home, Activity,
    Bookmarks and Profile, and Settings is reached from the profile's settings button, which every own profile already
    shows (the UI sub-project's commit 61b1134) and whose label changes from "Security and privacy settings" to
    "Settings", since it is then the phone's only way to Appearance, Activity, Account and Cases (10.1). Five items in
    the 360 px tab bar leave 72 px each, and the walk-through found that "Bookmarks" breaks in the word below 80 px
    (AppShell.tsx's comment on the rail). This ends the shell's rule that the nav has the same items at every width (UI
    design, section 7.1), for the phone alone. Alternative: five items on a phone, with "Bookmarks" shortened or broken;
    or Activity reached from Home's header, which hides it.
25. **First-visit help (owner).** Chosen: while an account's Following feed is empty, Home's Following tab shows a
    Getting started panel in place of today's empty state: Latest, Explore and how it picks, the handle box (which
    phones do not otherwise see), the profile's settings with the avatar, and the rules, one line and one link each.
    Nothing is stored: the panel ends by itself with the first followed account's first post, nothing is dismissed and
    nothing syncs. No account is suggested by name. Alternative: a one-time card dismissed with "Not now" kept on the
    device, as the passkey suggestion is; or named suggestions by a published rule (for example accounts with posts in
    Explore now), never follower counts alone and never reputation.
26. **Hide counts, per post (owner).** Chosen: the author of a post may hide its like and repost counts, in the
    composer's options before posting or from the post's More menu at any time after; everyone else then receives no
    number for them in any answer, the answer to their own like or repost included (the API sends null), while reply
    and quote counts stay, as the reader's own setting has it (UI design, decision 15). The author keeps seeing the
    numbers on their own post. Alternative: leave it out of 2d; it was listed for 2d by the UI design (sections 1.4
    and 14) and not by the 2026-09-30 amendment.
27. **The JavaScript budget (owner).** Chosen: 2d adds at most 20 KB (20,480 bytes) of gzipped JavaScript to the web
    export as 3b's replay leaves it. The cap at 2d's start is 832,257 bytes, the baseline of 1222b87 plus 120 KB, set by
    3b's Task 7 under the orchestrator's rule for an overrun (inputs 1.3), when the export measured 812,307 bytes
    (apps/app/test/browser/app.browser.ts:622-623; 791,297 at 0bc2dcc). If the export after 2d goes past the cap, Task 5
    raises it to 852,737 bytes, the baseline plus 140 KB, by editing those two lines, as an amendment of section 15
    flagged (owner). Every icon is imported by its path, the
    avatar's crop is the worker's, and no library is added. Alternative: a smaller Activity screen without tabs or the
    pill, which saves a few kilobytes and leaves the cap alone.
28. **The data export (owner, counsel).** Chosen: the export gains the avatar's file and its size, the link-preview
    switch, each post's mentions as the handles written and its hidden-counts switch, and a member `activity` with the
    seen marker, the settings and every row the account received that korbat still holds (kind, time, the post's id and
    the actor's handle at the time of export), each with whether it is shown and, if not, why (muted, post not visible,
    unfollowed, actor deleted), a post not visible to the person named by no id. The right of access reaches what korbat
    holds, not only what it draws. Alternatives: only the rows the list shows, which hides from the person what korbat
    kept about them; or leave the entries out.
29. **Deleting an account removes its avatar at once (owner).** Chosen: the purge that the deletion request runs at
    once (1b) deletes the avatar's row with the account's other images in its `within`, and serving refuses an avatar
    whose profile is deleted from the same transaction on; a row that a case holds, a seal lists or a frozen case keeps
    stays until nothing keeps it (`post_media_keep`, 6.4 and 6.5), served to nobody. Alternative: keep the picture of
    a deleted account until the evidence of every case about it is erased, which shows a "Deleted account" with a face.
30. **Cards and the API's global limit (owner).** Chosen: a card's question counts against the visitor's address under
    the API's global limit, as the status route's does, and a 429 falls back to the plain shell with 200, which loses
    only the card. Alternative: a limit of its own for the card routes, which lets a burst of shares from one platform's
    crawler addresses through at the cost of another number to tune.

## 3. What exists

A short account of inputs.md, which holds every line number; the paths here are the ones 2d changes.

### 3.1 The brief and what changed it

- The main design's row 2d (line 223) and its 2026-09-30 amendment (lines 327 to 338) are the brief. The UI sub-project
  (2026-10-21) delivered client-side titles on every screen, the light themes and the monogram `Avatar`, and handed 2d
  uploaded avatars, mentions as data, share cards, first-visit help, notifications and the author's per-post "hide
  counts" (UI design, lines 36 and 1097). Its decision 7 (the new-posts pill is the only sign of new posts), decision
  8 (the reading place on the device), decision 16 (a title never names an account) and decision 22 (monograms until
  2d) bind this design (inputs 1.3).
- 3b (2026-10-22, built by ebc8778) adds `posts.import_job_id` and four more import columns, `PostView.imported`,
  the Imported tab, migrations 0043 to 0048, and says that 2d's parser skips imported posts and that their cards carry
  the provenance label (3b design, sections 5.3, 6.2 and 14).
- 3d's section 16 asks 2d to bring avatars under 3c's gates and 3d's quarantine, outbox, hashing and public header, and
  to make 3d's four author notices entries of any list 2d builds. 3e's and 3f's designs ask every new write to use
  3e's predicate and every new reader of a post to go through `postAccess` (inputs 1.5).

### 3.2 Posts, the graph and their writes

- `posts`, `follows`, `blocks`, `mutes`, `likes`, `reposts` in packages/db/src/schema/content.ts; every table has row
  level security with one policy for the API role (`fullAccess`, packages/db/src/schema/helpers.ts). Posts are never
  edited.
- The writes are transactions in apps/api/src/social/repo.ts (`createSocialRepo`): `createPost` (guardPair across a
  block, `lockActing`, the insert, counters, `judgeActing`), `deletePost` (tombstone), `like` and `repost`, `follow`
  (answers whether a row was inserted), `block` (removes follows and engagement both ways), `mute`, and
  `purgeProfile`. Write limits per account live in apps/api/src/social/tiers.ts and are counted in Valkey
  (apps/api/src/social/limits.ts).
- Reads go through `postAccess` (apps/api/src/social/visibility.ts:20-38) and the SQL fragments of repo.ts (`visibleTo`,
  `otherNotBlocked`, `otherWelcome`). Views are built in apps/api/src/social/views.ts; contracts in
  packages/contracts/src/social.ts (`Author`, `PostView`, `PostCounts`, `ProfileView`).
- 3e's predicate `liveNotSuspended` (apps/api/src/lib/standing.ts) judges every write by the acting account; the
  architecture test (apps/api/test/architecture.test.ts, `STANDING_PREDICATE`) pins the files that may name it and how
  many times each, and the route walk (apps/api/test/integration/standing-route-walk.test.ts, `SUSPENDED_WRITES`)
  records what a suspended account gets from every write route.

### 3.3 Mentions today

`RichText` (apps/app/src/components/social/RichText.tsx:8) links every `@handle` it finds to `/u/<handle>` in the client
only. The token has no right boundary, a renamed account's old mentions open "This account is not available", and
nothing is stored or notified (inputs 2.3). A handle once held stays that profile's for good, a deleted account's
included (`handle_history`, packages/db/src/schema/identity.ts), so no other account ever receives an old mention's
link. Post text is normalised and refuses bidirectional and zero-width characters (packages/contracts/src/text.ts), and
handles are ASCII `^[a-z0-9_]{3,20}$` (apps/api/src/auth/handles.ts), so a handle cannot be disguised in a post.

### 3.4 Images

- An upload is `POST /api/media` (apps/api/src/media/flows/upload.ts), a `post_media` row (owner, status, `post_id` and
  `position` once attached, `moderation_state` derived from the ledger, `hold_until`, `erased_at`), and a file the
  worker (apps/worker/src/pipeline.ts, no network) turns into `large.webp` (2,048 px) and `small.webp` (1,024 px) with a
  blurhash and, while 3d's tools are on, an R1 score and a PDQ hash (packages/media-protocol/src/limits.ts and
  result.ts). The sweeper (apps/api/src/media/sweeper.ts) deletes an upload left on no post for a day.
- Serving (apps/api/src/media/flows/serve.ts) joins the image to its post (`fileAccess`, media/repo.ts:287) and answers
  a visible image of a visible post with `public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`; an
  image on no post is not found for everyone.
- 3c's ledger derives every image's state (`moderation_apply`, last replaced in migration 0028); an account case
  resets the display name or the bio (`reset_display_name`, `reset_bio`) and seals the account's posts' images
  (`seal_media`); evidence copies a post or a profile into `evidence_snapshots` and holds images by reference in
  `media_holds`. 3d writes an outbox row (`edge_purges`) from the triggers `post_media_purge` and `posts_purge`
  (migration 0035) whenever an image on a post stops being public, keeps sealed files in the `media-quarantine` volume
  (`quarantine_files`, whose file names are `small.webp` or `large.webp`), and handles a refused upload, an image on no
  post, by its media id.
- `profiles.avatar_path` (packages/db/src/schema/identity.ts:13) exists, is granted to the API and has never been
  written; the purge sets it null.

### 3.5 The author's notices

The author-side reads are the only source of moderation entries: `toldToAuthor`
(apps/api/src/moderation/author-repo.ts:24) keeps every decision whose author was not told or whose notice is held out
of the chip, the Cases screen and the export; `authorNotices` (apps/api/src/moderation/release.ts:360) lists releases
whose notice is not held and refused uploads; a lost file's notice is mailed by 3d's dispatch from
`quarantine_files.lost_told`, which the API's role cannot read except through 3d's functions. The app shows them under
Settings, Cases (apps/app/src/app/settings/cases/).

### 3.6 The web shell, Caddy and crawlers

The web app is a single-page export: every route gets the same `index.html` (apps/app/public/index.html is its template,
`<title>korbat</title>` once exported), built inside Caddy's image (infra/caddy/Dockerfile) and served with the page's
security headers (`app_page_headers`, infra/caddy/Caddyfile). `/post/*` already asks the API once per view
(`GET /api/posts/:id/status`) and serves the shell with 200 or 404 by its answer, and with 200 when the API cannot be
asked. There is no `robots.txt` and no `X-Robots-Tag`. Unfurlers read Open Graph and Twitter tags from the first bytes
of the HTML and none is documented to run JavaScript (inputs 3.1 to 3.4). The API knows the app's origin as
`APP_ORIGIN` (apps/api/src/config.ts:114).

### 3.7 The app

The shell (apps/app/src/components/AppShell.tsx) has four items for an account (Home, Bookmarks, Profile, Settings) and
draws nothing that counts. `Avatar` (apps/app/src/components/kit/Avatar.tsx) draws a monogram and already takes an
unused `src`. Every sentence lives in a words module (apps/app/src/lib/ui-words.ts, settings-words.ts,
moderation-words.ts), every screen has a title from `TITLE_WORDS`, and the source scan in apps/app/test/a11y.test.tsx
refuses bare strings. Sign-up ends at Home's empty Following feed (apps/app/src/components/social/FeedList.tsx, the
words `feed.empty.following.*`). The browser check (apps/app/test/browser/app.browser.ts, 51 steps after 3b, with the fixture API
apps/app/test/browser/fixture-api.ts) holds the JavaScript cap at the baseline of 1222b87 plus 120 KB (832,257 bytes,
app.browser.ts:622-623), which 3b's Task 7 set when the export measured 812,307 bytes (decision 27).

### 3.8 The export, deletion and the purge

The export is one streamed ZIP with `export.json` whose members are written in the order of `ExportFormat`
(packages/contracts/src/account.ts:224; apps/api/src/account/flows/export.ts); each image is a file `media/<id>.webp`.
Deletion (1b) runs the purge at once and its job resumes it: `purgeProfile` (apps/api/src/social/repo.ts:1361), in one
transaction under the profile's lock, anonymises the profile, tombstones the account's posts, removes its graph and runs
the media module's deletion of its images in `within`. No foreign key cascade fires on a profile, because no profile row
is ever deleted.

## 4. Mentions as data

### 4.1 The rule, in one place

A mention is a handle typed in a post's text, `@` followed by 3 to 20 of `a-z`, `A-Z`, `0-9` and `_`, with no such
character on either side. packages/contracts/src/mentions.ts (new) holds the one tokenizer both the server and the app
use:

- `MENTION_TOKEN = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g`. The right boundary is new: today's
  `RichText` token links `@abcdefghijklmnopqrstuvwxyz` to its first 20 characters, a different possible account; the
  new token does not match it at all.
- `mentionHandles(body: string): string[]`: the handles in text order, lowercased, each once, at most
  `MENTION_SCAN_MAX` (40) distinct handles read, so a 1,000-character post of 200 handles costs one bounded lookup.
- `MENTION_STORE_MAX = 20` and `MENTION_NOTIFY_MAX = 10` (decision 12).
- The `@` must not follow a letter, a digit or `_`, so `ada@example.org` is no mention, as today. A handle that starts
  with `retired_` is matched like any other: 3e's placeholder is an account's current handle.

Post text is already normalised and refuses bidirectional and zero-width characters (packages/contracts/src/text.ts),
and handles are ASCII, so a mention cannot be split, hidden or imitated by a homoglyph.

### 4.2 Writing a mention

`createPost` (apps/api/src/social/repo.ts) takes a new input `mentions: string[]`, the result of `mentionHandles` on the
normalised body, which the flow (apps/api/src/social/flows/posts.ts) computes before the transaction. Inside the
transaction, after the post's insert and before `within`:

1. One statement resolves the handles and takes each mentioned profile's row as `lockLive` does: `select id,
   lower(handle) from profiles where lower(handle) = any($1) and deleted_at is null order by id for key share`. A
   profile deleted while the statement waited for its lock is dropped, not refused: under READ COMMITTED the row is
   read again after the wait and fails `deleted_at is null`, so a purge that commits first leaves no mention and no
   entry naming the purged account. Blocks are not read here (decision 12): a mention is stored whatever blocks exist;
   whether it links is decided per reader (4.3) and whether it notifies per recipient (5.2). Old handles in
   `handle_history` are not read: a handle names the account that holds it now, at the moment of writing.
2. The kept accounts, in the order their handles first appear in the text, are cut to `MENTION_STORE_MAX` and inserted
   into `post_mentions` (`post_id`, `account_id`, `handle` as written in lowercase, `position` from 0) in one statement.
3. The Activity rows of section 5.3 are written from the same list.

The pair lock is taken only with a replied-to or quoted author (`guardPair`), so a block made while the post is in
flight is not waited for: an entry that raced it is hidden at read while the block stands (5.6). A self-mention is
stored and linked, never notified. An empty list writes nothing.

Imported posts are never parsed: 3b's `publishImportedBatch` inserts posts without calling `createPost`, and 2d does not
add mentions to it, so an imported body keeps its handles as plain text and never notifies (3b design, sections 5.3 and
14). A test holds it (section 12.3).

### 4.3 Reading a mention

`PostView` (packages/contracts/src/social.ts) gains `mentions: string[]`: the handles of the post's stored mentions that
link for this reader, lowercased, in text order. `loadPostViews` (apps/api/src/social/views.ts) reads them for a page of
posts in one statement: `post_mentions` joined to `profiles` where the profile is not deleted, its handle still equals
the handle as written (`lower(p.handle) = m.handle`), and, for a signed-in reader, no block exists between the reader
and the mentioned account in either direction, the same pair test every read uses. A signed-out reader gets every live
mention whose handle is unchanged, as a signed-out reader sees every public profile. `QuotedPost` gains nothing: the
embed draws plain text (4.5).

What the reader sees:
- A stored handle links to `/u/<handle>` while its account still holds it. After a rename (`changeHandle`) or a
  retirement (3e's `retire_handle`) it is plain text, so a person who renames is not found through the posts that named
  the old handle; the Activity entry already written stays (decision 12). A handle once held is never given to another
  account (3.3), so an old mention never reaches anyone else.
- A handle that was not stored (no such account then, beyond the first 20, or an imported post) is plain text, and so is
  a stored one whose account is now deleted or blocked either way with this reader. A mention is stored whatever blocks
  exist (4.2), so no third reader learns of a block.
- The text is never rewritten: the post still says what its author typed.

Posts deleted by their author carry no body, so their mentions are never read; their rows go in the deletion (4.4).

### 4.4 Deletion, moderation, handle changes and the purge

- **Deleted by its author.** `deletePost` deletes the post's `post_mentions` rows and its Activity rows in its own
  transaction, in the statement after the tombstone. Nothing of a deleted post's mentions stays.
- **Withheld, removed or disabled.** The rows stay: the author still sees their post and its links. Readers who are not
  shown the post do not read its mentions, and Activity hides the entries (5.6).
- **Erased.** When a post's `erased_at` becomes set (3c's R4 redaction blanks the body, 3f's end of preservation, 3d's
  release), the trigger `post_mentions_erase` deletes its mention rows: a blanked body keeps no list of the handles it
  named.
- **Handle changes.** A mention is stored by account id and the handle as written, so a rename (`changeHandle`) and a
  retirement (3e's `retire_handle`) change nothing stored; the link holds only while the account's handle equals the
  one written (4.3), so after either the old mention is plain text, and the entry already sent stays.
- **An account's purge.** `purgeProfile` deletes every `post_mentions` row naming the purged account and those of its
  own posts, which it tombstones, and every Activity row it caused or received (5.6), in its transaction, after the
  tombstones, beside the removal of its follows, blocks and mutes.

### 4.5 Rendering

`RichText` (apps/app/src/components/social/RichText.tsx) keeps its link token for URLs and takes mentions from the
contracts' `MENTION_TOKEN`. It gains the prop `mentions: string[]`; a token is a link exactly when its lowercased
handle is in that list, to `/u/<handle>`, in accent ink with its "@" and no underline, as the UI design
draws a mention (section 6.6). 3b's prop `mentions={post.imported === null}` (3b design, section 5.3) is replaced by
passing the post's list: an imported post's list is always empty, so the same test passes (an imported "@ada" while an
account @ada exists links nothing). `QuoteEmbed` and the bio stay plain text, as today: a quote's own mentions are read
on its own page.

The composer changes nothing in its text field. Below the field, once the text holds a handle, it shows one line from
`ACTIVITY_WORDS` (section 10.10, `activity.composer.mentions`) saying that up to 10 accounts named in a post are told,
the mentioned accounts' own settings permitting. No account is looked up while typing (decision 13).

## 5. Notifications: Activity

### 5.1 The entries

| Kind | Written when | For whom | What the row holds |
|---|---|---|---|
| `reply` | `createPost` inserts a reply | the parent post's author | the reply's id, its author |
| `quote` | `createPost` inserts a quote | the quoted post's author | the quoting post's id, its author |
| `mention` | `createPost` stores a mention (4.2) | each of the first 10 mentioned accounts | the post's id, its author |
| `follow` | `follow` inserts a follow | the followed account | the follower |
| moderation | never written | the author of the decided content or account | nothing: read from the author-side reads (5.5) |

A recipient gets at most one entry per post: a reply that also quotes or mentions its parent's author makes one `reply`
entry; a quote that mentions the quoted author makes one `quote` entry. The order is reply, then quote, then mention.
A reply notifies its parent's author only, never the thread's root or its other authors (decision 12).

### 5.2 The recipient's rules

`activity_state` (6.2) holds, per account, `replies`, `mentions` and `quotes` (each `everyone`, `older`, `following` or
`off`) and `follows` (true or false). An account without a row has the defaults: `everyone` and true. An act writes an
entry for a recipient only when all of these hold, in the act's own transaction:

- the recipient is not the actor and is not deleted;
- no block exists between them in either direction;
- the recipient does not mute the actor (decision 8);
- the recipient's setting for the kind is `everyone`; or `older` and the actor's account was created at least
  `ACTIVITY_MIN_AGE_HOURS` (48) hours before the act (`profiles.created_at`, the age korbat's write limits and Explore
  already use, a published rule and never a reputation); or `following` and the recipient follows the actor; or, for a
  follow, `follows` is true.

A refused rule writes nothing, so changing a setting later applies to new acts only and brings nothing back. A
suspended account cannot act (3e's predicate refuses its reply, quote and follow before any of this), so it causes no
entry. A suspended recipient still receives entries and reads Activity: what others do toward a suspended account is
unchanged (3e design, line 725) and reading is left to it.

### 5.3 Writing

- **In `createPost`.** After the post's insert and the mentions (4.2), one statement builds the candidates (the parent's
  author for a reply, the quoted author for a quote, then the stored mentions by position, the author and the
  recipients already listed removed, cut to `MENTION_NOTIFY_MAX`), joins each to its `activity_state` row, its follow of
  the author and its mute and block rows, reads the author's `created_at` once, and inserts the passing ones into
  `activity_items` with `on conflict do nothing`. It runs before `judgeActing`, so a post refused by the closing
  judgment leaves no entry. The parent and the quoted author are already locked live by `lockLive`, and the mentioned
  accounts FOR KEY SHARE by 4.2's lookup, in id order. Lock order: a post by A that mentions M while M is purged, where
  A follows M or M follows A, crosses the purge (A FOR NO KEY UPDATE by `lockActing`, then M FOR KEY SHARE; the purge
  holds M FOR UPDATE, then A FOR NO KEY UPDATE as a follow counterpart), as the purge already crosses a quote or a
  follow (`purgeProfile`'s comment, apps/api/src/social/repo.ts:1355-1359): PostgreSQL detects the cycle, `createPost`
  tries once more, and the purge is tried again by its job's next round.
- **In `follow`.** When the insert answered true (a follow that did not exist), the same statement for the one
  candidate. The unique key `(recipient_id, actor_id)` of follow entries makes a follow, unfollow and follow again
  within 90 days one entry, with the time of the first.
- **Nowhere else.** No other module writes `activity_items`. The architecture test (apps/api/test/architecture.test.ts)
  pins, in one table, the files that may name each of 2d's tables:

  | Table | Files that may name it |
  |---|---|
  | `activity_items` | apps/api/src/social/repo.ts (the writes and the deletions of 5.6); apps/api/src/activity/ (the reads, the newer count and the retention job) |
  | `activity_state` | apps/api/src/social/repo.ts (`createPost`'s and `follow`'s rules join it; `purgeProfile` deletes it); apps/api/src/activity/ (the seen marker and the settings) |
  | `post_mentions` | apps/api/src/social/repo.ts (`createPost`'s insert, the deletions of 4.4, the export's `exportProfile`); apps/api/src/social/views.ts (`loadPostViews`' read, if the read is written there) |

  As an assertion of its own, the one insert into `post_mentions` is in `createPost`.

### 5.4 What never makes an entry

- A like, a repost, a bookmark (decision 3).
- An act across a block in either direction: `guardPair` already refuses a reply, a quote and a follow across one, a
  mention across one is stored (4.2) but writes no entry (5.2), and the read hides any row that slipped past (5.5).
- An act by a muted account, for the person who muted it.
- An act a recipient's setting excludes.
- A post's own author naming, replying to or quoting themselves.
- An imported post's text (4.2); a reply to, a quote or a repost of an imported post is an ordinary act and follows
  the rules above.
- A moderation event: no row is ever written for one. Moderation entries are read from what the author may already
  read (5.5.2), so a held notice, a decision told to nobody, a staff note, a report about the recipient, a finding, a
  flag, a seal taken while deciding about someone else, or a suspension's details never appear.
- Anything staff do in the console, and anything the console can read: no staff route reads Activity, as none reads
  likes or follows (3c design, section 11), and the architecture test holds that apps/api/src/staff/ and
  apps/api/src/moderation/ never import the activity module or name its tables. Its `MODULES` list
  (apps/api/test/architecture.test.ts:28) gains `activity`, so the module is entered only through its index and this
  rule has something to stand on.

### 5.5 Reading

#### 5.5.1 Social entries

`GET /api/activity` (section 9) reads one page for the signed-in account R, newest first, with a keyset cursor on
(`at`, `key`):

- From `activity_items` where `recipient_id = R`, joined to the actor's profile, keeping a row only while the actor is
  not deleted, no block exists between R and the actor in either direction, R does not mute the actor, a `follow` row's
  follow still stands, and a post row's post has `state = 'visible'`. These are the rules of `otherWelcome` and
  `visibleTo` (apps/api/src/social/repo.ts), written once in the activity module's query and named in its comment.
- Rows that are not follows are entries of their own, with `key = 'e:' || id` and `at = created_at`.
- Follow rows are grouped by the UTC day of their `created_at` (decision 6): one entry per day, with `key = 'f:' ||
  day`, `at` the newest follow of the group, the number of distinct followers, and the three newest followers.
- The posts of the page's entries are built by `loadPostViews` for R, which passes each through `postAccess`
  (apps/api/src/social/visibility.ts); a post that does not pass, which only a race between the query and the views can
  produce, drops its entry from the page. This is the reader 3f's design asks every new reader of a post to be (3f
  design, line 237).

The tab Conversations keeps only `reply`, `mention` and `quote` rows and no moderation entries; the tab All keeps
everything.

#### 5.5.2 Moderation entries

On the tab All only, the activity module asks the moderation module's index for `authorActivity(viewer, before,
limit)`, a new function of apps/api/src/moderation/author.ts that answers, newest first by the time the author was told
and no older than `ACTIVITY_KEEP_DAYS` (90) days, so that the list's end sentence (`activity.end`) is true of both
sources while Cases keeps the full history, entries built only from the author-side reads:

- a decision told to its author: the rows the Cases screen's "About you" list reads, through `toldToAuthor('d')`
  (apps/api/src/moderation/author-repo.ts:24), with `at` the decision's `informed_at`, `key = 'd:' || decision id`, and
  its target (a post with its time, the profile, or the account for 3e's standing decisions). 3d's automated decisions
  are decisions told the same way, so a program's measure appears here;
- a release of sealed images and a refused upload: the rows of `authorNotices` (apps/api/src/moderation/release.ts:360),
  which already leave out a release whose notice is held, with the time the Notices list shows and keys `'r:'` and
  `'u:'`;
- a lost image: the rows of the new told-only function `lost_told_for` (6.5), one per image whose lost files' notice
  was due and has been handled by 3d's dispatch (its `lost_told` neither `pending` nor `none`), with `at` the loss's
  time and key `'l:' || media id`.

None of these reads the ledger, the cases or the quarantine directly; each answers no earlier than the author may be
told, because each is the read the author's own Cases screen already uses. The activity flow merges the two sources:
it asks each for `limit + 1` rows before the cursor, sorts the union by (`at`, `key`) descending, keeps `limit` and
makes the cursor from the last. The keys' prefixes keep every key distinct across sources.

#### 5.5.3 What an entry shows

Each entry carries `at`, `key` and `new` (5.7). A `reply`, `quote` or `mention` carries the post's `PostView`, drawn as
a static PostCard (the actor's line, the text with its links, the images), which opens the post. A follow group carries
its count and up to three `Author`s with their avatars. A moderation entry carries its kind, its target and the id its
screen needs, and opens that screen under Settings, Cases (or, for a lost image, the post). Words are section 10.10's:
a decision's line is new there, and a release's, a refused upload's and a lost image's are 3d's words unchanged.

### 5.6 After the fact

| Event | What happens to entries | Where |
|---|---|---|
| The entry's post is withheld, removed or disabled | hidden at read; shown again if restored | 5.5.1's `state = 'visible'` |
| The entry's post is deleted by its author | its rows deleted | `deletePost`'s transaction |
| The entry's post is erased | hidden at read (an erased post is not visible) | 5.5.1 |
| A block, either way | the pair's rows deleted both ways | `block`'s transaction, beside `retractEngagement` |
| A mute | hidden at read while it stands; no new rows | 5.2, 5.5.1 |
| An unfollow | the follow row hidden at read while the follow is gone | 5.5.1 |
| The actor is suspended or terminated | kept, with no label (decision 10) | nothing |
| The actor's or the recipient's account is deleted | hidden at read while deleted | 5.5.1 |
| The actor's or the recipient's account is purged | every row it caused or received deleted, with its `activity_state` | `purgeProfile`'s transaction |
| 90 days pass | deleted | the job `activity-retention` (5.10) |

A block's deletion and a mute's filter reveal nothing to the other account: neither reads the other's Activity.

A mention's entry written by a post in flight while the recipient and the author block each other (a mention takes no
pair lock, 4.2) commits after the block's deletion; it is hidden at read while the block stands and shown again after an
unblock. This is accepted: pair-locking up to 20 mentioned accounts per post would cost 20 advisory locks. A purge
leaves no such row (4.2's lock).

### 5.7 The seen marker and what is new

`activity_state.seen_at` is null until the account first opens Activity. Every page of `GET /api/activity` answers
`seenAt`, the stored value at the time of the request, and marks each entry `new` when its `at` is later. The app keeps
the first page's `seenAt` for the visit, draws the headings "New since you last looked" above the first new entry and
"Earlier" above the first entry that is not new (10.2), and then sends `POST /api/activity/seen` with the first page's
newest `at`. The server stores `greatest(seen_at, least($at, now()))`: the marker only moves forward and never past the
server's clock, and a marker older than what another device sent is ignored. A visit that shows nothing new sends
nothing.

No route answers a count of unread entries for the nav, the title or any other screen (decision 4).

### 5.8 While the Activity screen is open

The screen asks `GET /api/activity/newer?since=<the newest at it shows>` 30 seconds after it opened and then every 60
seconds, only while it is on screen and the page is visible, as the feed's pill does (UI design, decision 7). The
answer is the number of entries newer than `since` under the same rules as the list, capped at 21; the pill reads
"1 new", "{n} new" or "20+ new", and pressing it loads the first page again at the top and moves the marker. Pull to
refresh does the same. Nothing is asked while the screen is closed, so no other route gains a request.

### 5.9 Fan-out and limits

One post writes at most 12 entries (a reply, a quote and 10 mentions), one follow one entry, so the existing write
limits bound what one account can cause: at most 30 posts and 60 replies an hour for an established account
(apps/api/src/social/tiers.ts), 50 follows an hour and 400 a day. A person under a pile-on has their settings ("Accounts
older than 2 days", which leaves out accounts made for the pile-on and keeps a new reader's honest reply once its
account is two days old, "Accounts you follow" or Off, for replies, mentions and quotes), mutes and blocks; follows
arrive grouped. No program decides who is a brigade: 3d's coordinated-reporting flag stays staff-side.

The new write routes have limits of their own, declared next to the route as every write's (section 9.5).

### 5.10 Retention and the purge

The job `activity-retention` (apps/api/src/activity/retention.ts), created with `createJob` (apps/api/src/lib/jobs.ts)
under a Valkey lock, runs every hour and deletes `activity_items` rows written more than `ACTIVITY_KEEP_DAYS` (90) days
ago, in batches of 5,000 by id until none is left, logging only the count. The constant lives in
packages/contracts/src/activity.ts, so the terms' sentence and the README print it from there. `activity_state` and
`post_mentions` have no retention of their own: they live as long as the account and its posts. The purge deletes all
three for the account (4.4, 5.6).

## 6. The database

Five migrations, numbered by the dry run with the next free numbers after 3b's last (3b ends at 0048_import_staff_end.sql), each a
drizzle-generated part for what the schema files declare, followed by hand-written SQL for triggers, functions, grants
and checks, as 0016 to 0048 are written: every function owned by the migrator, `SET search_path = public, pg_temp`,
every object schema-qualified, EXECUTE taken from PUBLIC, errors raised with their code as the message under SQLSTATE
P0001 (or 42501 for a forbidden column), enum values compared as text. No existing migration is edited. The schema
gains packages/db/src/schema/activity.ts and changes content.ts, identity.ts and moderation.ts.

### 6.1 `activity_items`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid primary key default `gen_random_uuid()` | never shown as a count; the cursor's tie-breaker |
| `recipient_id` | uuid not null, references `profiles` | |
| `kind` | `activity_kind` (`reply`, `mention`, `quote`, `follow`) | |
| `actor_id` | uuid not null, references `profiles` | |
| `post_id` | uuid, references `posts` on delete cascade | the reply, the quoting post or the mentioning post; null for a follow |
| `created_at` | timestamptz not null | forced to `now()` at insert |

Checks: `activity_items_post` (`(kind = 'follow') = (post_id is null)`); `activity_items_not_self`
(`recipient_id <> actor_id`).

Indexes: `activity_items_recipient_idx` on (`recipient_id`, `created_at`, `id`), the list and the count; unique
`activity_items_post_once` on (`recipient_id`, `post_id`) where `post_id` is not null, one entry per recipient and post;
unique `activity_items_follow_once` on (`recipient_id`, `actor_id`) where `kind = 'follow'`; `activity_items_post_idx`
on (`post_id`) where `post_id` is not null, for `deletePost`; `activity_items_actor_idx` on (`actor_id`), for `block`
and the purge; `activity_items_created_brin` (BRIN on `created_at`), for the retention job.

`activity_items_insert`, before insert, plain, skipped for the migrator: forces `created_at` to `now()`. There is no
UPDATE grant: a row is written once and deleted.

### 6.2 `activity_state`

| Column | Type | Rule |
|---|---|---|
| `account_id` | uuid primary key, references `profiles` | |
| `seen_at` | timestamptz | null until the first visit; only moves forward |
| `replies`, `mentions`, `quotes` | `activity_reach` (`everyone`, `older`, `following`, `off`) not null default `everyone` | |
| `follows` | boolean not null default true | |

There is no `updated_at`: it would keep the account's last visit to Activity, which nothing reads (1.5).
`activity_state_guard`, before insert or update, plain, skipped for the migrator: refuses a `seen_at` that is earlier
than the old one, set back to null, or later than `now()` (`activity_seen`, 42501); `account_id` never changes. The API
writes the row with `insert ... on conflict (account_id) do update`, so an account without a row reads the defaults.

### 6.3 `post_mentions`

| Column | Type | Rule |
|---|---|---|
| `post_id` | uuid not null, references `posts` on delete cascade | |
| `account_id` | uuid not null, references `profiles` | |
| `handle` | text not null | the handle as written, lowercased; CHECK `^[a-z0-9_]{3,20}$` |
| `position` | smallint not null | CHECK between 0 and 19 (`MENTION_STORE_MAX` - 1) |

Primary key (`post_id`, `account_id`); unique `post_mentions_position` on (`post_id`, `position`); index
`post_mentions_account_idx` on (`account_id`) for the purge. `post_mentions_insert`, before insert, plain, skipped for
the migrator: refuses a row whose post is not in state `visible` or has `import_job_id` set (`mention_column`, 42501);
it reads no block, since a mention is stored whatever blocks exist (decision 12). Only `createPost` writes the table,
which the architecture test holds (section 12.2), so a mention is added only with its post.

`post_mentions_erase`, after update of `erased_at` on `posts`, security definer: deletes the post's mention rows when
`erased_at` becomes set (4.4). No UPDATE grant: a mention is written once and deleted.

### 6.4 Images, profiles and posts

New enum `media_kind` (`post`, `avatar`). New columns:

| Table | Column | Type | Rule |
|---|---|---|---|
| `post_media` | `kind` | `media_kind` not null default `post` | set at insert from the upload's `kind`; never changes |
| `post_media` | `profile_id` | uuid, references `profiles` | set while the image is that profile's avatar |
| `post_media` | `avatar_sha256` | text | the uploaded file's SHA-256, set at insert for an avatar (CHECK: null for a post's image, `^[0-9a-f]{64}$` for an avatar; 7.2, 7.7) |
| `profiles` | `share_previews` | boolean not null default false | decision 21: off until the person turns it on |
| `posts` | `hide_counts` | boolean not null default false | decision 26 |

`profiles.avatar_path` is dropped (decision 18), and with it its column grant.

Checks on `post_media`: `post_media_kind_place`, `(kind = 'post' and profile_id is null) or (kind = 'avatar' and
post_id is null and position is null and alt_text is null)`, so an avatar is never attached to a post and a post's image
is never an avatar; `post_media_avatar_owner`, `profile_id is null or profile_id = owner_id`. Unique index
`post_media_avatar_idx` on (`profile_id`) where `profile_id` is not null: one avatar per profile. Index
`post_media_owner_avatar_idx` on (`owner_id`) where `kind = 'avatar'`, for the seal's list and the purge.

`post_media_avatar_guard`, before update of `profile_id`, plain, skipped for the migrator: `profile_id` moves only from
null to the row's `owner_id` or from a value to null; it is set only on a row of kind `avatar` that is `ready`,
`visible` and not erased, whose owner's profile is not deleted; a refusal raises `avatar_column` under 42501. The API's
statement that sets an avatar applies 3e's predicate (section 7.3); the trigger does not.

`post_media_insert` (0015) is replaced from its text with one more refusal: a row inserted with a non-null `profile_id`
is refused (`moderation_column`, 42501), as one with a `post_id` is. INSERT is a table privilege of the API's role
(packages/db/migrations/0001_grants.sql:16) and the guard above fires only on UPDATE, so an inserted row could otherwise
be an avatar before any check had seen it.

`post_media_refused` (0039) is replaced from its text to fire `BEFORE UPDATE OF post_id, profile_id`, with the same
refusal for either column going from null to a value: `upload_refused` while an `upload_refusals` row names the image,
while it is erased, or while its `hold_until` is infinity, read in a statement of its own after the row's lock, as for a
post's image; the API answers it `avatar_not_ready` (7.3 step 2).

`post_media_keep` (0015) is replaced from its text so that a row on no post is also retained while it is of kind
`avatar` and its owner has an account case frozen by a suspect report (`frozen_for`'s second arm, read in a statement
of its own). Its seal arm is added in the migration `avatar_moderation` (6.5). Its owner's removal, a replacement
(7.3 step 6), the sweeper and the purge then skip such a row, as they skip a held one.

`post_media_purge` (0035) is replaced with the same body and two changes: a row counts as served when it was on a post
or was an avatar (`OLD.post_id is not null or OLD.profile_id is not null`), and a row whose `profile_id` goes from a
value to null writes cause `state`; the trigger fires on `moderation_state`, `erased_at` and `profile_id`, and on
delete. A released avatar's erasure writes `released` when the release lists it (`releases.avatar_ids`, 6.5), a cause
added when `avatar_moderation` replaces the function again (6.8).

### 6.5 Moderation of avatars

- `action_kind` gains `reset_avatar` and `restore_avatar`, in the migration `avatar_kinds`. Keeping it apart is
  harmless, but it is not what makes the values usable: drizzle's migrator runs every pending migration in one
  transaction (packages/db/test/enum-literals.test.ts, its header), so on an upgrade `avatar_kinds`, `avatar_moderation`
  and 3b's migrations share it, and a value added there cannot be used as an enum literal before that transaction
  commits (55P04) in anything parsed when it is created or run. 2d follows 3e's rule, as 3e, 3f and 3d did: the two
  values appear as literals only inside PL/pgSQL bodies (`decision_actions_check`, `decision_actions_apply`,
  `redact_r4_body`, `decision_holds`, `seal_release`, `release_replay`), and everywhere else (checks, SQL-language
  functions, views, index predicates, DO blocks) a kind is compared as text (`kind::text = 'reset_avatar'`), as the
  view `measures_in_force` and the SQL functions `item_current_outcome` and `case_evidence_due_at` must.
  enum-literals.test.ts gains a describe block for 2d's migrations from `avatar_kinds` on (Task 4).
- `decision_actions_check` is replaced with the latest body (3b's, from its migration `imported_posts`) and the avatar
  kinds added where the field kinds are: `reset_avatar` on an account case only, in an `interim` or a `final`
  decision; `restore_avatar` in the same places as `restore_display_name`; `no_effect` `already` when the account has
  no avatar, `deleted` when its profile is deleted.
- `decision_actions_apply` is replaced with the latest body and three changes. A `reset_avatar` whose `no_effect` is
  null refuses with `profile_changed` unless the profile's current avatar is the one the decision's snapshot holds
  (compare-and-set, as for a display name), then sets that row's `profile_id` to null and writes its `avatar_resets`
  row (below); the row stays while a hold keeps it and is deleted afterwards by the sweeper. A `restore_avatar` does
  nothing. A `seal_media` on an account case also locks, after the posts' images and in id order, every row of kind
  `avatar` the account owns (the current one and any former one a hold keeps), lists them in `seal_avatars`, and raises
  `invalid_decision` only when both its lists are empty; an `unseal_media` applies again to the lifted seal's avatars.
- `seal_avatars` (`action_id` uuid references `decision_actions` on delete restrict, `media_id` uuid not null, primary
  key both; no foreign key to the image, which may go): the avatars a seal listed, as `seal_posts` lists its posts. The
  API's role may read it; only the definer functions write it.
- `post_media_keep` is replaced again, from its text in `avatars` (6.4): a row on no post is also retained while
  `seal_avatars` lists it under a measure in force (`measures_in_force`) and no release that lists it in `avatar_ids`
  has a notice other than `held`, mirroring `frozen_for`'s seal arm. A sealed avatar that no hold keeps (one set after
  the report, so in no snapshot) is then never deleted by its owner, a replacement, the sweeper or the purge while 3d's
  quarantine lists it: the seal's evidence is never destroyed by the person it is about.
- `avatar_apply(media uuid[])`, security definer: locks the rows in id order `FOR NO KEY UPDATE` and sets each one's
  `moderation_state` to `sealed` while a seal in force lists it, else `withheld` while `avatar_reviews` lists it under
  an item not yet answered, else `visible`. `moderation_apply` is unchanged: it works by post, and an avatar has none.
- `avatar_reviews` (`media_id` uuid primary key, `item_id` uuid not null references `intake_items`): R1's hold for
  review (7.6), written only by the definer function `avatar_review(p_media uuid, p_item uuid)`, which the program's
  step calls while `AUTOMATION_R1_ACTS` is on, after its finding's item, and which then calls `avatar_apply`. The
  deciding transaction that answers an item calls `avatar_apply` for the avatars `avatar_reviews` names under it, so the
  avatar is `visible` again or, under a `reset_avatar`, detached. The API's role may read it.
- `avatar_resets` (`action_id` uuid primary key references `decision_actions` on delete restrict, `account_id` uuid not
  null, `sha256` text not null CHECK `^[0-9a-f]{64}$`, `until` timestamptz not null): written by
  `decision_actions_apply` when a `reset_avatar` applies, with the reset row's `avatar_sha256` and `until` 30 days after
  the decision, so the hash outlives the image row; `setAvatar` reads it (7.3 step 2, 7.7). Never read after `until`;
  erased with its case's evidence (3c's retention). The API's role may read it; only the definer function writes it.
- `releases` gains `avatar_ids uuid[] not null default '{}'`: `seal_release` and `release_replay` (3d) are replaced with
  their latest bodies and write the released seal's avatars there beside `post_ids`, and erase those rows as they erase
  a post's images; `quarantine_files` rows for an avatar carry `post_id` null, as for an upload on no post, and their
  `lost_told` is forced to `none` by the existing rule (no post).
- **Every list of the measures.** The field resets are also listed by hand outside the two functions above; a grep for
  `reset_display_name` at 0bc2dcc finds each, and the task that adds the measure (Task 4) changes them all:
  - in the database, each replaced in `avatar_moderation` from its newest text with `reset_avatar` added (and
    `restore_avatar` where reversals are listed), by 6.5's rule above: the view `measures_in_force`
    (0028_orders_ledger.sql:24); `item_current_outcome` (0021_standing_ledger.sql:306, an intake item's outcome);
    `case_evidence_due_at` (0018_retention.sql:57, a case's retention); `redact_r4_body` (0019_redaction_scope.sql:57
    and :94, so an avatar reset's held snapshot is erased under R4 with a display name's); `decision_holds`
    (0039_known_material.sql:922-924, the signed form's count of measures `IN` and `NOT IN`, so `reset_avatar` is
    signed as a measure);
  - in the API: `ROUTE_KINDS` (apps/api/src/moderation/decide.ts:42-50), built from `MEASURE_KINDS.slice(0, 7)` and
    `REVERSAL_KINDS.slice(0, 5)`, gains both kinds by name, never by moving a slice's edge;
    `MEASURE_KINDS_SQL` (apps/api/src/moderation/repo.ts:267, read by `answerChangedNothing`, which feeds 3e's reporter
    restriction); `REDACTABLE` (repo.ts:2224, R4's redaction candidates); the interim measures of the statement
    (apps/api/src/moderation/statement-repo.ts:282); `MEASURES` (apps/api/src/moderation/author-repo.ts:26); the reset
    facts of a statement (apps/api/src/moderation/statement.ts:26 and packages/rules/src/statement.ts:39-45, which know
    the targets `display_name` and `bio`);
  - in the contracts and the schema: `ACTION_KINDS`, `MEASURES` (with `MeasureTarget` gaining `"avatar"`),
    `MEASURE_KINDS` and `REVERSAL_KINDS` (packages/contracts/src/moderation.ts), and `actionKind`
    (packages/db/src/schema/moderation.ts:37);
  - in the app: the kind's switch of apps/app/src/components/moderation/StatusSheet.tsx:105, each measure's sentence in
    apps/app/src/lib/terms.ts:94, and `DECISION_WORDS` (apps/app/src/lib/moderation-words.ts:234), which gains
    `avatar` beside `displayName` and `bio`;
  - in the console: apps/admin/src/compose.ts (an account case's targets at :220, the `no_effect` prediction at
    :301-302, `ONE_BY_ONE` at :324, the reversal at :382, the reset facts at :1224) and
    apps/admin/src/screens/Case.tsx:895.
  A test of its own, apps/api/test/measure-lists.test.ts (Task 4), reads apps/api/src, apps/app/src, apps/admin/src,
  packages/rules/src and the newest body of every migration function and view that names `reset_display_name`, and
  expects `reset_avatar` wherever `reset_display_name` appears, as 3e's enum test reads its files.
- `lost_told_for(p_owner uuid, p_before timestamptz, p_limit integer)`, security definer, EXECUTE to the API's role
  only: one row per image of `p_owner` (by `post_media.owner_id`) on a post its author has not deleted, with the
  image's id, the post's id and creation time, and the earliest `lost_at` of its files whose `lost_told` is neither
  `pending` nor `none`, before `p_before`, newest first, at most `p_limit` (at most 100). It answers ids and times only,
  as 3d's six functions do.

### 6.6 Row-level security and grants

| Table | RLS | API role |
|---|---|---|
| `activity_items` | enabled, one policy for the API role (`activity_items_api_all`) | SELECT, INSERT, DELETE; no UPDATE |
| `activity_state` | enabled, one policy for the API role | SELECT, INSERT, UPDATE of `seen_at`, `replies`, `mentions`, `quotes`, `follows`, DELETE |
| `post_mentions` | enabled, one policy for the API role | SELECT, INSERT, DELETE; no UPDATE |
| `seal_avatars` | enabled, one policy for the API role | SELECT only |
| `avatar_reviews` | enabled, one policy for the API role | SELECT only |
| `avatar_resets` | enabled, one policy for the API role | SELECT only |
| `post_media` | unchanged | INSERT of `kind` and `avatar_sha256` (INSERT is a table privilege); UPDATE of `profile_id` under `post_media_avatar_guard`; no UPDATE of `kind` or `avatar_sha256` |
| `profiles` | unchanged | UPDATE of `share_previews` |
| `posts` | unchanged | UPDATE of `hide_counts` |

New tables receive SELECT, INSERT, UPDATE and DELETE through the default privileges
(packages/db/migrations/0001_grants.sql:16), so every "no UPDATE" and "SELECT only" above is an explicit REVOKE, as 0015
writes for `seal_posts` (0015_greedy_zuras.sql:410): UPDATE revoked on `activity_items` and `post_mentions`; INSERT,
UPDATE and DELETE revoked on `seal_avatars`, `avatar_reviews` and `avatar_resets`; UPDATE revoked on `activity_state`
and granted again on its five columns. `korbat_auth` and `korbat_notify` get nothing on any of them. The owner-scoped
policies stay sub-project 4's, as for every table (main design, 2026-09-23).

### 6.7 Retention and what the purge erases

| What | Kept | Erased by |
|---|---|---|
| An `activity_items` row | 90 days, or until its post is deleted, a block between the pair, or a purge | `activity-retention`; `deletePost`; `block`; `purgeProfile` |
| The `activity_state` row | as long as the account | `purgeProfile` |
| A `post_mentions` row | as long as its post is not deleted or erased | `deletePost`; `post_mentions_erase`; `purgeProfile` |
| An avatar's row and files | while it is the avatar; a replaced or reset one until no hold, seal or frozen case keeps it | the set and remove flows; the sweeper; the purge's media deletion |
| A `seal_avatars` row | as long as its decision's ledger | never deleted, as `seal_posts` |
| An `avatar_reviews` row | while its item waits, then as long as its case's evidence | 3c's retention of a case's evidence |
| An `avatar_resets` row | read for 30 days, then kept as long as its case's evidence | 3c's retention of a case's evidence |

### 6.8 The migrations

In the order the tasks create them (section 13), each with the next free number after 3b's last:

- **`activity`** (Task 1). The enums `activity_kind` and `activity_reach`; the tables `activity_items`, `activity_state`
  and `post_mentions` with their checks and indexes; RLS, policies, grants and the REVOKEs of 6.6; the triggers
  `activity_items_insert`, `activity_state_guard`, `post_mentions_insert` and `post_mentions_erase`; the function
  `lost_told_for`.
- **`post_options`** (Task 1). `profiles.share_previews` and `posts.hide_counts` with their grants.
- **`avatars`** (Task 3). The enum `media_kind`; `post_media.kind`, `post_media.profile_id` and
  `post_media.avatar_sha256` with their checks and indexes; `post_media_avatar_guard`; `post_media_insert`,
  `post_media_refused`, `post_media_keep` (its frozen-account arm) and `post_media_purge` (the served test and the
  `state` cause) replaced; `profiles.avatar_path` dropped; the grants of 6.6 for these.
- **`avatar_kinds`** (Task 4). `ALTER TYPE action_kind ADD VALUE 'reset_avatar'` and `'restore_avatar'`.
- **`avatar_moderation`** (Task 4). `seal_avatars`, `avatar_reviews` and `avatar_resets` with RLS, policies and the
  REVOKEs of 6.6; `avatar_apply` and `avatar_review`; `releases.avatar_ids`; `post_media_keep` (its seal arm) and
  `post_media_purge` (the `released` cause of an avatar) replaced again; `decision_actions_check`,
  `decision_actions_apply`, `seal_release` and `release_replay` replaced; the measure lists of 6.5 replaced
  (`measures_in_force`, `item_current_outcome`, `case_evidence_due_at`, `redact_r4_body`, `decision_holds`); every
  body under 6.5's enum-literal rule.

Each migration's drizzle snapshot is regenerated in packages/db/migrations/meta. A database test holds every CHECK's
constant equal to its contracts constant (`MENTION_STORE_MAX`, the two enums' values), as earlier sub-projects' do.

## 7. Avatars

### 7.1 What an avatar is

An avatar is a `post_media` row of kind `avatar` (6.4) whose two files are squares: `large.webp`, 400 by 400 pixels, and
`small.webp`, 128 by 128, each smaller only when the source's shorter side is (images are never enlarged). The names,
the store's layout, `MEDIA_SIZES`, `mediaPath`, the quarantine's file check and the export's file entry are 2b's and
3d's as they are; only the pixels differ. A profile has an avatar while one row's `profile_id` names it. Without one,
the generated monogram of the UI design's section 6.5 is drawn, as today.

The sizes cover every place an avatar is drawn: 40 px in posts and lists and 32 px in the composer use `small.webp` up
to three device pixels per CSS pixel, and the 64 and 96 px of the profile header and the 144 to 400 px a card needs use
`large.webp`. A list of 20 authors costs about 20 files of 3 to 5 KB each.

### 7.2 Uploading

The picker (section 10.5) sends the file to the existing `POST /api/media` with the query `kind=avatar` and
`crop=start`, `centre` or `end` (`UploadQuery`, packages/contracts/src/media.ts); without `kind` the upload is a post's
image, as today, and `crop` is refused on one. The flow (apps/api/src/media/flows/upload.ts) is unchanged up to the
row: the declared type, the first bytes, the 20 MiB cap, the account's upload limit, the pending count, the free-space
floor and, while the matcher is on, the three hashes taken while it streams (apps/api/src/media/files.ts:133); for
`kind=avatar` the SHA-256 is taken always, one hash of at most 20 MiB, and kept as `avatar_sha256` (6.4, 7.7). Then:

- `insertProcessing` writes the row with `kind = 'avatar'` and its `avatar_sha256` (its statement already takes the
  owner's row with 3e's predicate and the closing judgment, so a suspended account cannot upload an avatar either);
- `files.commit(id, { avatar: crop })` writes the job file `incoming/<id>.avatar` (one line of JSON,
  `{"v":1,"crop":"centre"}`, through tmp and a rename) before it renames the upload into `incoming/<id>`, so the worker
  never sees the upload without its job file. `uploadsLayout` (packages/media-protocol/src/layout.ts) gains
  `avatarJob(id)`; the job file's name fails `isMediaId`, so the worker's scan of `incoming/` skips it as a file of its
  own, and every removal of an upload removes it too. A crash between the job file's write and the rename leaves
  `<id>.avatar` alone, which `storedUploads` (apps/api/src/media/files.ts:304-311) and the worker's scan skip: so
  `storedUploads` also lists `<id>.avatar` files, and the reconcile pass removes one older than `ORPHAN_AGE_MS` whose
  id has no upload and no row; one unit test holds it.

The media module's queries of uploads on no post (apps/api/src/media/repo.ts) keep avatars out, since an avatar is never
an unposted upload: `pendingCount` (the pending count against `MAX_PENDING_UPLOADS`), `deleteUnattached`
(`DELETE /api/media/:id`, the composer's removal of an upload) and `attach` (a post's images) gain `kind = 'post'`, and
`deleteUnattachedBefore` (the sweeper) gains `profile_id is null`. So the current avatar and a held former one use no
pending slot, `DELETE /api/media/:id` on an avatar answers `not_found` (only 7.3's routes remove one, under their rules
and `avatarSet`), and an avatar's id sent as a post's image gets the error a missing upload gets, never the 500 that
`post_media_kind_place` (23514) would raise.

An avatar upload is an upload on no post: the sweeper deletes it after a day unless it was set (7.3).

### 7.3 Setting and removing

`PUT /api/me/avatar` with `{ mediaId }` (apps/api/src/social/routes.ts, beside `PATCH /me/profile`; the flow in
social/flows/profile-edit.ts) runs one transaction, `setAvatar` in apps/api/src/social/repo.ts beside `updateProfile`;
the image rows are written by the media module's `attachAvatar(tx, accountId, mediaId)` and `detachAvatar(tx,
accountId)` (apps/api/src/media/repo.ts) called inside it, as `createPost` calls `media.attach`, so only the media
module names `post_media`:

1. the profile row through `lockActing(tx, accountId, "no key update")`, the helper `createPost` uses, which applies
   3e's predicate (`account_suspended`, or `not_found` for a deleted profile) without naming `liveNotSuspended` again
   (12.2);
2. the upload's row `for no key update`, which must be the account's own, of kind `avatar`, `ready`, `visible` and not
   erased (`not_found` for another account's or a missing row, `avatar_not_ready` while it is processing or failed or
   when `post_media_refused` answers `upload_refused`, 6.4; `not_an_avatar` for a post's image), and whose content hash
   is not a picture a moderator reset on this account in the last 30 days (`avatar_reset`, 7.7);
3. the current avatar, if any, detached (`profile_id` to null), which writes its outbox row (6.4);
4. the new row's `profile_id` set to the account;
5. the closing judgment (`judgeActing`);
6. after the commit, the media module's deletion of the old row and its files, which skips a row that a hold, a seal or
   a frozen case keeps (`post_media_keep`, 6.4 and 6.5; the sweeper deletes it once nothing keeps it), and
   `moderation.avatarSet(accountId, mediaId)` (7.6).

`DELETE /api/me/avatar` (`removeAvatar`) takes the profile row `for no key update` with no predicate (a deleted profile
answers `not_found`) and runs steps 3 and 6 without a new row, so a suspended account may remove its picture (decision
17). Both answer the account's `AvatarView` (or null). `PUT` is refused for a suspended account by step 1. The new
avatar is public once the transaction commits; there is no cover, because an avatar has no description and is drawn
beside every post, except that an avatar the R1 check flags while `AUTOMATION_R1_ACTS` is on is shown to its owner only
until a person decides (7.6).

### 7.4 The worker

`processImage` (apps/worker/src/pipeline.ts) takes the job file's crop when `incoming/<id>.avatar` exists, read and
parsed strictly (a missing or malformed job file makes the upload `processing_failed`). For an avatar:

1. the same sniffing, pixel caps, format checks and `autoOrient` as any upload;
2. the square: with `w` and `h` the oriented size and `s = min(w, h)`, an `extract` of `s` by `s` at offset 0 (`start`),
   `(max - s) / 2` rounded down (`centre`) or `max - s` (`end`) along the longer side, then a resize to at most 400 and
   to at most 128 (`fit: "inside"`, `withoutEnlargement: true`);
3. `large.webp` from the 400 square at quality 82 and `small.webp` from the 128 square at quality 80
   (`AVATAR_VARIANTS` in packages/media-protocol/src/limits.ts);
4. the blurhash from the 128 square's pixels, and, with a scorer, the R1 score from the 400 square's pixels, as a
   post's image gives it its small size's; the PDQ hash as for any upload.

The result file gains version 3 (packages/media-protocol/src/result.ts): version 2's members and `avatar: true` on a
ready result of an avatar job; the API reads versions 1 to 3 and refuses an avatar row whose ready result lacks the
mark, and a post's row whose result has it. The worker writes version 3. The uncropped image is never written.

### 7.5 Serving and its gates

`fileAccess` (apps/api/src/media/repo.ts:287) also reads `kind`, `profile_id` and, through `profile_id`, the profile's
`deleted_at`. `serve` (apps/api/src/media/flows/serve.ts) gains a branch before the post's: a row of kind `avatar` is
served exactly when it is `ready`, its `profile_id` is set, its profile is not deleted, its `moderation_state` is
`visible` and it is not erased; then with `PUBLIC_CACHE`, as a visible post's image. A set avatar that 7.6's review
withholds (`withheld`) is served to its owner only, with `PRIVATE_CACHE`, as an author's own hidden image is. Every
other avatar row is `not_found` for everyone, its owner included: a replaced, reset, held, sealed or deleted account's
picture is shown to nobody. Only the withheld branch asks for the viewer, so a visible avatar costs one query. The
`ETag` and the 304 are unchanged.

Every reader of `post_media` is enumerated once, as 3c's section 11 requires: the serve route, the staff reader of a
case's images (7.7), the export, `avatarsOf` (`Author.avatar`, `ProfileView.avatar`, the card, `/api/me`), and 3d's
custody commands. Each gains its avatar test with a sealed avatar, which nobody, its owner and staff included, is
served (section 12.3).

The views read avatars only through the media module's interface, never by a join on `post_media` outside media/
(apps/api/test/architecture.test.ts:117-118 refuses any file outside media/ whose source names `post_media` or
`postMedia`, comments included; social's views already read images through `media.forPosts`). The media module's index
gains `avatarsOf(profileIds, viewer): Promise<Map<string, AvatarView>>`, one statement on `post_media_avatar_idx` with
the serve branch's conditions (`profile_id` set, `status = 'ready'`, `moderation_state = 'visible'`, `erased_at is
null`), and the viewer's own avatar while 7.6's review withholds it. `loadPostViews`, the profile views, the card
builder (8.1, with no viewer), the activity flow's follow groups and `/api/me` call it once after their own query: one
more indexed query per page, not per author. `Author`, `ProfileListItem`, `ProfileView` and
the account's own `/api/me` answer gain `avatar: AvatarView | null`, `{ small, large }` as `mediaPath` makes them.

### 7.6 The checks of 3d

- **The matcher.** An avatar upload is an upload: an acting match refuses and holds it, with 3d's notice and objection,
  before it can be set; `PUT /api/me/avatar` on it answers `avatar_not_ready` (its row is never ready for its owner).
  A match that only flags lets the upload through, and `avatarSet` opens the finding (below).
- **The R1 score.** Taken by the worker from the 400 square (7.4) and kept by the media module as for any upload.
- **`moderation.avatarSet(accountId, mediaId)`** (apps/api/src/moderation/automated.ts, beside `imagesPublished`): on
  the module's background, it reads the avatar's score and match record through `media.signals`, which gains an avatar
  form; a score at or over the threshold, or a flag of the matcher, becomes its signal (`scoreSignal`, `matchSignal`)
  and its step. `automatedStep` gains the account branch: for a signal on an avatar it opens the program's finding on
  the account's case with the avatar in its scope (3d's finding of 7.9 step 2, its words with "this profile picture"
  for "this image") and takes no measure, whatever `AUTOMATION_R1_ACTS` says: no program takes a measure on an account
  (decision 15). Its sweep finds a failed step as it finds a post's.
- **R1's hold for review.** While `AUTOMATION_R1_ACTS` is on, an R1 score at or over the threshold also keeps the avatar
  from everyone but its owner until a person decides, as an image in a post is withheld: after the finding, the step
  calls `avatar_review` (6.5), and `avatar_apply` makes the row `withheld`. `serve` then answers it to its owner only
  (7.5), and `avatarsOf`, other readers' views and the card see no avatar (the monogram is drawn, the card has no
  image). The decision that answers the finding ends it: a `reset_avatar` removes the picture, any other answer shows it
  again. With `AUTOMATION_R1_ACTS` off nothing changes. Neither is a measure, and the owner, who still sees the picture,
  learns nothing about how to pass the check (decision 15).
- **The edge.** The outbox row of 6.4 is written when an avatar stops being public (replaced, removed, reset, sealed,
  withheld for review, or deleted with its account) and drained by 3d's `edge-purge` job like any other.

### 7.7 Moderation of an avatar

- **Reports.** A report or notice about an account takes its snapshot as 3c's section 7.1 step 4 has it, and now also
  the current avatar: the snapshot's `media` member, empty for an account until now, holds `[{ id, alt: null, width,
  height }]`, which `snapshotDigest` (packages/contracts/src/moderation.ts) already covers, and the case holds the row
  in `media_holds` as it holds a reported post's images (`MediaForCases.hold`, apps/api/src/media/cases.ts, gains the
  avatar). The console's case page shows the snapshot's avatar beside the display name and bio through the staff
  reader of a case's images, under the same freeze: a case frozen by a report of child sexual abuse material shows
  the placeholder, never the image.
- **`reset_avatar`.** On an account case, interim or final, as `reset_display_name` (6.5). The console's composer
  (apps/admin) offers the measure's label, "Reset profile picture", where it offers "Reset display name". Its
  statement's measure sentence (packages/rules, beside the field resets' words) says: "korbat removed this profile
  picture once and shows the letter of your display name in its place. You may set a new picture; what you set is
  judged on its own if someone reports it, and korbat does not put the old picture back when this measure ends or is
  lifted. The same picture cannot be set as your profile picture again for 30 days." For those 30 days `setAvatar`
  refuses an upload whose SHA-256 equals the reset picture's (`avatar_resets`, 6.5) with `avatar_reset` and the words
  `AVATAR_WORDS.resetRecently` (10.10), which say why; a near copy stays a moderator's call. The author's decision
  screen shows the snapshot's picture under `DECISION_WORDS.avatar`, "Profile picture", beside `displayName` and `bio`
  (apps/app/src/lib/moderation-words.ts). The measure's spec in `MEASURES` (packages/contracts/src/moderation.ts) copies
  `reset_display_name`'s with a new target, `"avatar"`, and that label; `MEASURE_KINDS` and `REVERSAL_KINDS` grow by
  one each, which the ledger's order tests follow, and every other list of the measures follows 6.5's enumeration.
- **`restore_avatar`.** Lifts a `reset_avatar` in a review or a correction; it writes nothing (6.5), and its sentence is
  `restore_display_name`'s with "picture".
- **The seal.** An account case's `seal_media` lists the account's avatars in `seal_avatars` (6.5), so a picture
  reported as child sexual abuse material is shown to nobody from the seal on, as the account's posts' images are.
  3d's `quarantine` service moves a sealed avatar's two files as it moves a held upload's (no post), `quarantine-list`
  (apps/api/src/cli/custody.ts) names them from `seal_avatars`, and a release erases them with the seal's posts' images
  through `releases.avatar_ids`. 3f's records of a report to an authority and of a hand-over list a sealed avatar by its
  image id, as they list a held upload.
- **3e.** A strike counts only for a final rule decision on a post (3e design, section 2), so `reset_avatar` gives none,
  as `reset_display_name` gives none.

### 7.8 Deletion, the purge and the export

- The purge's `within` already deletes every `post_media` row of the account that nothing keeps (`post_media_keep`);
  the avatar's is one of them, and its delete writes the outbox row. From the purge's transaction on, `serve` answers
  `not_found` for it, because its profile is deleted (decision 29).
- The export writes the avatar's `large.webp` as `media/<id>.webp` and adds `avatar: { id, file, width, height } | null`
  and `sharePreviews` to the `profile` member, after `retiredHandles` (section 11.2).
- A replaced or removed avatar is deleted at once unless a hold keeps it; the sweeper's rule becomes "on no post and no
  profile for a day" (`deleteUnattachedBefore`, apps/api/src/media/repo.ts:450, called by
  apps/api/src/media/sweeper.ts), so a held former avatar goes the day its hold ends, and a sealed one stays while
  `post_media_keep` keeps it (6.4, 6.5).

## 8. Share cards and titles

### 8.1 The routes

A new module, apps/api/src/cards/ (index.ts, build.ts, words.ts), mounts two routes beside `postStatusRoutes`, after
the global limit and before the session's resolution (apps/api/src/app.ts), so they read no cookie and answer the same
for everyone:

- `GET /api/cards/post/:id`: 404 with no body unless the post is shown to a signed-out reader (its `state` is `visible`,
  its author not deleted), exactly as `GET /api/posts/:id/status` answers 404 (apps/api/src/social/routes.ts:115-134);
  else 204 with the header `Korbat-Card`.
- `GET /api/cards/profile/:handle`: 404 unless a live profile holds the handle now, compared lowercased as
  `findProfileByHandle` compares it; else 204 with `Korbat-Card`. An old handle in `handle_history` answers 404, as its
  page shows "This account is not available".

Each builds its card from the same reads a signed-out `GET /api/posts/:id` and `GET /api/profiles/:handle` make, through
`postAccess` with no viewer, so moderation, deletion and 3f's `disabled` follow without a rule of the card's own. A
suspended account's visible post and profile get their card with no label (3e design, section 2). The status route
stays as it is, with its tests; Caddy stops asking it.

`Korbat-Card` is the card's head block (8.3) in UTF-8, base64-encoded, at most 6,000 bytes encoded (the block is held
to 4,096 bytes before encoding, which the builder asserts and a test proves at every length limit). Both routes answer
`Cache-Control: no-store`, as every API answer does.

### 8.2 Caddy

- **`card.html`.** infra/caddy/Dockerfile, after `expo export`, writes `/repo/apps/app/dist/card.html` from the export's
  `index.html` by inserting one line right after `<meta charset="utf-8" />`:
  `{{placeholder "http.reverse_proxy.header.Korbat-Card" | b64dec}}`, and fails the build unless the result holds that
  action exactly once and no other `{{`. The file is copied to `/srv` with the rest; it is never served by its own
  path (the default handle answers `/card.html` with 404).
- **`/post/*` and `/u/*`.** The existing `/post/*` handle asks `/api/cards/post/<id>` instead of the status route, and a
  new `/u/*` handle asks `/api/cards/profile/<handle>`, each with `method GET` and the rewrite of
  `{http.request.uri.path.1}`. The new handle's first line is `respond @push 403`, as in every app-site handle
  (infra/caddy/Caddyfile:36-39 and :84). Both page handles drop the request's `Range` (`request_header -Range`), so
  every page answer is a whole 200 or 404: a 206 from `file_server` would carry a `Content-Range` of the template's
  size, which the templates handler does not rewrite. On 204, `handle_response` rewrites to `/card.html`, runs
  `templates` and serves it with 200; on 404 it serves the plain shell with 404; on any other answer (a 429 of the
  global limit) the plain shell with 200; `handle_errors` serves the plain shell with 200 when the API cannot be asked,
  for `/u/*` as for `/post/*`. Every answer keeps `app_page_headers`, `Cache-Control "no-cache"` and gzip. `templates`
  is enabled in that one `handle_response` block and nowhere else, so no other response, and no proxied body, is ever
  evaluated.
- **Why it is safe.** The template is Caddy's own file from the build; the only action reads a placeholder and decodes
  it, and Go's templates never evaluate a value an action prints, so nothing the API or a user wrote is parsed as a
  template. The API escapes every value it puts in the block (8.5) and also writes `{` and `}` as character
  references, so the block holds no template delimiter even if it were parsed.
- **`robots.txt`.** infra/caddy/robots.txt, copied to `/srv/robots.txt` and served by the default handle (a real file
  wins over `try_files`' fallback), allows the pages that carry cards and their images only to the link-preview
  fetchers the design supports, named by their robots.txt tokens, the unfurlers of crawlers.json (12.1), and disallows
  every other agent (decision 20):

  ```
  User-agent: Twitterbot
  User-agent: facebookexternalhit
  User-agent: Slackbot-LinkExpanding
  User-agent: Discordbot
  User-agent: LinkedInBot
  Allow: /post/
  Allow: /u/
  Allow: /api/media/
  Disallow: /

  User-agent: *
  Disallow: /
  ```

  Twitterbot honours robots.txt and a blocked page gets no card (inputs 3.2); every other agent that honours it reads
  nothing. The README lists the named agents and why.
- **`X-Robots-Tag`.** Never set and then dropped: after `app_page_headers`' deferred `-Server`
  (infra/caddy/Caddyfile:26) a dropping block would run before the set, and the Caddyfile's model refuses a
  `header @m -Name` line. So `app_page_headers` does not carry it; the default handle declares `@named not path /
  /rules /transparency /explore/about /terms` and `header @named X-Robots-Tag "noindex"` (decision 20), a form the model
  reads (apps/app/test/browser/caddyfile.ts:74-77), and the `/post/*` and `/u/*` handles and `handle_errors` set it
  always. The API's security headers (apps/api/src/middleware/security-headers.ts) add it to every answer.
- **The check.** caddy:2.11.4 carries `http.handlers.templates` in its standard build; Task 6's first step proves it on
  the pinned image with `caddy list-modules`, and the card lab and the stack's smoke test of section 12.4 prove the
  placeholder, `b64dec` (one of the Sprig functions Caddy's templates include) and the statuses end to end. Should the
  pinned image lack either, the dry run records it in section 15 and the card routes answer the whole document instead
  (decision 19's first alternative), with the export copied into the API's image by a build stage both images share.

### 8.3 The head block

In this order, each a `<meta>` element on its own line, attributes in double quotes:

1. `name="robots" content="noindex"`;
2. `property="og:site_name" content="korbat"`;
3. `property="og:type"`: `article` for a post, `profile` for a profile, `website` for a generic card;
4. `property="og:url"`: `APP_ORIGIN` and `/post/<id>` or `/u/<handle as stored>`, the undecorated address;
5. `property="og:title"`;
6. `property="og:description"` and `name="description"` with the same text, when there is text;
7. when there is an image: `og:image` (the absolute URL of `large.webp` on `APP_ORIGIN`), `og:image:type`
   (`image/webp`), `og:image:width`, `og:image:height` and `og:image:alt`;
8. for a post, `property="article:published_time"`, the post's `created_at` in ISO 8601 UTC; for a profile,
   `property="profile:username"`, the handle;
9. `name="twitter:card"`: `summary_large_image` when the image is a post's, else `summary`.

No `twitter:site` or `twitter:creator` (korbat has no account there to name, and a person's account elsewhere is not
korbat's to publish), no `og:locale` (English, the default), no counts, no verified mark, no dates but the post's.

### 8.4 What each card shows

| Page and state | Status | Card |
|---|---|---|
| Post visible, author turned previews on | 200 | title `{displayName} (@{handle})`; description the text (8.5), an imported post's label first; image the first image shown to everyone, else the author's avatar, else none |
| Post visible, author's previews off (the default, decision 21) | 200 | generic: title "A post on korbat", no description, no image |
| Post visible, author suspended | 200 | as visible, no label |
| Post withheld, removed, disabled, deleted, erased, missing, or its author deleted | 404 | none: the plain shell |
| A reply | 200 | as a post; nothing of its parent |
| A quote | 200 | as a post; only its own text and images, never the quoted post's |
| Profile live, previews turned on | 200 | title `{displayName} (@{handle})`; description the bio (8.5), none when empty; image the avatar, else none |
| Profile live, previews off (the default) | 200 | generic: title "A profile on korbat", no description, no image |
| Profile suspended | 200 | as live, no label |
| Profile deleted or purged, an old handle, an unknown handle | 404 | none |

An image on a card is a `MediaView` of the post as a signed-out reader gets it (`isHiddenMedia` false), so a withheld,
removed, sealed, lost or erased image is never named, and its description (`alt`) is the post's own, which 2b requires.
An avatar's `og:image:alt` is "Profile picture of @{handle}" (8.6); an avatar that 7.6's review withholds is not used
(`avatarsOf` does not answer it). The imported post's label is the API's own copy of 3b's `import.label` and
`import.label.shortened` (3b design, section 10.9), which the API cannot import from the app: `CARD_WORDS`'
`card.imported` and `card.imported.shortened` (8.6), followed by a full stop and the text.

### 8.5 Text, lengths and escaping

- Text is the post's body or the bio as stored, already normalised (no control, bidirectional or zero-width
  character). Line breaks become single spaces. Mentions and links stay as written.
- Lengths are counted in code points (`Array.from`), as the database counts them: a title at most 70 (X's limit), cut
  with "..." when longer; a description at most 200, cut at the last space before 197 and ended with "..."; an image's
  description at most 420.
- Every value is escaped for a double-quoted attribute: `&` `<` `>` `"` `'` as `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`,
  and `{` `}` as `&#123;` `&#125;`. URLs are built from `APP_ORIGIN`, a uuid and a handle that the handle rule limits to
  `[a-z0-9_]`, and escaped the same way.
- One function, `cardBlock` (apps/api/src/cards/build.ts), builds every block; its unit tests feed it display names,
  bios and texts holding `<script>`, `"><meta`, `&amp;`, `{{ .Env }}`, `{{`, `}}`, a 1,000-character body of one word,
  four-byte characters at every cut, and an empty body with an image.

### 8.6 Words and caching

The card's sentences live in apps/api/src/cards/words.ts (`CARD_WORDS`): "A post on korbat", "A profile on korbat",
"Profile picture of @{handle}", the title form `{displayName} (@{handle})`, `card.imported` "Imported from {source},
dated {date}" and `card.imported.shortened` ", shortened on import". `{source}` is the source's display name (`x` is
"X", `mastodon` "Mastodon", `bluesky` "Bluesky"), and `{date}` the post's date in UTC in one fixed form, "3 March
2019", since the server has no reader's locale. A unit test holds the card's sentence equal in shape to 3b's. The site
name is "korbat".

The page that carries a card is `no-cache`, as the shell is today, so a post withheld after it was shared loses its card
on korbat's side at the next fetch; the images it names keep 3d's `PUBLIC_CACHE` and its outbox. Unfurlers keep their
own copies beyond korbat's reach (inputs 3.5): X for about 7 days, Meta until a re-scrape, Slack about 30 minutes, each
Mastodon instance two weeks. Settings, Privacy says so beside the switch (section 10.8).

### 8.7 Titles

The `<title>` the server sends stays the shell's, "korbat", on every page (decision 23); the app replaces it with its
own `TITLE_WORDS` title once the bundle runs, which never names an account (UI design, decision 16). `og:title` names
the author or the profile, and every unfurler reads it before `<title>` (inputs 3.3). Section 12.4's crawler fixtures
hold both: the served `<title>` is "korbat" on a post's and a profile's card.

## 9. The API

### 9.1 Modules

- **apps/api/src/activity/** (new): `index.ts` (the module's deps and its routes), `repo.ts` (the list's query, the
  newer count, the seen marker, the settings), `flows.ts` (the merge of 5.5.2, the views), `retention.ts` (the job).
  It reads `activity_items`, `activity_state` and, through the social module's index, post views; it asks the
  moderation module's index for `authorActivity`. It writes nothing but `activity_state` and the retention's deletes.
- **apps/api/src/cards/** (new), section 8.
- **apps/api/src/social/** writes `activity_items` and `post_mentions` (5.3, 4.2), deletes them (5.6, 4.4), reads
  mentions into views and avatars through `media.avatarsOf` (7.5), and gains the hide-counts route, the avatar's set
  and remove (7.3) and the link-preview switch, beside `/me/explore`.
- **apps/api/src/media/** gains the avatar's upload query, job file, `attachAvatar`, `detachAvatar` and `avatarsOf`,
  serve branch, sweeper rule and holds, and keeps avatars out of its unattached-upload queries (7.2).
- **apps/api/src/moderation/** gains `authorActivity`, `avatarSet`, the avatar in the account's snapshot, and the
  measure's words.

### 9.2 Routes

| Route | Session | Answer |
|---|---|---|
| `GET /api/activity?tab=&cursor=`, `tab` one of `all` and `conversations` | signed in | `ActivityPage` |
| `GET /api/activity/newer?tab=&since=`, `tab` as above | signed in | `{ count }`, 0 to 21 |
| `POST /api/activity/seen` with `{ at }` | signed in, CSRF | 204 |
| `GET /api/activity/settings` | signed in | `ActivitySettings` |
| `PUT /api/activity/settings` with `ActivitySettings` | signed in, CSRF | `ActivitySettings` |
| `POST /api/media?kind=avatar&crop=`, `crop` one of `start`, `centre` and `end` | signed in, CSRF | `UploadResponse`, as today |
| `PUT /api/me/avatar` with `{ mediaId }` | signed in, CSRF | `{ avatar: AvatarView }` |
| `DELETE /api/me/avatar` | signed in, CSRF | `{ avatar: null }` |
| `POST /api/me/share-previews`, `DELETE /api/me/share-previews` | signed in, CSRF | `{ sharePreviews }`, as `/api/me/explore` |
| `PATCH /api/posts/:id/counts` with `{ hidden }` | signed in, CSRF, the post's author | `{ countsHidden }` |
| `GET /api/cards/post/:id` | none, before the session | 204 with `Korbat-Card`, or 404 |
| `GET /api/cards/profile/:handle` | none, before the session | 204 with `Korbat-Card`, or 404 |

The hidden-counts route answers `not_found` for a post that is not the caller's, is deleted, or is disabled, as
`deletePost` does; it is allowed on a withheld or removed post, which its author still sees. A suspended author may hide
a post's counts (`hidden: true`), which only reduces what others see, and is refused showing them (`hidden: false`) by
3e's predicate through `lockActing` (decision 17). `setSharePreviews` is written as `setShowInExplore` is
(apps/api/src/social/repo.ts:1079-1086, no predicate) for turning previews off (`DELETE`); turning them on (`POST`)
takes the acting row through `lockActing`, so a suspended account is refused. Neither names `liveNotSuspended`.

### 9.3 Contracts

- **packages/contracts/src/activity.ts** (new): `ACTIVITY_KINDS` (`reply`, `mention`, `quote`, `follow`),
  `ACTIVITY_REACH` (`everyone`, `older`, `following`, `off`), `ACTIVITY_MIN_AGE_HOURS` (48), `ACTIVITY_KEEP_DAYS` (90),
  `ACTIVITY_PAGE_SIZE` (30), `ACTIVITY_NEWER_CAP` (21); `ActivitySettings` (`{ replies, mentions, quotes, follows }`);
  `ActivityEntry`, a union on `type`: `post` (`kind` reply, mention or quote; `key`; `at`; `new`; `post: PostView`),
  `follows` (`key`, `at`, `new`, `count`, `actors: Author[]`, at most 3), and `moderation` (`kind` `decision`,
  `release`, `upload` or `lost`; `key`; `at`; `new`; `target` `post`, `profile` or `account`; `id`, the decision's,
  release's, refusal's or image's; `postId` and `postCreatedAt` when the target is a post); `ActivityPage` (`items`,
  `nextCursor`, `seenAt`); `ActivityQuery`, `ActivityNewerQuery`, `SeenRequest` (`at`, an ISO time).
- **packages/contracts/src/mentions.ts** (new): section 4.1.
- **packages/contracts/src/social.ts:** `AvatarView` (`{ small, large }`, paths); `Author.avatar: AvatarView | null`
  (so `ProfileListItem` has it too); `ProfileView.avatar`; `PostView.mentions` (`string[]`, 4.3; `QuotedPost` gains
  nothing); `PostView.countsHidden: boolean`, true when the author hid the counts; `PostCounts.likes` and
  `PostCounts.reposts` become `number | null`. One rule holds for every answer that carries `PostCounts`,
  `EngagementResponse` (`{ counts, viewer }`, the answer to every reader's like, unlike, repost and unrepost) included:
  the two are null exactly when the post's counts are hidden and the reader is not its author, so no reader learns a
  hidden count by liking or unliking; the app's optimistic update keeps a null as null. `CreatePostRequest.hideCounts`
  (optional, default false); `CountsRequest` (`{ hidden: boolean }`); `SharePreviewsResponse`.
- **packages/contracts/src/media.ts:** `MEDIA_KINDS` (`post`, `avatar`), `AVATAR_CROPS` (`start`, `centre`, `end`),
  `UploadQuery`; `MediaErrorCode` gains `avatar_not_ready` and `not_an_avatar` (Task 3) and `avatar_reset` (Task 4).
- **packages/contracts/src/moderation.ts:** the measure `reset_avatar` and the reversal `restore_avatar` (7.7).
- **packages/contracts/src/account.ts:** `ExportFormat` gains section 11.2's members.
- **packages/contracts/src/auth.ts:** `MeProfile` gains `sharePreviews`, beside `showInExplore`, read by the auth
  module's `me()` (apps/api/src/auth/flows/account.ts) from the profile store (apps/api/src/profiles/store.ts), which
  reads `profiles.share_previews` as it reads `show_in_explore`. `MeResponse` gains `avatar: AvatarView | null`, which
  apps/api/src/app.ts's `/api/me` adds from the media module's `avatarsOf` (7.5), as it adds `standing` from the
  moderation module.
- **Where each change lands.** A contract change is made in the task that builds its producer, together with the app's
  code and test fixtures that build or read the changed shape, so the app's typecheck passes at every task (section 13):
  `PostView`'s, `PostCounts`'s, `MeProfile`'s and the export's 2d members in Task 2, the avatar's in Task 3, the
  measure's in Task 4.

### 9.4 Errors

| Code | Status | When |
|---|---|---|
| `invalid_request` | 400 | a bad tab, cursor, time, setting, crop, or a `crop` without `kind=avatar` |
| `not_found` | 404 | another account's upload or post, a missing one; a card that does not exist |
| `avatar_not_ready` | 409 | the upload is processing, failed or refused |
| `not_an_avatar` | 409 | the upload is a post's image |
| `rate_limited` | 429 | a limit of 9.5 |
| `avatar_reset` | 409 | the upload is the picture a moderator reset on this account less than 30 days ago (7.7) |
| 3e's refusal | as 3e answers | a suspended account's new avatar, showing a post's counts, or turning link previews on |

`POST /api/activity/seen` and `PUT /api/activity/settings` are not refused for a suspended account: they change only
what the account reads, as "Ask for a person" and reading are left to it (3e design, row 9). Nor are
`DELETE /api/me/avatar`, `DELETE /api/me/share-previews` and `PATCH /api/posts/:id/counts` with `{ hidden: true }`:
each only reduces what others see (decision 17). The route walk's table `SUSPENDED_WRITES`
(apps/api/test/integration/standing-route-walk.test.ts), which fails on a write route it does not list, gains every new
write route: those above `allowed` (the counts route with the walk's `{ hidden: true }`), `PUT /api/me/avatar` and
`POST /api/me/share-previews` `refused`.

### 9.5 Limits

Each write route declares its limit next to it, counted in Valkey under `social:<bucket>:<account>` by the existing
counter (apps/api/src/social/limits.ts), and fails closed. The five new actions join `WriteAction` and `limitsFor` in
apps/api/src/social/tiers.ts, with buckets named as the existing ones are (lower case and hyphenated, as `follow-hour`
and `upload-day`):

| Action | Bucket | Limit |
|---|---|---|
| `activity-seen` | `activity-seen` | 240 an hour |
| `activity-settings` | `activity-settings` | 120 an hour (the app saves a settled choice only, 10.8) |
| `avatar` (set and remove together) | `avatar-hour`, `avatar-day` | 10 an hour, 30 a day |
| `share-previews` | `share-previews` | 30 an hour |
| `hide-counts` | `hide-counts` | 60 an hour |

The activity module counts through the social module's index, which exports `enforceWriteLimit`
(apps/api/src/social/index.ts:21); it imports nothing deeper. An avatar's upload counts under the existing `upload`
and `upload-day` buckets. The reads and the card routes are under the API's global
limit per address (300 a minute), as the status route is (decision 30).

## 10. The screens

Every screen is drawn with the UI sub-project's tokens and kit (apps/app/src/components/kit/), titled from
`TITLE_WORDS` through `usePageTitle`, with one h1, times through apps/app/src/lib/time.ts, and every sentence from a
words module (10.10). Nothing here animates beyond the kit's own motion, and each has its reduced form.

### 10.1 The nav

`navItems` (apps/app/src/components/AppShell.tsx) gains Activity, second, with Lucide's `Bell`, named `activity` in the
icon map (apps/app/src/components/icons.ts) and the label `nav.activity`, "Activity" (decision 24):

- the full nav (1280 px and wider) and the rail (768 to 1279 px): Home, Activity, Bookmarks, Profile, Settings;
- the phone's tab bar (below 768 px): Home, Activity, Bookmarks, Profile; Settings is reached from the profile's
  settings button, which every own profile shows. That button's label, `profile.settings`
  (apps/app/src/lib/ui-words.ts:270, used at apps/app/src/app/u/[handle]/index.tsx:227), changes from "Security and
  privacy settings" to "Settings", since it opens the Settings index and is the phone's only way to Appearance,
  Activity, Account and Cases; the Getting started panel's profile row says where it is (10.7). Activity's header
  holds a quiet link to Settings, Activity.

The item never carries a dot, a number or a word other than its label; the shell's comment "Nothing here counts or
badges anything" stays true, and the shell test holds it (12.5). The signed-out nav is unchanged.

### 10.2 Activity

A new route, apps/app/src/app/activity.tsx (`/activity`), for an account only: signed out it redirects to Sign in, as
Bookmarks does. Title `title.activity`, "Activity - korbat"; h1 "Activity" in ScreenHeader.

- **Tabs.** The kit's Tabs, named `activity.tabs`: All and Conversations (replies, mentions and quotes). The selected
  tab is part of the address (`?tab=conversations`), so a reload keeps it; nothing is stored.
- **The list.** The kit's PagedList with Load more, as every list (UI design, decision 6), 30 entries a page. Each
  entry is a row of apps/app/src/components/activity/ (new), and each is an article named by its line and its time
  (`activity.entry.name`, "Ada replied to your post, 3h ago"), with "New, " first while it is new
  (`activity.entry.newName`), so a screen reader moving by item hears what each is and which are new:
  - `PostEntry`: the line (`activity.reply`, `activity.mention` or `activity.quote` with the actor's display name) and
    the time, then the post as a static PostCard (3b's static variant, UI design section 6.6), whose body is the link
    to the post; the actor's Avatar at 40 px. Below the card, the card's Reply action alone (no Like or Repost, which
    keeps the row quiet) opens the composer as a reply in place, as the feed's card does, since each entry is a
    conversation to answer (1.5).
  - `FollowsEntry`: up to three 32 px Avatars side by side, the line (`activity.follow.one`, `.two` or `.many`) and the
    time of the group's newest follow (`{time}`, as every entry is labelled; the UTC day of decision 6 stays the bucket
    and is never shown as a day). The row itself is not pressable: each of the up to three names in the line is its own
    link to that profile, and a group of more than three ends with `activity.follow.all`, "See your followers", which
    opens the account's own Followers list. One target per control, each at least 44 px high on phones.
  - `ModerationEntry`: a ListRow with the scale icon the Cases screen uses, the line (10.10), the time the person was
    told and `activity.moderation.open`, "Open in Cases"; it opens the decision, release or refusal screen under
    Settings, Cases, or the post for a lost image.
- **What is new.** Entries marked `new` come first, as they are newest. Two h2 headings mark the parts, so headings
  navigation reaches both: `activity.divider`, "New since you last looked", above the first new entry, and
  `activity.earlier`, "Earlier", above the first older one, drawn as the feed's "You were here" is (a line and a label,
  ink-medium, never a colour alone); with no new entry neither is drawn. After the first page is shown, the screen
  sends the seen marker (5.7). Entries are never highlighted by colour.
- **The pill.** While the screen is open and visible, `lib/activity.ts` asks for newer entries at 30 seconds and then
  every 60 (5.8) and shows the feed's pill component with `activity.pill`, announced once, politely, as the feed's
  pill is; pressing it reloads the first page at the top. Pull to refresh does the same on phones. After the pill or a
  refresh, focus moves to the list's first entry; after Load more, to the first entry it loaded.
- **Empty and end.** The kit's EmptyState with `activity.empty.all.*` or `activity.empty.conversations.*`; after the
  last page, `activity.end`, which names the 90 days. ErrorState with its retry on a failed load.

### 10.3 Mentions in posts and in the composer

`RichText` links stored mentions only (4.5). The composer (apps/app/src/components/social/composer/) shows
`activity.composer.mentions` under the text field, in ink-medium, while the text holds a handle by `MENTION_TOKEN`;
nothing else changes in it, and no account is looked up while typing (decision 13).

### 10.4 The avatar everywhere

`Avatar` (apps/app/src/components/kit/Avatar.tsx) draws `src` when it is given: `small` at 32 and 40 px, `large` at 64
and 96 px, through `expo-image` with no transition, in the same disc, ring and size as the monogram, and stays
`aria-hidden` inside its profile link (UI design, section 6.5). Without `src`, or when the image fails to load, the
monogram is drawn, so nothing moves (the UI design's decision 22). PostCard, ProfileList, the composer card, the profile
header and Activity's rows pass `author.avatar`. The profile header's layout does not change.

### 10.5 The avatar picker

Settings, Profile (apps/app/src/app/settings/profile.tsx) gains a card "Profile picture" above the display name:

- the current avatar at 96 px (or the monogram), "Choose a picture" (or "Choose another picture") and, when there is
  one, "Remove picture";
- choosing a file goes through the existing picker (apps/app/src/lib/pick-images.ts), one image, with the types and
  the HEIC sentence 2b already has. The card then shows a 96 px preview of the local file in the avatar's disc,
  `object-fit: cover`, and a radio group "Which part to keep" with three choices named by the image's shape (Top,
  Middle, Bottom for a portrait; Left, Middle, Right for a landscape; none for a square), each moving the preview's
  `object-position`, so the preview is the square the worker will keep; the preview's name says the choice
  (`AVATAR_WORDS.previewPart`, "Preview of your profile picture, Top part kept");
- "Use this picture" uploads with `kind=avatar` and the crop, shows `AVATAR_WORDS.uploading` and then
  `AVATAR_WORDS.processing` in a polite status line (`role="status"`, the UI design's rule for loading statuses) while
  it polls the upload's status as the composer does, then sets it, shows the toast `AVATAR_WORDS.updated` and moves
  focus to "Choose another picture". A refused upload shows UPLOAD_TEXTS' `refused` and its "Why" link, as the
  composer does, a failed one `AVATAR_WORDS.failed`, and a picture a moderator reset less than 30 days ago
  `AVATAR_WORDS.resetRecently` (7.7); each is an error line (`role="alert"`, as form errors are) that takes focus, with
  its "Why" link next in order. "Cancel" drops the local file and returns focus to "Choose a picture";
- "Remove picture" opens the kit's confirm dialog (`AVATAR_WORDS.confirmTitle`, `AVATAR_WORDS.confirmBody`, with
  `AVATAR_WORDS.confirm` and Cancel), since the files go after the commit; on Remove it shows the toast
  `AVATAR_WORDS.removed`, and focus returns to "Choose a picture".

The preview's `blob:` address is allowed by the page's policy (`img-src 'self' data: blob:`) and revoked when the card
closes.

### 10.6 Hide counts

- The composer's options gain a switch, `post.hideCounts.option`, "Hide like and repost counts", off by default, sent as
  `hideCounts`.
- The post's More menu gains, for its author, `post.hideCounts` or `post.showCounts`, which calls the route and
  answers at once with a rollback on refusal, as every action of the post does (UI design, section 6.6); the toast
  says `post.countsHidden` or `post.countsShown`.
- A post whose counts are null shows no number beside Like and Repost, as the reader's own setting draws it (UI design,
  decision 15); a like's or a repost's optimistic update (lib/post-actions.ts) keeps a null as null, and the answer
  (`EngagementResponse`) brings null again (9.3). The author's "Who sees this" sheet gains `reach.countsHidden` while
  they are hidden.

### 10.7 First visit

`FeedList` (apps/app/src/components/social/FeedList.tsx) shows, for a signed-in account on Following while the feed
has no item, a Getting started panel instead of today's empty state (decision 25): the heading `feed.start.title`, one
sentence `feed.start.body`, and five rows, each one line and one link: Latest (switches Home's tab), Explore and how it
picks (`/explore/about`), the handle box itself (the existing `HandleBox` component, drawn inside the panel on every
width), the profile's settings (`/settings/profile`, `feed.start.profile`, with `feed.start.settings` below it under
768 px, where Settings is on the profile, 10.1), and the rules (`/rules`). Below 1024 px, where the context column
is not drawn, the panel ends with AboutCard's three lines. No account is suggested, nothing is dismissed or stored, and
the panel goes as soon as Following has a post. The passkey suggestion keeps its place above it.

### 10.8 Settings

- **The index** (apps/app/src/app/settings/index.tsx) gains the row "Activity", after Appearance, with the hint
  `ACTIVITY_SETTINGS_WORDS.hint`.
- **Settings, Activity** (apps/app/src/app/settings/activity.tsx, new; title `title.settingsActivity`): an intro and
  four radio groups of the kit's form, each one tab stop whose arrows move the choice, as Appearance's are: Replies to
  your posts, Mentions of you, Quotes of your posts (Everyone, Accounts older than 2 days, Accounts you follow, Off) and
  New followers (On, Off). Unlike Appearance's, these choices are saved on the server, so a group's value is saved once
  it has been still for 800 ms or when focus leaves the group: one request and one toast per settled change, never one
  per arrow press; a failed save rolls back with its sentence.
- **Settings, Privacy** (apps/app/src/app/settings/privacy.tsx) gains a "Link previews" card with its switch, off
  until the person turns it on (decision 21), and its one sentence saying what a preview shows and where, and the note
  on search engines; its explanation of blocks and mutes changes (decision 8). Nothing elsewhere asks the person to
  turn previews on.

### 10.9 The browser check and the budget

- The fixture API (apps/app/test/browser/fixture-api.ts) gains the activity routes with entries of every kind (a page
  boundary inside a follow day, two new entries, moderation entries of each kind), `PUT` and `DELETE /api/me/avatar`,
  avatar files (two small WebP squares written by the fixture's code), the hide-counts route, mentions on its posts
  (one stored, one not, one imported), and a fresh account whose Following is empty.
- The check (apps/app/test/browser/app.browser.ts) gains steps 52 to 57 after 3b's 51: 52 Activity at 360, 768 and 1280 px in the
  three themes, its tabs, rows, headings and pill, each entry's accessible name and where focus goes after the pill and
  after Load more, a follow group's three name links, with no request to `/api/activity` from any other route and no
  change of the nav or the title when entries arrive, and at 360 px Settings reached from the profile by its name; 53
  Settings, Activity's radio groups by keyboard, arrowing across a group sending one request; 54 the avatar picker from
  a fixture image to the header and a post card, its status line, the confirm dialog of its removal and the focus after
  each; 55 mentions: a stored one links, an unstored and an imported one do not; 56 the Getting started panel at 360 px
  with the handle box; 57 hiding counts from the More menu, seen by another reader as no number. Every new label passes
  the clip test at 360 px; every new target is at least 44 by 44 px on phones; contrast is sampled on the new rows in
  Light, Dim and Dark.
- **The budget.** 2d adds at most 20,480 bytes of gzipped JavaScript to the export as 3b's replay leaves it (decision
  27). Each task that changes the app records the export's size in its summary; Task 5 (section 13) holds the total.
  The cap in force at 2d's start is the one in app.browser.ts as 3b's replay leaves it (832,257 bytes, the baseline
  plus 120 KB, which 3b's Task 7 set under the orchestrator's rule; 791,297 at 0bc2dcc). While the export fits, it
  stays; otherwise Task 5 raises it to the baseline plus 140 KB (852,737 bytes) by editing app.browser.ts:622-623 (the
  rule's added kilobytes and the pinned number), with the measured numbers as an amendment of section 15 flagged
  (owner).

### 10.10 Words

Every new sentence, by module. `{name}` is a display name, `{n}` a number, `{time}` comes from lib/time.ts, and
`{date}` is lib/time.ts's date form (never "ago"). The moderation entries reuse 3d's words unchanged where those exist
(the last rows of the first table).

apps/app/src/lib/activity-words.ts (new, `ACTIVITY_WORDS`):

| Key | Sentence |
|---|---|
| `activity.title` | Activity |
| `activity.tabs` | Activity |
| `activity.tab.all` | All |
| `activity.tab.conversations` | Conversations |
| `activity.settingsLink` | Activity settings |
| `activity.entry.name` | {line}, {time} |
| `activity.entry.newName` | New, {line}, {time} |
| `activity.divider` | New since you last looked |
| `activity.earlier` | Earlier |
| `activity.pill.one` | 1 new |
| `activity.pill` | {n} new |
| `activity.pill.many` | 20+ new |
| `activity.pill.label` | {visible} above, go to the first one |
| `activity.reply` | {name} replied to your post |
| `activity.mention` | {name} mentioned you |
| `activity.quote` | {name} quoted your post |
| `activity.follow.one` | {name} followed you |
| `activity.follow.two` | {name} and {other} followed you |
| `activity.follow.many` | {name} and {n} others followed you |
| `activity.follow.all` | See your followers |
| `activity.decision.post` | A decision about your post from {date} |
| `activity.decision.profile` | A decision about your profile |
| `activity.decision.account` | A decision about your account |
| `activity.moderation.open` | Open in Cases |
| `activity.empty.all.title` | Nothing here yet |
| `activity.empty.all.body` | When someone replies to you, mentions you, quotes you or follows you, it shows here, and so do decisions korbat sent you. korbat does not tell you about replies, mentions, quotes or follows anywhere else. |
| `activity.empty.conversations.title` | No conversations yet |
| `activity.empty.conversations.body` | Replies to your posts, mentions of you and quotes of your posts show here. |
| `activity.end` | That's everything from the last {days} days. |
| `activity.error` | Your activity could not be loaded. |
| `activity.composer.mentions` | Up to 10 accounts you name with @ are told, if their settings allow it. |
| (3d) release | `RELEASE_TEXTS.entry`, "Sealed images released", unchanged |
| (3d) refused upload | `UPLOAD_TEXTS.entry`, "An upload was not accepted", unchanged |
| (3d) lost image | `IMAGE_LOST_NOTICE.mail({time})` (packages/rules), unchanged |

apps/app/src/lib/ui-words.ts (`UI_WORDS` and `TITLE_WORDS`):

| Key | Sentence |
|---|---|
| `nav.activity` | Activity |
| `title.activity` | Activity - korbat |
| `title.settingsActivity` | Activity - Settings - korbat |
| `feed.start.title` | Getting started |
| `feed.start.body` | Following shows posts from the accounts you follow, newest first. Here is how to find some. |
| `feed.start.latest` | Read Latest: every public post, newest first |
| `feed.start.explore` | See Explore, and how it picks |
| `feed.start.handle` | Go to a profile by its handle |
| `feed.start.profile` | Set up your profile: a name, a bio and, if you like, a picture |
| `feed.start.settings` | On a phone, Settings is on your profile. |
| `feed.start.rules` | Read the rules |
| `profile.settings` (changed) | Settings |
| `post.hideCounts.option` | Hide like and repost counts |
| `post.hideCounts` | Hide like and repost counts |
| `post.showCounts` | Show like and repost counts |
| `post.countsHidden` | Like and repost counts hidden |
| `post.countsShown` | Like and repost counts shown |
| `reach.countsHidden` | Like and repost counts are hidden from everyone but you. |

apps/app/src/lib/settings-words.ts:

| Key | Sentence |
|---|---|
| `ACTIVITY_SETTINGS_WORDS.nav` | Activity |
| `ACTIVITY_SETTINGS_WORDS.hint` | Who can reach you in Activity |
| `ACTIVITY_SETTINGS_WORDS.intro` | Choose what shows in your Activity. korbat never tells you about replies, mentions, quotes or follows anywhere else: no email, no push and no badge. Decisions about your posts and account also come by email. |
| `ACTIVITY_SETTINGS_WORDS.replies` | Replies to your posts |
| `ACTIVITY_SETTINGS_WORDS.mentions` | Mentions of you |
| `ACTIVITY_SETTINGS_WORDS.quotes` | Quotes of your posts |
| `ACTIVITY_SETTINGS_WORDS.follows` | New followers |
| `ACTIVITY_SETTINGS_WORDS.everyone` | Everyone |
| `ACTIVITY_SETTINGS_WORDS.older` | Accounts older than 2 days |
| `ACTIVITY_SETTINGS_WORDS.following` | Accounts you follow |
| `ACTIVITY_SETTINGS_WORDS.off` | Off |
| `ACTIVITY_SETTINGS_WORDS.on` | On |
| `ACTIVITY_SETTINGS_WORDS.muted` | Accounts you mute or block never show in your Activity. |
| `ACTIVITY_SETTINGS_WORDS.fromNow` | A change applies from now on. It does not bring back what was not shown. |
| `ACTIVITY_SETTINGS_WORDS.saved` | Saved |
| `ACTIVITY_SETTINGS_WORDS.failed` | Your choice could not be saved. Try again. |
| `PRIVACY_WORDS.explain` (changed) | A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can still read them. A mute hides an account from your timelines and your Activity, and they are never told. |
| `PRIVACY_WORDS.previews` | Link previews |
| `PRIVACY_WORDS.previewsSwitch` | Show a preview when someone shares a link to my posts or profile |
| `PRIVACY_WORDS.previewsExplain` | When this is on, a link to your post or profile shared on another site shows your display name, your handle, the post's text or your bio and its first image or your profile picture, as anyone signed out sees them, and that site may keep its copy after you delete the post, where korbat cannot remove it. |
| `PRIVACY_WORDS.search` | korbat asks search engines not to list your posts and your profile, and turns away every crawler but the link-preview fetchers. |
| `AVATAR_WORDS.section` | Profile picture |
| `AVATAR_WORDS.explain` | Your picture is public: anyone can see it, signed in or not, and link previews show it on other sites if you turn them on in Privacy. A picture of you can identify you. korbat keeps only the square you choose and removes the photo's location and camera details. |
| `AVATAR_WORDS.choose` | Choose a picture |
| `AVATAR_WORDS.change` | Choose another picture |
| `AVATAR_WORDS.remove` | Remove picture |
| `AVATAR_WORDS.keep` | Which part to keep |
| `AVATAR_WORDS.top` | Top |
| `AVATAR_WORDS.middle` | Middle |
| `AVATAR_WORDS.bottom` | Bottom |
| `AVATAR_WORDS.left` | Left |
| `AVATAR_WORDS.right` | Right |
| `AVATAR_WORDS.preview` | Preview of your profile picture |
| `AVATAR_WORDS.previewPart` | Preview of your profile picture, {part} part kept |
| `AVATAR_WORDS.use` | Use this picture |
| `AVATAR_WORDS.cancel` | Cancel |
| `AVATAR_WORDS.uploading` | Uploading your picture... |
| `AVATAR_WORDS.processing` | Preparing your picture... |
| `AVATAR_WORDS.updated` | Profile picture updated |
| `AVATAR_WORDS.removed` | Profile picture removed |
| `AVATAR_WORDS.failed` | This picture could not be used. Try another one. |
| `AVATAR_WORDS.resetRecently` | A moderator removed this picture from your profile less than 30 days ago, so it cannot be your profile picture again yet. |
| `AVATAR_WORDS.confirmTitle` | Remove your profile picture? |
| `AVATAR_WORDS.confirmBody` | korbat deletes it. You can choose a picture again at any time. |
| `AVATAR_WORDS.confirm` | Remove |

Elsewhere: apps/api/src/cards/words.ts (8.6); the measure's label "Reset profile picture" in `MEASURES`,
`DECISION_WORDS.avatar` ("Profile picture"), each measure's sentence in apps/app/src/lib/terms.ts, and the statement's
sentences in packages/rules (7.7); 3d's finding words with "this profile picture" (7.6). The source scan
(apps/app/test/a11y.test.tsx) covers the new files, and the shell test holds that no title key holds a placeholder.

## 11. Privacy and transparency

### 11.1 What is stored, and for how long

| What | Holds | Kept |
|---|---|---|
| An Activity entry | the recipient, the actor, the kind, the post's id, the time; never a text | 90 days, less when its post is deleted, a block falls between the pair or an account is purged |
| `activity_state` | the seen time and four settings | as long as the account |
| A mention | the post, the account named, the handle as typed, its place | as long as the post, less when it is erased |
| An avatar | the two squares and the row 2b keeps for any image (owner, sizes, blurhash, score and hashes while 3d's tools are on), and its SHA-256 | while it is the avatar; a replaced or removed one is deleted at once unless a case holds or a seal keeps it |
| A reset picture's SHA-256 (`avatar_resets`) | the hash, the account, the decision's action | read for 30 days after the reset, then kept as long as its case's evidence |
| The link-preview switch and the hidden-counts switch | one boolean each | as long as the account or the post |
| A card | nothing: built at each request from the public post or profile | never stored by korbat; other platforms keep their copies (8.6) |

The retention job logs only how many rows it deleted. The card routes are logged as every request is, by method,
path, status and duration (apps/api/src/middleware/observability.ts:17), so a profile card's path names the handle and
a post card's the post's id, as `GET /api/profiles/:handle` and `GET /api/posts/:id` already do; no text is logged.

### 11.2 The data export

`ExportFormat` (packages/contracts/src/account.ts) and apps/api/src/account/flows/export.ts gain, each in the format's
order after what 3b adds:

- in `profile`: `avatar` (`{ id, file, width, height }` or null; the file is `media/<id>.webp`, the 400 px square) and
  `sharePreviews`;
- in each element of `posts`: `mentions` (the handles as written, in order) and `countsHidden`;
- a member `activity`: `{ seenAt, settings, received }`, where `received` lists every row the account received that
  korbat still holds, newest first, ungrouped, each `{ kind, at, postId, actorHandle, shown }` with the actor's handle
  at the time of export (`postId` null for a follow), read through the activity module's index (`exportEntries`).
  `shown` is `true`, or why the list does not show it: `muted` (the person mutes the actor),
  `post_not_visible` (the post is withheld, removed, disabled or erased), `unfollowed` (the follow is gone) or
  `actor_deleted`. A row whose post is not visible carries `postId` null, so the export never discloses another
  person's moderation. Moderation entries are left out, since the `moderation` member already holds them (decision 28).
  The right of access reaches what korbat holds, not what it draws; counsel confirms the line (11.3).

### 11.3 The terms and the privacy text

The terms' privacy section (the terms' source in packages/rules, rendered at `/terms`) gains, as drafts that counsel
reviews before korbat opens (sub-project 4, as 3d's drafts are):

- what Activity stores and for how long, printed from `ACTIVITY_KEEP_DAYS`, and that no mail or push is sent about it;
- that a mention links to the account it named when the post was written and tells that account, within its settings;
- that a profile picture is public, is checked like every image, can be reset by a moderator under the rules, and is
  deleted with the account;
- that a shared link to a public post or profile shows a generic card, or, once its author turned previews on, a
  preview with what a signed-out reader sees; that other sites keep their copy beyond korbat's reach; that robots.txt
  turns away every crawler but the named link-preview fetchers; and that korbat asks search engines not to index posts
  and profiles, which search engines may or may not honour.

`TERMS_VERSION` does not change for drafts, as 3d's did not (3d design, section 16). Counsel also answers these
questions, which the design answers without a lawyer; the README's Before going public lists the review and the
questions word for word:

1. Export scope (decision 28): must the rows korbat holds but does not show be given, as 11.2 gives them, and is the
   actor's handle in `received` (a third party's data, GDPR Art. 15(4) and 20(4)) fine, as the export's likes and
   follows already are?
2. Link previews (decision 21): would "on" by default be compatible with Art. 25(2) GDPR's privacy by default, given
   that cards put a person's name, text and picture into other platforms' stores that korbat cannot erase? korbat
   admits people from 16 and cannot tell who is under 18: do Art. 28 DSA and, for UK users, the Children's Code
   require the default to stay off for everyone, or would a stored "adult from" date (never the date of birth) let it
   differ?
3. Crawlers (decision 20): may the terms forbid automated collection and the use of korbat's content for model
   training, and does robots.txt's wording matter for the text and data mining reservation of Art. 4(3) of Directive
   2019/790 (a machine-readable reservation)?
4. Avatars and hashing: are the matcher's perceptual hash of a face picture and the SHA-256 kept after a reset outside
   processing "for the purpose of uniquely identifying a natural person" (Art. 9 GDPR)? The terms will describe the
   checks, so counsel says so in writing.
5. `reset_avatar` as a restriction under Art. 17 DSA: its statement of reasons (7.7's sentences) and its place in the
   transparency report's measures table (11.4).
6. Retention (decision 11): 90 days for entries, the seen marker and the settings for the account's life, and a reset
   picture's hash for 30 days of use.

### 11.4 Transparency

The yearly editions on `/transparency` label their measures table with `MEASURE_KINDS`
(packages/contracts/src/transparency.ts, `FIGURE_LABELS.measures`), so `reset_avatar` becomes a label of its own from
the first edition after 2d, and a count under the floor folds into `other`, as every small cell does; editions already
published never change (3d). `/rules`, which lists the measures korbat may take, names the profile picture's reset
beside the display name's and the bio's. Nothing about Activity, mentions or cards is published: none is a decision.

## 12. Testing

Every fixture is built by code; no real person's image, archive or post is ever used. Tests sit where each package keeps
them today.

### 12.1 Fixtures built by code

- **Images.** The worker's tests draw their sources with sharp: a 300 by 200 PNG and a 200 by 300 PNG, each in three
  flat colour bands along its longer side, so a crop's position is read back from the square's centre pixel; a 90 by
  60 PNG (smaller than both squares); an EXIF-rotated JPEG. The app's browser check writes two small WebP squares in
  fixture-api.ts.
- **Accounts and posts.** apps/api/test/integration's existing helpers (flow-harness.ts, auth-fixtures.ts) make the
  accounts; a helper in the new activity tests makes a pair with each relation (follows, mutes, blocks either way).
- **Crawlers.** infra/caddy/lab/crawlers.json (new) holds the request shapes of six unfurlers as their official pages
  give them (inputs 3.2 and 3.3): the User-Agent strings of Twitterbot, facebookexternalhit, Slackbot-LinkExpanding,
  Discordbot, LinkedInBot and Mastodon's fetcher, with Meta's `Range: bytes=0-524288` and Slack's range request,
  `Accept-Encoding: gzip, deflate`, and no cookie. The card lab and the smoke test read it (12.4).

### 12.2 Unit tests

- packages/contracts/test/mentions.test.ts: `MENTION_TOKEN` and `mentionHandles`: the right boundary (a 26-character
  run is no mention), an e-mail address, `_` and digits at either edge, case folding, order, repeats, the 40-handle scan
  cap, a `retired_` handle, a handle beside punctuation and line breaks.
- packages/contracts/test/activity.test.ts: every shape of 9.3, the cursor's round trip, `ACTIVITY_KEEP_DAYS` and
  `ACTIVITY_MIN_AGE_HOURS`.
- packages/contracts/test/social.test.ts: `PostCounts` with null likes and reposts; `Author.avatar`.
- packages/media-protocol/test: `avatarJob` paths; result version 3 accepted with `avatar: true` only on a ready result;
  version 4 refused.
- apps/worker/test/pipeline.test.ts: each crop position on the portrait and the landscape fixture, the sizes 400 and
  128, the small fixture never enlarged, rotation applied before the crop, a malformed job file failing as
  `processing_failed`, a post's upload unchanged (two sizes of 2,048 and 1,024), the scorer fed the 400 square, and
  both squares carrying no EXIF or XMP (the EXIF-rotated fixture's metadata absent), which `AVATAR_WORDS.explain`
  promises (10.10).
- apps/api/test/media/files.test.ts: the job file written before the upload's rename; `storedUploads` listing an
  orphaned `<id>.avatar`, which the reconcile pass removes once older than `ORPHAN_AGE_MS` (7.2).
- apps/api/test/social/tiers.test.ts: the five new actions and their buckets (9.5).
- apps/api/test/cards.test.ts: `cardBlock` with section 8.5's hostile inputs, every length limit at its edge with
  four-byte characters, the tag order of 8.3, the 4,096-byte bound, the generic card naming no one, and
  `card.imported` (with `.shortened`) equal in shape to 3b's `import.label`, with each source's display name and the
  fixed UTC date.
- apps/api/test/architecture.test.ts: `MODULES` (line 28) gains `activity` (Task 2) and `cards` (Task 6), so each is
  entered only through its index; the one table of pins of 5.3 and the one insert into `post_mentions`;
  apps/api/src/staff/ and apps/api/src/moderation/ never import the activity module, beside the existing import rules;
  `STANDING_PREDICATE`'s counts per file (line 313) unchanged, since 2d's writes call `lockActing` and `judgeActing` or
  take no predicate (7.3, 9.2), and a builder who names a fragment anew states the new count in that task; the cards
  module reads no session.

### 12.3 Integration tests (apps/api/test/integration/)

- **activity-schema.test.ts.** Section 6: every CHECK and unique key; `activity_items_insert` forcing the time;
  `activity_state_guard` refusing a marker moved back or ahead of the clock; `post_mentions_insert` refusing a withheld
  or imported post's row and accepting one across a block; `post_mentions_erase`. Its avatar half (Task 3):
  `post_media_kind_place`, `post_media_avatar_owner` and `post_media_avatar_guard`; `post_media_insert` refusing a row
  inserted with `profile_id` set; `post_media_refused` refusing an avatar's set for each of its three arms (a refusal
  row, an erased row, a hold of infinity); `post_media_keep` keeping an avatar whose owner has a frozen account case;
  `post_media_purge` writing `state` for a detach, `deleted` for the purge's delete, nothing for a never-set or already
  detached avatar; the grants of 6.6 (no UPDATE on `activity_items` or `post_mentions`, no UPDATE of `kind` or
  `avatar_sha256`). Its moderation half (Task 4): `post_media_keep` keeping a sealed avatar that no hold keeps;
  `post_media_purge` writing `state` for a seal of a current avatar and `released` for a release; the REVOKEs on
  `seal_avatars`, `avatar_reviews` and `avatar_resets`.
- **http-activity.test.ts.** Each kind written and read; one entry per recipient and post (a reply that mentions its
  parent's author); the thread's root not told; the 10-mention cap; each setting (`everyone`, `older`, `following`,
  `off`) and the follow switch, with `older` refusing an actor 47 hours old and passing one 49 hours old; a mute
  stopping new entries and hiding old ones, an unmute showing them; a block either way deleting the pair's entries
  both ways and a block made between the lookup and the insert hidden at read; an unfollow hiding the follow entry and
  a re-follow writing none; a withheld reply hidden and shown again when restored, a removed
  and a disabled one hidden, a deleted one gone; a suspended actor's earlier entries kept and its new acts refused; a
  suspended recipient reading its list; follow groups by UTC day, with a page boundary inside a day giving one group;
  the tabs; the seen marker moving only forward, `new` against the stored value, `newer`'s cap of 21.
- **activity-moderation.test.ts.** A decision told to its author is an entry; one whose author was told nothing, one
  held for an order's notice, and one before the dispatch told it make none; a release with its notice held makes
  none until `releaseHeldNotices` runs; a refused upload and a lost image (through `lost_told_for`, after the dispatch)
  are entries; a staff note, a report about the recipient and a flag never appear; a decision told 91 days ago is no
  entry (Cases still lists it); the merge's paging across both sources is stable.
- **mentions.test.ts.** A stored mention links while its account holds the handle, and is plain text after a rename and
  after a retirement, the entry already written staying; a handle free when the post was written and claimed afterwards
  is not linked (no account then, so nothing stored); a mention of an account blocking the author, or blocked by it, is
  stored, links for a third reader, is plain text for the two accounts and writes no entry; a reader blocking the
  mentioned account sees plain text; a mentioned account purged while the post waits for its lock leaves no row; the 20
  stored; an imported post (3b's `publishImportedBatch`) stores none and tells no one; a deletion and an erasure remove
  the rows.
- **http-avatar.test.ts.** Upload with `kind=avatar` and each crop; set, replace and remove, each writing its outbox
  row; `not_an_avatar`, `avatar_not_ready`, another account's upload; a suspended account refused a new avatar and
  allowed to remove its own; the public cache header; a replaced and a deleted account's avatar not found for everyone,
  its owner included (a reset and a sealed one in avatar-moderation.test.ts, Task 4); the sweeper leaving the current
  avatar and deleting a held former one after its hold; an avatar using no pending slot,
  `DELETE /api/media/:id` on the current avatar answering `not_found`, and an avatar's id sent as a post's image
  answering the media error, not 500.
- **avatar-moderation.test.ts.** An account report's snapshot holding the avatar and its hold; `reset_avatar`'s
  compare-and-set (`profile_changed` after a new upload), its `no_effect` values, `restore_avatar` writing nothing;
  after a reset, the same file uploaded again refused with `avatar_reset` for 30 days and accepted after, and another
  file accepted at once; a reset and a sealed avatar not found for everyone, its owner included; the console's case
  page showing the held avatar and a frozen case showing the placeholder; an account case's seal
  listing the current and a held former avatar, their state `sealed`, `invalid_decision` only when both lists are
  empty, `unseal_media` restoring `visible`; its owner removing a sealed avatar that no hold keeps: the row and its
  files stay, and so do they under a replacement and the sweeper; `quarantine-list` naming a sealed avatar's two files;
  a release erasing them through `releases.avatar_ids`.
- **automation-avatar.test.ts.** With the scorer's test adapter, a score at the threshold on a set avatar opens the
  finding on the account's case with no measure, with `AUTOMATION_R1_ACTS` on and off; with it on, the avatar
  `withheld`: served to its owner only with `PRIVATE_CACHE`, absent from another reader's views and from the card, and
  shown again once a moderator answers the finding without a reset; with it off, shown throughout; a flagging match
  opening the finding the same way; an acting match refused at upload and `PUT /api/me/avatar` answering
  `avatar_not_ready`.
- **3c's gate S.** The test that walks the enumeration of `post_media`'s readers (3c design, section 11) gains a sealed
  avatar for each reader of 7.5.
- **http-cards.test.ts.** Every row of 8.4 through the route, with the status and the decoded block; the switch at its
  default (off, the generic card) and turned on; an avatar withheld for review never on a card; the status route still
  answering as before.
- **http-hide-counts.test.ts.** The composer's flag and the route; another reader's null counts in every view and in
  `EngagementResponse` (a second account likes a hidden-counts post and reads `counts.likes === null`, and again after
  unliking); the author's numbers; refusals of 9.2; a suspended author hiding counts and refused showing them.
- **account-export.test.ts and account-deletion.test.ts** gain the members of 11.2 (`received` holding a muted actor's
  row, a withheld post's row with `postId` null and an unfollowed follow, each with its `shown` reason) and the purge
  of 6.7; account-deletion.test.ts:207 stops expecting `avatarPath` (Task 3).
- **activity-retention.test.ts.** Rows of 89 and 91 days; batches; the job's lock.

### 12.4 The card lab, crawler fixtures and the Caddyfile's model

- **The card lab** (infra/caddy/lab/card-lab.mjs and README.md, new), run once in Task 6's first step and again at its
  end, as 3f's first step checked the status route on this image: it builds the Caddy image, starts it with a stub API
  of a few lines that answers the card routes with 204 and a block, 404, 429, or not at all, and asserts each page's
  status and bytes (`card.html` with the block decoded once in its head, or the plain shell); that a block holding
  `{{ .Env }}` and `{{env "HOME"}}` is written out as text and never evaluated; that `/card.html` asked directly answers
  404; `robots.txt`'s bytes; `X-Robots-Tag` on `/post/`, `/u/`, `/settings/appearance` and a `handle_errors` answer,
  and absent on `/`, `/rules`, `/transparency`, `/explore/about` and `/terms`; a push-network address answered 403 on
  `/u/x`; and that `caddy list-modules` lists `http.handlers.templates`. It sends each crawler of
  infra/caddy/lab/crawlers.json to both pages and asserts that the answers are the same for every User-Agent, that the
  Open Graph tags lie within the first 524,288 bytes and before `<title>`, that a ranged request gets a whole 200 with
  them (no 206), and that the served `<title>` is "korbat". Its measurements are recorded in Task 6's summary.
- **The smoke test** (scripts/smoke-auth-stack.mjs) does the same for one real post and one real profile on the rebuilt
  stack, with Twitterbot's User-Agent: the generic card while the account's previews are off (the default), the full
  card once it turns them on, and for a display name set to `{{env "HOME"}}` by its own account.
- **The Caddyfile's model.** apps/app/test/browser/caddyfile.ts (the browser check's reading of infra/caddy/Caddyfile,
  through apps/admin/test/caddyfile.ts) learns, in Task 6 with the Caddyfile itself, the `/u/*` handle as a page route
  served like `/post/*` and the `@named` line of `X-Robots-Tag`, so the browser check serves every page under the
  headers Caddy really sends. apps/admin/test/console-site.test.ts:227-228 asserts the push network's 403 on `/post/x`
  and `/u/x` too.

### 12.5 The app's tests and the browser check

- apps/app/test/activity.test.tsx: each entry's row, accessible name and words, the two headings, the pill's three
  forms, a follow group's name links and "See your followers", a post entry's Reply action, the empty and end states,
  the tabs in the address; Settings, Activity saving a settled choice once.
- apps/app/test/avatar-picker.test.tsx: the crop choices by shape, the preview's position and name, the upload and set
  sequence with its status line, a refused, a failed and a reset upload as error lines, the removal's confirm dialog,
  and where focus goes after each.
- apps/app/test/post-card.test.tsx: stored, unstored and imported mentions; null counts, kept null by a like's
  optimistic update.
- apps/app/test/shell.test.tsx: the nav's items at each width (four on a phone, five on wider screens); no count,
  dot or extra word on any item at any state of the fixture.
- apps/app/test/kit.test.tsx: `Avatar` with `src`, and its fallback to the monogram on an error.
- apps/app/test/a11y.test.tsx scans the new files; apps/app/test/terms.test.tsx holds the terms' new sections.
- The browser check's steps 52 to 57 (10.9).

### 12.6 Gates

- Every task: typecheck and unit tests of each package it changes (`pnpm --filter <package> typecheck` and `test`);
  a task that changes packages/contracts also runs the app's and the console's typecheck, so a contract change and its
  consumers land together (9.3).
- Batch ends: the runner's whole integration suite, as every sub-project's batches, and the app's typecheck from Task
  1 on; from Task 5 on, also `pnpm --filter @korbat/app test:browser`.
- Stack tasks: the stack rebuilt and scripts/smoke-auth-stack.mjs run, which gains an avatar set through the real
  worker (Task 3) and a card read through the real Caddy with Twitterbot's User-Agent (Task 6).

## 13. Tasks

Seven tasks in build order, in five batches: Tasks 1 and 2, Task 3 alone, Task 4 alone, Tasks 5 and 6, and Task 7
alone. Each runs the gates of 12.6. Before Task 1, this design is committed as
docs/superpowers/specs/2026-10-22-engagement-2d-design.md, and the names it takes from 3b (`posts.import_job_id`,
`PostView.imported`, 3b's last migration, its export members, `publishImportedBatch`, and the JavaScript cap its Task 7
leaves) are checked against 3b's replay; any difference is an amendment of section 15 before Task 1. Contract changes
land as 9.3 says.

**Task 1. Contracts and the database for Activity and mentions.** Goal: sections 4.1, 6.1 to 6.3, 6.6 and the
`post_options` columns of 6.4, and the two new contract modules of 9.3. Creates packages/contracts/src/activity.ts and
mentions.ts; packages/db/src/schema/activity.ts; the migrations `activity` and `post_options` with their meta
snapshots. Changes packages/contracts/src/index.ts; packages/db/src/schema/content.ts (`hide_counts`), identity.ts
(`share_previews`), index.ts; apps/api/test/integration/standing-grants.test.ts (`share_previews` among the profile
columns the API may update) and moderation-schema.test.ts (`hide_counts` among the posts' column grants), which pin
the grants this task changes. Tests: packages/contracts/test/mentions.test.ts, activity.test.ts;
packages/db/test/schema.test.ts (three tables more), enum-literals.test.ts (the two new enums created whole);
apps/api/test/integration/activity-schema.test.ts (its Activity and mention half). Not a batch end; no stack rebuild.

**Task 2. Mentions and Activity in the API.** Goal: sections 4.2 to 4.4, 5, 9's Activity, hide-counts and link-preview
routes with their contracts (9.3), and the export's and purge's parts of 11.2 and 6.7 for them. Creates
apps/api/src/activity/ (index.ts, repo.ts, flows.ts, retention.ts). Changes packages/contracts/src/social.ts, auth.ts
and account.ts; apps/api/src/social/repo.ts (`createPost` with mentions and entries, `follow`, `deletePost`, `block`,
`purgeProfile`, the hide-counts update, `setSharePreviews`), social/flows/posts.ts, social/views.ts (mentions,
`countsHidden`, null counts in every view and in `EngagementResponse`), social/routes.ts (`PATCH /posts/:id/counts`,
`/me/share-previews`), social/tiers.ts (the actions and buckets of 9.5), social/index.ts;
apps/api/src/auth/flows/account.ts and apps/api/src/profiles/store.ts (`sharePreviews` in `me()`);
apps/api/src/moderation/author.ts (`authorActivity`), moderation/index.ts; apps/api/src/account/flows/export.ts
(`activity` with `shown`, `mentions`, `countsHidden`, `sharePreviews`); apps/api/src/app.ts (the module's routes),
apps/api/src/index.ts (the module and `activity-retention`); apps/api/test/architecture.test.ts (`MODULES` gains
`activity`; the table pins of 5.3); apps/api/test/integration/standing-route-walk.test.ts (`SUSPENDED_WRITES` gains this
task's write routes, 9.4); and, so that the app compiles with the changed shapes, its readers and builders of
`PostView`, `PostCounts` and `MeProfile`: apps/app/src/components/social/PostCard.tsx (a null count drawn as no number),
lib/post-actions.ts (a null kept null), lib/feed-cache.ts, app/post/[id].tsx, apps/app/test/browser/fixture-api.ts and
the app's tests that build a `PostView` or a `MeProfile`. Tests: packages/contracts/test/social.test.ts (null counts);
apps/api/test/social/tiers.test.ts; apps/api/test/integration/http-activity.test.ts, activity-moderation.test.ts,
mentions.test.ts, http-hide-counts.test.ts, activity-retention.test.ts; account-export.test.ts and
account-deletion.test.ts extended; the existing social tests updated for the nullable counts. Batch end (Tasks 1 and 2):
the whole integration suite and the app's typecheck. No stack rebuild.

**Task 3. Avatar images.** Goal: section 6.4, section 7 without the moderation of 7.6 and 7.7, and 9's avatar routes
with their contracts. Creates the migration `avatars` with its meta snapshot;
apps/api/test/integration/http-avatar.test.ts. Changes packages/contracts/src/media.ts (`MEDIA_KINDS`, `AVATAR_CROPS`,
`UploadQuery`, the two error codes), social.ts (`AvatarView`, `Author.avatar`, `ProfileView.avatar`), auth.ts
(`MeResponse.avatar`), account.ts (the export's `avatar`); packages/db/src/schema/content.ts (`kind`, `profile_id`,
`avatar_sha256`, the checks and indexes), identity.ts (`avatar_path` gone); packages/media-protocol/src/layout.ts,
limits.ts, result.ts; apps/worker/src/pipeline.ts and loop.ts; apps/api/src/media/flows/upload.ts, flows/serve.ts,
files.ts (`avatarJob`, `storedUploads`, the avatar's SHA-256), repo.ts (7.2, 7.3, 7.5), sweeper.ts, index.ts;
apps/api/src/social/routes.ts, flows/profile-edit.ts (`PUT` and `DELETE /me/avatar`), social/views.ts (`avatarsOf`'s
callers), social/repo.ts (`setAvatar`, `removeAvatar`, `avatarPath` gone from the purge); apps/api/src/app.ts
(`/api/me`'s `avatar` from `avatarsOf`); apps/api/src/account/flows/export.ts (the avatar's file);
apps/api/test/integration/standing-route-walk.test.ts (the avatar routes), standing-grants.test.ts (`avatar_path` gone),
moderation-schema.test.ts (`profile_id`'s grant on `post_media`), account-deletion.test.ts (no `avatarPath`) and
apps/api/test/lab/standing.lab.ts:129 (its `avatar_path = null`); the app's builders of `Author`, `ProfileView` and
`MeResponse` (fixture-api.ts and the app's tests), so the app compiles; scripts/smoke-auth-stack.mjs (an avatar set
through the real worker). Tests: packages/media-protocol/test, apps/worker/test/pipeline.test.ts and loop.test.ts,
packages/contracts/test/media.test.ts and social.test.ts (`Author.avatar`), packages/db/test (`avatars` creates
`media_kind` whole), apps/api/test/media/files.test.ts, the new integration file, media-sweeper.test.ts,
activity-schema.test.ts's avatar half. Batch end (Task 3 alone): the whole integration suite and the app's typecheck.
Stack rebuild: yes (the worker's protocol and the API change together) and the smoke test.

**Task 4. Moderation of avatars.** Goal: section 6.5, 7.6, 7.7, the seal's and the review's parts of 7.5 and 7.8, and
the measure's contracts; every list of the measures of 6.5. Creates the migrations `avatar_kinds` and
`avatar_moderation` with their meta snapshots; apps/api/test/integration/avatar-moderation.test.ts and
automation-avatar.test.ts; apps/api/test/measure-lists.test.ts. Changes packages/contracts/src/moderation.ts
(`ACTION_KINDS`, `MEASURES` with the target `"avatar"`, `MEASURE_KINDS`, `REVERSAL_KINDS`), media.ts (`avatar_reset`);
packages/db/src/schema/moderation.ts (`actionKind`'s values, `seal_avatars`, `avatar_reviews`, `avatar_resets`,
`releases.avatar_ids`); apps/api/src/media/flows/serve.ts and repo.ts (the review's owner branch, `avatarsOf`'s),
cases.ts (`MediaForCases.hold` gains the avatar), index.ts; apps/api/src/social/repo.ts (`setAvatar`'s reset check);
apps/api/src/moderation/automated.ts (`avatarSet`, the account branch of `automatedStep`, R1's hold for review),
automated-repo.ts, decide.ts (`ROUTE_KINDS` by name), repo.ts (`MEASURE_KINDS_SQL`, `REDACTABLE`), statement-repo.ts,
statement.ts, author-repo.ts (`MEASURES`), the account snapshot's code, index.ts; apps/api/src/cli/custody.ts;
packages/rules (statement.ts's fields, the measure's sentences with the 30 days, 3d's finding words for a profile
picture); apps/app/src/components/moderation/StatusSheet.tsx, lib/terms.ts and lib/moderation-words.ts
(`DECISION_WORDS.avatar`); apps/admin/src/compose.ts and screens/Case.tsx (the composer's measure choice, the case
page's avatar). Tests: packages/contracts/test/moderation.test.ts; packages/db/test (one table more for each new table;
`avatar_kinds` adds two values to `action_kind`), enum-literals.test.ts (a describe block for 2d's migrations from
`avatar_kinds` on); packages/rules/test/statement.test.ts; the three new test files; activity-schema.test.ts's seal arm
of `post_media_keep`; 3c's gate S walk with a sealed avatar for each reader of 7.5; apps/admin's case and composer
tests; apps/app/test/status-sheet.test.tsx and terms.test.tsx. Batch end (Task 4 alone): the whole integration suite
and the app's typecheck. No stack rebuild.

**Task 5. The app.** Goal: section 10, without the cards. Creates apps/app/src/app/activity.tsx,
app/settings/activity.tsx, components/activity/PostEntry.tsx, FollowsEntry.tsx, ModerationEntry.tsx and
GettingStarted.tsx, lib/activity.ts, lib/activity-words.ts; apps/app/test/activity.test.tsx and
avatar-picker.test.tsx. Changes apps/app/src/components/AppShell.tsx, icons.ts, kit/Avatar.tsx,
components/social/RichText.tsx, PostCard.tsx, the composer (components/social/composer/),
components/social/FeedList.tsx, app/settings/index.tsx (the row), settings/profile.tsx (the picker and its confirm
dialog), settings/privacy.tsx (the switch and the sentences), lib/social.ts, lib/ui-words.ts (with `profile.settings`),
lib/settings-words.ts, apps/app/test/browser/fixture-api.ts, app.browser.ts (steps 52 to 57, and lines 622-623 if
decision 27 raises the cap); post-card.test.tsx, shell.test.tsx, kit.test.tsx, a11y.test.tsx. Checks: the export's size
against decision 27's 20,480 bytes and the cap in force, recorded in the task's summary. Not a batch end; no stack
rebuild.

**Task 6. Share cards, indexing and the terms.** Goal: sections 8 and 11.3. Creates apps/api/src/cards/ (index.ts,
build.ts, words.ts), apps/api/test/cards.test.ts, apps/api/test/integration/http-cards.test.ts, infra/caddy/robots.txt,
infra/caddy/lab/ (card-lab.mjs, crawlers.json, README.md). Changes apps/api/src/app.ts (the card routes beside the
status route), apps/api/src/middleware/security-headers.ts (`X-Robots-Tag`), infra/caddy/Caddyfile (`/post/*`, `/u/*`
with `respond @push 403` and `request_header -Range`, `handle_errors`, the `@named` line of `X-Robots-Tag`),
infra/caddy/Dockerfile (`card.html` and its check, `robots.txt`), apps/api/test/architecture.test.ts (`MODULES` gains
`cards`), apps/app/test/browser/caddyfile.ts (the `/u/*` page route and the `X-Robots-Tag` line, with the Caddyfile they
model), apps/admin/test/console-site.test.ts (the 403 on `/post/x` and `/u/x`), packages/rules (the terms' drafts of
11.3), apps/app/test/terms.test.tsx, scripts/smoke-auth-stack.mjs (the cards, previews off and on). Checks: the card
lab at the task's start (the module and the placeholder on caddy:2.11.4) and at its end. Batch end (Tasks 5 and 6): the
whole integration suite and the app's browser check. Stack rebuild: yes, and the smoke test.

**Task 7. The record.** Goal: the documentation. Changes README.md: a section Activity (what is written, the settings
with the age choice, the seen marker, what is never shown, 90 days), avatars under The interface (the picker, the
sizes, the checks, R1's hold for review, a reset picture refused for 30 days), Share cards and search engines (the
cards, the switch off by default, `robots.txt` with its named agents and why, `X-Robots-Tag`, what other platforms
keep), the budgets' paragraph with 2d's measured size and the cap in force, the upgrade notes (the five migrations),
Before going public (counsel's review of 11.3 and its six questions, word for word); the main design's section 9 gains
a dated amendment for 2d (delivered, what changes in its lines 97, 103, 113 and 225 and in the 2026-09-30 amendment,
the owner's decisions of section 2, left for later, status and order: next 4 hardening, 5 native builds); the UI
design's section 14 marks its 2d line done; this design's section 15 receives the dry run's amendments. Tests: none
new; the whole gates once. Batch end (Task 7 alone): the whole integration suite and the browser check. No stack
rebuild.

## 14. What is left for later

- **Sub-project 4, hardening.** Owner-scoped row-level security for `activity_items`, `activity_state` and
  `post_mentions`, as for every table; counsel's review of the terms' drafts of 11.3 and its six questions (decisions
  11, 20, 21 and 28, the hashes of avatars and `reset_avatar` under Art. 17 DSA), before korbat opens to the public;
  the per-address limits of the card routes if the global limit proves too tight for crawlers (decision 30); a check
  with Meta's Sharing Debugger and LinkedIn whether WebP cards unfurl (decision 22).
- **Sub-project 5, native builds.** The Activity screen, the avatar picker with the platform's own photo picker, and
  native push, whose design must keep decision 4 (nothing outside the screen) or reverse it explicitly with the owner;
  the app icon never carries a count unless that decision is reversed.
- **Possible later changes, each the owner's.** Reposts as Activity entries (decision 3); an opt-in word on the nav item
  (decision 4); an age choice for follows, beside On and Off (decision 7); an exact-handle check in the composer
  (decision 13); a free crop of the avatar (decision 14); a JPEG card variant (decision 22); a per-post switch for
  previews; mentions in bios and in quoted embeds; named suggestions of accounts by a published rule (decision 25); a
  header image on profiles, which 2d does not build; the avatar's own description, which korbat does not ask for
  because the avatar is decorative beside the name it stands for.
- **Expo SDK 58.** Server output of expo-router stays out; the card route of section 8 does not depend on it.

## 15. Amendments from the dry run

The dry run of 2026-10-28 to 2026-10-29 built the seven tasks in a scratch clone, one commit each, through the gated runner. Where the code differs from the text above, the code is right and the point is recorded here, in the order of the tasks that settled it (Tasks 1 to 7).

- **The CHECKs of post_mentions are named (6.3).** Section 6.3 names none. The code names them post_mentions_handle (the handle as written, `^[a-z0-9_]{3,20}$`) and post_mentions_position_range (`position between 0 and 19`, MENTION_STORE_MAX - 1), apart from the unique index post_mentions_position, whose name a CHECK may not reuse; the primary key keeps drizzle's name post_mentions_post_id_account_id_pk. activity-schema.test.ts holds the range equal to MENTION_STORE_MAX.
- **The seen marker is held to the clock only when it is written anew (6.2).** activity_state_guard refuses a seen_at later than now() on an insert and on an update that changes the marker, and refuses a marker set back to null or earlier than the stored one, each as activity_seen under 42501. An update that leaves the marker as it is, such as a change of the rules, is not compared with the clock, so a server clock set back never refuses a settings change. A changed account_id is refused by the guard as activity_seen and, before the guard is reached, by the API role's grants, which name only the five columns.
- **Activity's times keep the database's microseconds (5.7, 9.3).** ActivityEntry.at, ActivityPage.seenAt, ActivityNewerQuery.since and SeenRequest.at share one schema, ActivityTime (`z.iso.datetime({ precision: 6 })`: UTC with exactly six fractional digits), the form to_char's `US` writes, because activity_items.created_at is the database's now() with its microseconds: a millisecond `at` sent back as the seen marker would fall short of an entry written later in the same millisecond, which would then stay new for ever.
- **The cursor of Activity is in the contracts (9.3).** Section 9.3 names no function for the cursor on (at, key). packages/contracts/src/activity.ts exports encodeActivityCursor({ at, key }) and decodeActivityCursor(word), written without Buffer since the contracts load in the web app too: the word is the time's twenty digits (YYYYMMDDHHMMSS and the six of the microseconds), `_`, the key's prefix letter, `_` and the rest of the key, every character within the moderation lists' cursor word `^[A-Za-z0-9_-]{1,400}$`. The encoder throws on anything that is not a place of the list; the decoder answers null for every word the encoder would not write (another form, a day or an hour that does not exist, another spelling of the same place), which the API answers invalid_request.
- **An entry's key is held to its source (9.3).** ActivityEntry checks each key: a post entry's is `e:` and an id; a follows group's is `f:` and a real UTC day, the day of its `at`, with 1 to 3 actors and no more than its count; a moderation entry's is its kind's prefix (`d:` decision, `r:` release, `u:` upload, `l:` lost) over its own `id`. A moderation entry's `postId` and `postCreatedAt` are always present: the post's id and time when the target is a post, and null otherwise, rather than present only then.
- **The newer count may be asked with no time, and the contracts name what the screens share (5.8, 9.3).** ActivityNewerQuery's `since` is optional: while the screen shows no entry there is no newest time, and every entry counts. packages/contracts/src/activity.ts also exports ActivityNewerResponse (`{ count }`, 0 to ACTIVITY_NEWER_CAP), ACTIVITY_TABS (`all` and `conversations`, All by default in both queries) and ACTIVITY_DEFAULTS (Everyone for the three reaches, On for follows), which an account without an activity_state row reads and which are the table's column defaults.
- **lost_told_for's columns and order (6.5).** It returns TABLE(media_id uuid, post_id uuid, post_created_at timestamptz, lost_at timestamptz). A row's lost_at is the earliest loss among the image's files whose notice is neither pending nor none, so a file still pending neither makes nor dates a row; p_before is strict; rows come newest first and, among equal times, by image id descending, since the files lost in one transaction share its now(); a p_limit below 1 answers no row, and one above 100 answers at most 100.
- **A block hides an entry as a post the person may not see (11.2).** The export's `shown` names no reason of its own for a block: an entry about a post hidden by a block between the two accounts, which only a mention can leave behind in 5.6's race, says `post_not_visible` and carries `postId` null, since postAccess hides the post from the person while the block stands, and a follow hidden by a block says `unfollowed`, since the block removed the follow. When several rules hide an entry, the first of `actor_deleted`, `post_not_visible`, `unfollowed` and `muted` wins (the actor's state, then the post's, then the relation's, then the person's own choice), and a post the person may not see is named by no id whichever reason wins. ACTIVITY_NOT_SHOWN in packages/contracts/src/account.ts lists the four; apps/api/src/activity/flows.ts's receivedEntry decides.
- **The mention read is the social repository's (4.3, 5.3).** loadPostViews reads the page's linking mentions through `repo.mentionsFor`, one statement in apps/api/src/social/repo.ts over the posts the reader is shown, so post_mentions is named in that file alone; 5.3's allowance for apps/api/src/social/views.ts is not used, and the architecture test pins the table to social/repo.ts.
- **Where a moderation entry points (5.5.2, 9.3).** A decision about a post names the post and its time. A decision about an account names `account` when it holds one of 3e's measures of the account's standing or their reversals (the kinds MEASURES gives the targets account, handle and reporting: a strike, a suspension, a termination, a retired handle, the reporting measures, and what lifts each), and `profile` otherwise (a reset of the display name or the bio, and their reversals). A release and a refused upload name `account`: a seal's release may span several posts and opens by its own id, and a refused upload was on no post. A lost image names its post, which the entry opens.
- **Activity's times in the export (11.2).** `activity.seenAt` and each entry's `at` in `activity.received` are written to the microsecond, as the Activity screen's times are, while the export's other times stay to the millisecond, so the person can match an entry of the export to the one the screen showed; ExportFormat takes any precision for them.
- **The two switches end with the closing judgment (9.2).** Turning link previews on and showing a post's counts again take the acting row through lockActing (FOR NO KEY UPDATE for the profile's switch, FOR KEY SHARE when only the post changes) and end with judgeActing, as every write of the social repository that takes 3e's predicate does, so a suspension that starts while either waits refuses it; turning previews off and hiding counts take neither. STANDING_PREDICATE's counts are unchanged.
- **The hidden-counts route's answer has a contract (9.3).** PATCH /api/posts/:id/counts answers CountsResponse (`{ countsHidden }`) beside CountsRequest, both in packages/contracts/src/social.ts; 9.3 named only the request.
- **AvatarView lives in media.ts (9.3).** packages/contracts/src/media.ts defines `AvatarView` (`{ small, large }`, the two paths `mediaPath` makes) beside `MediaView`, not social.ts: auth.ts's `MeResponse` carries it too, and social.ts already reads auth.ts, so a definition in social.ts would make the two modules read each other while they load. social.ts and auth.ts both import it from media.ts. The request and answer of the avatar's routes are social.ts's `AvatarRequest` (`{ mediaId }`) and `AvatarResponse` (`{ avatar: AvatarView | null }`), the answer of both PUT and DELETE.
- **An avatar's upload needs its crop (7.2, 9.4).** `UploadQuery` refuses `kind=avatar` without `crop` as it refuses `crop` without `kind=avatar`, both invalid_request before the body is read: the picker always sends one, so an avatar never waits on a default. A repeated parameter arrives as a list and is refused; any other parameter is dropped, as the route read no query before. `kind=post` is accepted and means what no kind means.
- **The freeze's account arm is a function of its own (6.4).** 0051_avatars adds `account_frozen(account)`, a plain STABLE SQL function with frozen_for's second arm (an open case about the account with an unanswered suspect item), EXECUTE for the API role alone, as `post_frozen` has. `post_media_keep`'s new arm reads it in a statement of its own, and the media repository's disposal (`DISPOSABLE`) reads it for an avatar on no post, so that it does not take again, round after round, a row the trigger keeps: the API names `frozen_for` nowhere (apps/api/test/architecture.test.ts).
- **The purge detaches an avatar it cannot delete (7.8, decision 29).** `purgeOwner` deletes the account's image rows as before and then sets `profile_id` null on the account's avatar if `post_media_keep` kept its row (a frozen account case, a hold): from the purge on it is nobody's picture, and its detach writes the edge's outbox row (`state`) that its delete would have written (`deleted`). The disposal takes the row once nothing keeps it.
- **An avatar is exported only while it is the live account's picture (7.8, 11.2).** `EXPORTABLE` lists an avatar's row only while its `profile_id` names a profile that is not deleted, so the archive's files are the current picture's; a former avatar that a hold or a freeze keeps is in no export, as a deleted post's kept image is in none, and an avatar's upload never set (on no post for at most the sweeper's day) is not the account's picture either. The profile member's `avatar` comes from the media module's `exportAvatar` through `MediaForAccount`, and its file is one of `exportImages`, listed in `missingMedia` when it cannot be read.
- **A ready result whose mark does not match the row fails the upload (7.4).** Both writers of a verdict (`repo.finalize` and match.ts's `storeVerdict`) store a ready result only on a row of the kind its mark says (`resultKind`: `avatar: true` on a version-3 ready result is an avatar's, everything else a post's); on a row of the other kind the upload becomes failed with `processing_failed` (`failMismatch`), and nothing of the check of known material is written, rather than storing an image as an avatar's squares or the squares as a post's image.
- **attachAvatar does steps 2 to 4, and step 6 is dropFormerAvatar (7.3).** The media module's `attachAvatar(tx, accountId, mediaId)` locks and checks the upload, detaches the current avatar and sets the new one, and answers `{ avatar, former }`; setting the current avatar again changes nothing and detaches nothing. `detachAvatar(tx, accountId)` is removeAvatar's write. `MediaForPosts` also gains `dropFormerAvatar(id)`, the deletion after the commit, which asks for the files only when the row went (`deleteFormerAvatar` answers whether it did), and `avatarsOf`; `mediaForPosts(deps)` in apps/api/src/media/index.ts builds the interface for createMedia and the tests. The social repository's `setAvatar(accountId, write)` and `removeAvatar(accountId, write)` take the account's row and run the media module's write inside, as createPost's `within` attaches images.
- **avatar_not_ready covers every row that cannot be set (7.3 step 2, 9.4).** An upload of kind avatar that is not ready, not visible or erased answers avatar_not_ready, as one that is processing, failed or refused does; the guard's own refusal is never reached through the route. Its words, and not_an_avatar's, are in apps/api/src/media/context.ts's MESSAGES: the picture is not ready yet, wait or choose another; the image was uploaded for a post, choose the picture again as the profile picture.
- **The job file and the worker's strict read (7.2, 7.4).** The job file is one line of JSON with its newline, written as tmp/<id>.avatar and renamed into incoming/<id>.avatar before the upload's rename. A post's upload has no job file, so a missing one cannot be told from a post's; the worker fails an upload as processing_failed when an entry of that name is not a plain file, is over `MAX_JOB_BYTES` (256), or is not exactly `AvatarJob` (`{ v: 1, crop }`), before any decoder runs. The reconcile pass counts an upload and its job file as one id.
- **The worker's squares come from one decode (7.4).** The oriented square is rendered once to raw sRGB pixels of at most 400 px, never enlarged; large.webp is encoded from those pixels and the scorer is handed them, and the 128 px square is resized from them (not from the source), its pixels making small.webp and the blurhash. sharp orients the input before it extracts, so the crop is taken from the image as it is shown. Every file is a fresh encode, so nothing of the source's metadata survives and no WebP decoder is needed.
- **A page with reposts asks avatarsOf twice (7.5).** loadPostViews asks the media module once per page for every author it shows, quoted authors included; timelineItems asks once more, for the reposters, only when the page holds a repost. The profile lists ask once beside their other reads, the profile view once, and Activity's `authors` once with no viewer: an actor of a follow group is always another account.
- **The two migrations' numbers (6.8).** avatar_kinds is 0052_avatar_kinds.sql and avatar_moderation is 0053_avatar_moderation.sql, the next free numbers after Task 3's 0051_avatars. 0052 holds the two ALTER TYPE ... ADD VALUE statements and nothing else; enum-literals.test.ts reads every file from it on and refuses the two values as literals outside a PL/pgSQL body, and the runner's upgrade from 0048, which applies 0049 to 0053 in one transaction, passes.
- **The deciding transaction that answers an item is decisions_apply (6.5).** The items of a final decision are answered by the trigger decisions_apply (newest in 0030_authority_records), not by decisions_record, which only reads them. 0053 replaces decisions_apply from that text: after it answers the items it calls avatar_apply for every avatar avatar_reviews names under one of them, and where it derives again the posts of the interim seals that ended with the answer it derives their avatars too. Without the second change an avatar of an account seal taken while deciding would stay sealed after the admin's answer.
- **The keep trigger's seal arm is a function of its own (6.5).** 0053 adds avatar_sealed(media), a plain STABLE SQL function with frozen_for's seal arm for an avatar (a seal in force lists it in seal_avatars, and no release that lists it in avatar_ids has a notice other than held), EXECUTE for the API role alone, as account_frozen. post_media_keep reads it beside account_frozen, and the media repository's disposal (DISPOSABLE) reads it for an avatar, so that it does not take again, round after round, a row the trigger keeps.
- **What an account seal lists (6.5).** A seal_media on an account case lists every ready and unerased row of kind avatar the account owns, locked after the posts' images in id order: the current picture, a former one a hold keeps, and an avatar upload not set yet that the sweeper has not taken. A processing or failed upload is not listed: it has no files to move into the quarantine. invalid_decision is raised only when neither list holds anything.
- **The release and the quarantine take a seal's avatars (6.5, 7.7).** release_facts also asks every avatar the seal lists that no release lists yet, while its row is unerased, to have both its files in the quarantine. seal_release takes all such avatars with the release's first part (a seal lists an account's few), writes them to avatar_ids and erases them with the posts' images in one id order, and answers release_not_open only when both lists are empty. The confirmed params and releases_confirmed are unchanged: the avatars are the seal's own list, which no caller chooses. release_replay reads the avatars from the restored database's seal_avatars under the gap's seal (its target), since a replay's params name posts alone. quarantine_plan moves in an avatar a seal for good lists, returns one that no seal for good lists any more (not erased, not released, not a held upload) and destroys a released one; quarantine_counts dates them as a post's images; quarantine-list then names a sealed avatar's two files with no change to cli/custody.ts. seal_custody still counts a seal's posts' images only, and the console offers a release only for a seal that lists posts: a seal that lists avatars alone is released by no screen yet.
- **A case's evidence erases the avatar rows of 6.7.** erase_case_evidence (0018_retention) is replaced in 0053: before it releases the case's holds it deletes the avatar_resets rows of the case's resets and the avatar_reviews rows of the case's items, and counts them among the rows it changed. case_evidence_due_at keeps a reset picture's case at least 30 days after the reset stopped being in force, so the reset's own 30 days are over by then.
- **An account's report holds its picture on every ground (7.7).** MediaForCases.hold takes a pair { caseId, accountId } that locks the account's current avatar in the intake's one statement and id order, places the case's hold on it and answers it under the account's id; the snapshot's media is [{ id, alt: null, width, height }], and stays null for an account without a picture, as before 2d. latestSnapshot also answers its media's ids, so a picture set, changed or removed is a new snapshot. The staff snapshot route (snapshotIn) holds and copies the picture the same way, and an owner pair of a suspect report also locks the owner's avatars.
- **The staff reader opens an account's picture (7.7).** staffAccess reads an avatar (its owner, no post) and calls it frozen while account_frozen holds for its owner; caseImage opens, on an account case, the picture of that case's own account that a snapshot of the case lists. The case answer's imagesAllowed of an account case is no longer always false: it is not account_frozen(account). The console draws the newest snapshot's picture through the staff reader beside the display name and the bio, and in its place, while the case is frozen, the sentence PICTURE_NOT_SHOWN (only when the snapshot lists a picture).
- **The author's decision screen names the reset picture without drawing it (7.7).** The design has the screen show the snapshot's picture under DECISION_WORDS.avatar, while 7.5 serves a reset picture to nobody, its owner included. No new reader of post_media is added: the screen shows the label 'Profile picture' with DECISION_WORDS.avatarNotShown ('Removed by this decision. korbat keeps it with the case and shows it to nobody, you included.') when the decision holds reset_avatar, and no image. So a reset picture's statement never says that the decision's screen shows the old value: its oldValueKept is always false, in the API's statement and in the console's preview.
- **The statement's words for the picture (7.6, 7.7).** A reset that removed the picture reads 7.7's sentence word for word, while deciding and for good alike; one of an account without a picture reads 'korbat reset your profile picture. Your account had no profile picture, so this changes nothing now.', and one of a deleted account the field's deleted sentence. restore_avatar and an ended reset read restore_display_name's sentences with 'profile picture'. A person's decision after a program's finding on an account's case says 'this profile picture' for the image (STATEMENT_WORDS.automated.found.avatar and the comparison's subject). An account seal that listed avatars says so (StatementMeasure.sealed gains an optional avatars count and STATEMENT_WORDS.sealAvatars); the console's preview of an account seal omits that sentence, since the case answer counts no avatar.
- **The reset's 30 days are a constant (7.7).** packages/contracts/src/media.ts gains AVATAR_RESET_DAYS (30), which the statement prints and the console names; 0053 writes a reset's until as now() + make_interval(days => 30), and avatar-moderation.test.ts holds the two equal.
- **Where the reset check runs (7.3 step 2, 9.4).** The refusal avatar_reset is the media module's attachAvatar, inside setAvatar's transaction after the upload row's lock: it reads the row's avatar_sha256 and avatar_resets (this account, the same hash, until ahead). Its API message is AVATAR_WORDS.resetRecently's sentence; the app's words module is Task 5's.
- **The program's account branch (7.6).** avatarSet reads the picture through MediaForCases.signals' avatar form { avatarId, ownerId }, which answers it only while it is that owner's live profile's ready and unerased picture; automatedStep takes the account branch for a signal on an avatar (its owner read before the transaction through the media module's avatarOwner) and handles it gone when the picture is no longer set. A flagging match's finding cites no rule and a listed match's R2, as for a post's image. avatar_review refuses (invalid_review) anything but an unanswered item of a program's finding under R1 about the avatar's owner, and keeps one row an avatar.
- **The console's measure lists (6.5).** The composer offers 'Reset profile picture' on an account case while deciding and for good, after the field resets and, in a final decision, after 'Retire the handle' (the ledger's order). Its no_effect prediction reads the newest shown snapshot's media, since the case answer names the account's fields and not its picture; the database decides already from the account's own rows. cli/records.ts hands a seal's avatars over in handover-list after its posts' files; notification-facts lists posts only, since no produced kind of 3f's list names an image.
- **The static card is PostCard's quiet variant (5.5.3, 10.2).** 3b's StaticCard takes no PostView, so PostCard gains `quiet`: the post as every card draws it (the actor's 40 px avatar, the author line with the time as the one link to the post, the body with its stored mentions and its links, the images, the body as the open target for pointers), with Reply its only action and no Repost, Like, Save or More, and no article or divider of its own, since the entry's article names it. Reply opens the thread with its reply card open (`/post/<id>?reply=1`), as the feed's Reply does, rather than a composer in place. The entry's line ('Ada replied to your post, 3h ago', activity.entry.name's words) stands above the card in meta, hidden from assistive technology because the article's name says it; the actor's avatar is the card's own, not a second one in the line.
- **A follow group's links are its avatars (10.2).** activity.follow.many names one account and follow.two two, so the line cannot hold three name links: each of the up to three accounts is a 44 px link on its 32 px avatar, named by its display name, to its profile, and the line is text, hidden from assistive technology as the article's name says it. A group of more than three ends with 'See your followers' (/u/<own handle>/followers). The row itself is not pressable.
- **A lost image's entry says nothing of Cases (5.5.3, 10.2).** ModerationEntry is a link row with the scales, the line and the time the person was told, and activity.moderation.open ('Open in Cases') as its trailing words for a decision, a release and a refused upload, which open their screens under Settings, Cases; a lost image's row opens its post and shows no such words.
- **Every Activity row is a focusable article (10.2).** Each entry's article carries tabIndex -1 and the inset focus ring, so the focus can move to it by script: after the pill or a refresh to the list's first entry (the list is brought to its top first), after Load more to the first entry the page brought. The headings 'New since you last looked' and 'Earlier' are h2s in body-strong, ink-medium, beside a 1 px line in line-high, and are drawn only when the visit has something new.
- **Activity's pill is the feed's (10.2).** NewPostsPill takes its words (`wordsFor`, activityPill's '1 new', '{n} new', '20+ new' from the count's cap of 21) and its name's template (`label`, activity.pill.label); its one polite announcement reuses the feed's feed.pill.announce ('{visible} above'), and once the reload brings the count to zero it says 'You're all caught up' for two seconds, as on Home. The poll is lib/new-posts.ts's clock (30 s, then 60 s after each answer), active only while the screen is focused, the page visible and the first page in.
- **The seen marker after a reload (5.7, 5.8).** The pill and a refresh read the first page again and keep its seenAt as the visit's marker, so entries new since the marker the screen sent show under 'New since you last looked'; the screen sends the marker again with that page's newest time when something on it is new. Later pages are marked new against the visit's marker, compared as six-digit strings.
- **The confirm dialog is AskSheet with a sentence (10.5).** The kit has no confirm dialog: 'Remove picture' opens 3b's AskSheet (components/import/ImportProgress.tsx), which gains an optional `description` passed to Sheet, so the question (AVATAR_WORDS.confirmTitle), its sentence (confirmBody), Remove (confirm, in danger) and Cancel stand together; the focus goes to 'Choose a picture' only after a removal, and a sheet closed without one gives it back as Sheet does.
- **The picker's logic is lib/avatar.ts (10.5).** The crop choices by shape (cropChoices, with expo-image's contentPosition top, center, bottom, left or right over the local file and object-fit cover), the preview's name (previewName), the upload, its poll every second for at most six minutes and the PUT (sendAvatar, with avatar_reset read as the reset line), and the focus after each (pickerFocus) are pure functions in a new file; Settings, Profile draws the card (AvatarCardView, the state in AvatarCard). The chosen file is checked by 2b's refusal() before anything is sent, its size read by the browser to name the choices, and Middle is chosen first. A refused upload is shown to nobody, its uploader included, so its preview goes with the refusal and the card shows the error line, the 'Why' link and the chooser again.
- **The composer's option is one switch row (10.6).** The composer had no options area: above the send bar, under a line-low rule, one of the kit's switch rows (ListRow), 'Hide like and repost counts', whose row is the 44 px pointer target and whose named Switch is the one control, off for every new post, reply and quote, sent as hideCounts and set back to off once sent; it is not drawn while the discard question asks. The mentions line (activity.composer.mentions) sits under the field, in meta, ink-medium, while the text holds a handle by a fresh copy of MENTION_TOKEN (lib/activity.ts's hasMention).
- **pickImages takes `{ multiple }` (10.5).** lib/pick-images.ts always allowed several files; it now takes `{ multiple = true }`, and the avatar picker asks for one.
- **On a phone a settings page marks no nav item (10.1).** With Settings off the phone's tab bar, its settings pages mark no item current: aria-current='page' on Profile would call the settings page the profile, and the settings row under each page's title already says where the reader is. The shell test and the browser check's layout steps hold it (360 px: none on Cases, a decision, the Settings index, Appearance and Security).
- **The More menu's counts item (10.6).** For the author, Hide like and repost counts (EyeOff) or Show like and repost counts (Eye) stands after Copy link and before Delete; lib/post-actions.ts's toggleCountsHidden flips countsHidden at once in the post's own 'counts' lane, takes the server's answer, and puts it back on a refusal (a suspended author showing counts gets the standing's sentence under the card, any other refusal a rollback toast with the API's words). Who sees this adds reach.countsHidden before its last line for the author alone.
- **Link previews' card (10.8).** Privacy's new card holds the switch row (PRIVACY_WORDS.previewsSwitch as its label and name, previewsExplain under it), saved as Explore's switch is (POST on, DELETE off, the session read again, the old state back with the error on failure), and the note on search engines (PRIVACY_WORDS.search) as a line under the row in the same card.
- **Getting started below 1024 px (10.7).** The panel ends with AboutCard whole (its heading, its three lines and its three links) rather than the three lines alone; Latest is a button (it switches Home's tab, no address), the other rows are links, and feed.start.settings shows under the profile's row on phones only. feed.empty.following.* go, since an account's empty Following always shows the panel and Following has no signed-out form.
- **Avatar keeps the monogram per picture (10.4).** Avatar takes `src: AvatarView | null`; avatarFile picks small.webp at 32 and 40 px and large.webp at 64 and 96, with API_BASE before it, transition 0 and contentFit cover; a file that fails to load gives way to the monogram until the view carries another picture. The import's StaticCard and Appearance's sample keep the monogram.
- **The browser check's fixtures (10.9, 12.5).** The avatars' files are lossless WebPs of one colour written by fixture-api.ts's solidWebp (a VP8L header and five one-symbol prefix codes, 32 bytes whatever the size, a portrait 300 by 600 for the picker). Grace's and Linus's pictures are on Activity's entries only, so the steps before 52 keep their monograms; Ada's picture, once step 54 sets it, and a post's hidden counts are applied to every answer by a walker over the JSON. Activity's times are minutes before the walk started, so step 52 pins each entry's words and the form of its time ('5m ago') rather than the minute. Step 52 also leaves Home, Bookmarks, a profile, Settings and a post open past a poll's wait and finds no request to /api/activity; ROUTES gains /activity, /activity?tab=conversations and /settings/activity.
- **Pins that moved (12.5).** shell.test.tsx (the nav's items by layout, five wide and four on a phone), composer.test.tsx (the rail's links), rich-text.test.tsx (mentions as a list; the native card links the stored @ada), post-card.test.tsx (the author's More menu), kit.test.tsx (expo-image mocked for Avatar), explore.test.tsx (Following's empty text is the panel's Latest and Explore rows), theme.test.ts (the forty-first icon, activity: Bell), lifecycle.test.tsx, cases.test.tsx and appearance-page.test.tsx (Activity after Appearance in the settings row and the index, with its hint), appearance-page.test.tsx and standing.test.tsx (expo-image mocked, since Avatar draws through it), and the browser check's steps 7 (the nav's tab stops), 21 (the author's menu), 35 (eight index rows) and the layout steps (no current item on a phone's settings pages). Step 32 now waits for the removed post's chip before reading it: the profile asks for its posts only once the profile has answered, which a loaded machine left after the network's idle moment, with the export from before this task as well. Step 15 now waits, before the connection goes, until the number of Home's drawn rows has held for a second and the images those rows asked for (not one left to load lazily) and the fonts they use are in: on this machine the rows were drawn after the network's idle moment and their images and the mono face were then asked for offline, which the export from before this task met too after step 14. The README's line on the app's browser check says 57 steps (about fourteen minutes), since apps/admin/test/readme.test.ts holds it to the check's last numbered step; the rest of 2d's README record is Task 7's.
- **The focus after the pill and Load more waits for its row (10.2).** The gated runner's browser check failed step 52 at the focus Load more should move to the first entry it brought. The screen tried the focus once, in a timeout of 0 after the new page landed, but the list draws only a window of rows, in batches: with the CPU slowed four times the window was still around the 10th to 20th entries when the page landed (the Load more row, removed with the focus in it, took the scroll and the focus with it, and the list's keeper gave the focus to the screen's title), so the 31st row was not drawn, the query found no article and nothing tried again; a keyboard user on a slow phone would lose their place the same way. lib/activity.ts's retryFocus now tries at once and every 50 ms until the attempt says the focus landed, for at most 5 s, and answers a cancel. The screen's attempt focuses the row's article when it is drawn, and otherwise asks the list to draw the rows around it (ListHandle.jumpTo, which scrolls to the row's index), so the next try finds it; a waiting try is cancelled when a newer request (the pill, a refresh, another Load more) starts and when the list unmounts. The pill's and a refresh's focus on the first entry take the same path. activity.test.tsx holds the tries, the limit and the cancel with fake timers; step 52 passed with Chromium's CPU throttled four and five times, where the single try and the retry without the jump both failed.
- **The terms' drafts live in the app (11.3, 13 Task 6).** The terms' source is apps/app/src/lib/terms.ts, not packages/rules, which holds the rulebook only: the four drafts are the last four paragraphs of its 'Your data' (ENGAGEMENT_DATA), after 3b's import record, with ACTIVITY_KEEP_DAYS read from the contracts and printed as '90 days', TERMS_VERSION unchanged. apps/app/test/terms.test.tsx holds them, and its table of numbers, both number collections and the changed-constants mock gain ACTIVITY_KEEP_DAYS, so no number of the drafts is typed.
- **A read and an interface for the cards (8.1, 9.1, 13 Task 6).** No read gave the link-preview switch with a post or a handle (only the export's head read it, by id), so the social repository gains sharePreviewsOf(ids), the switch of live profiles only, and social/index.ts gains SocialForCards (post and profile) built as forActivity is: post goes through postView with no viewer, so postAccess decides it as for anyone signed out, and answers null when the author's profile is deleted; profile is findProfileByHandle and profileViewOf with no viewer. The cards module's deps are this interface and APP_ORIGIN.
- **An avatar on a card has no size (8.3 item 7).** AvatarView carries the two paths only and an avatar's large square is 400 px or less (never enlarged), so a card whose image is the author's or the profile's picture leaves out og:image:width and og:image:height; a post's image keeps its own MediaView size. Meta then renders the picture after its first fetch rather than at once.
- **The image's description gives way to the 4,096-byte bound (8.1, 8.5).** 8.5's three limits cannot all hold inside 4,096 bytes: with the title (70), the description (200, written twice) and the image's description (420) at their limits in four-byte characters the block is about 4,290 bytes, and in characters escaped to six bytes (an opening brace) about 6,020. cardBlock therefore cuts the image's description to 420 code points and then, with '...', to the room the rest of the block leaves (367 four-byte characters, or 97 braces, in those worst cases, 4,093 and 4,095 bytes); the title and the description are never cut for the bound. A block that cannot fit even so (an absurd APP_ORIGIN) throws rather than being sent cut, and Caddy then serves the plain shell with 200.
- **An imported post's description (8.4, 8.5).** The label and its full stop come first and the post's text is cut by 8.5's rule in the room the label leaves, so the cut never falls on a space of the label itself; an imported post without text says the label and a full stop. Each run of line breaks (CR, LF and the line and paragraph separators) becomes one space.
- **What a generic card carries (8.3, 8.4).** robots, og:site_name, og:type website, og:url (the address that was shared: the post's id, or the profile's handle as stored) and og:title ('A post on korbat' or 'A profile on korbat') and twitter:card summary only: no description, image, date or profile:username, so it names no one beyond the address itself.
- **The card route reads a handle as the profile's page does (8.1).** GET /api/cards/profile/:handle parses the handle with the contracts' HandleParam, so a leading @ and any case are read as GET /api/profiles/:handle reads them, and og:url names the handle as stored; anything else is 404 with no body before the social module is asked.
- **Caddy's form of 8.2.** templates sits in one snippet, card_page (root, rewrite to /card.html, templates, file_server), imported by the 204 handle_response of /post/* and of /u/*, the only two places it runs; @named is written as a block (`@named {` / `not path / /rules /transparency /explore/about /terms` / `}`) because the Caddyfile's readers take `not path` only so, and it applies to every file of the default handle (the bundles, theme-boot.js, robots.txt) as well as its pages; /card.html has a handle of its own, `respond @push 403`, the page headers, X-Robots-Tag and `respond '' 404`, the form both readers read as status 404 with no body; handle_errors' matcher is @pages, `path /post/* /u/*`, with X-Robots-Tag.
- **The card.html step (8.2).** The Dockerfile's web stage inserts the action line, indented as the head's other lines, after the line holding `<meta charset='utf-8' />` with awk (marker and action passed as variables, no shell escapes), and fails the build unless exactly one line holds `{{` and that line is the action; the final stage copies infra/caddy/robots.txt to /srv/robots.txt after the export.
- **The X-Robots-Tag of the API (8.2).** securityHeaders wraps hono's secureHeaders and sets X-Robots-Tag: noindex after the handler and the error handler answered, so every answer carries it, an image file's, a card's, a 404's and a 500's included; app.ts's chain is unchanged.
- **The cards are no counted reads (3d's RECIPIENT_READ_ROUTES).** The route table test's NOT_COUNTED gains GET /api/cards/post/:id and GET /api/cards/profile/:handle, which Caddy asks, beside the status route; they stand before the session's resolution, where nothing is counted.
- **The browser check knows the profile's page (10.9, 12.4).** apps/app/test/browser/caddyfile.ts reads a page handle's rewrite (the post's or the profile's card route; any other rewrite is an error) and gives /u/* its own route kind and headers; server.ts serves index.html for both under the status of the fixture API's postStatus or new profileStatus (the profiles GET /api/profiles answers, compared as the card route compares); step 2 gains /u/grace 200 and /u/nobody_here 404 and X-Robots-Tag on /post/ and /u/ and none on /. No step is added: 57 stay.
- **The console's pins of 3f move to the cards (12.4).** console-site.test.ts asserts the push 403 as the first line of /post/x's and /u/x's handles, the card rewrite and the three answers of both page handles, templates in those two blocks alone, handle_errors' @pages with noindex, /card.html's 404, the @named matcher, robots.txt byte for byte with crawlers.json's tokens as its named agents, and the Dockerfile's two steps.
- **The smoke test's step 17 (12.4).** A public post's page is card.html (the generic card while previews are off), so the deleted post's 404 and a missing or malformed id's are compared with /'s bytes, the plain shell, and both answers carry noindex; the status route's check stays. Step 23 is the cards with Twitterbot's request from crawlers.json, run before grant-role while the first account's token works, and it puts the display name and the switch back.
- **The card lab (12.4).** infra/caddy/lab/card-lab.mjs uses the Caddy image itself as the stub API (a Caddyfile copied into a created container with docker cp, no bind mount), whose blocks keep the template delimiters unescaped, to prove that Caddy prints a block as text even when nothing escaped it; its profile block is 4,096 bytes (5,464 in base64). crawlers.json's Slackbot range (bytes=0-32767) and LinkedInBot's User-Agent are not from an official page, and each carries a note saying so. Task 6's first step, before the lab existed, ran on a small image built FROM the pinned caddy:2.11.4-alpine with a Caddyfile of its own.
- **The main design's lines (3.1, 13 Task 7).** The 2026-09-30 amendment stands at lines 328 to 339 of the main design, not 327 to 338 as section 3.1 has it; its lines 97, 103, 113, 223 (row 2d) and 225 (row 5) are as section 13 names them. Row 2d gains its sentence "Delivered by sub-project 2d ...: see section 9, 2026-10-29" in place, as row 3b did, and the 2d entry of section 9 is appended after 3b's, so no line the design cites moves.
- **Lines 2d made false (13 Task 7).** Beyond section 13's list, the record corrects in place what 2d made false in the README: Posting and feed's Mutes (a mute silences Activity too) and its "Counts are public" (unless the author hides a post's like and repost counts, PATCH /api/posts/:id/counts); Moderation's measures ("Reset profile picture" with the display name's and the bio's resets); Profile and account's export (`activity` last, the profile's `avatar` and `sharePreviews`, each post's `mentions` and `countsHidden`, the current picture's file); the smoke test's paragraph (the picture through the real worker and the two cards); and the browser check's list of screens. `### A release` names as open, and fixes none of, the three points of an account's sealed pictures that no task built.
- **Counsel's six questions stand in a paragraph of their own (11.3, 13 Task 7).** The README's Before going public holds counsel's review of the four drafts (`ENGAGEMENT_DATA` in apps/app/src/lib/terms.ts, `TERMS_VERSION` unchanged) and the six questions of 11.3 word for word as a numbered list, in a paragraph after Counsel's list, whose line ends with a pointer to it that names no decision: apps/admin/test/readme.test.ts holds the decisions named on that line after "From importing posts:" to 3b's list.
- **Where the README puts 2d (13 Task 7).** Activity and Share cards and search engines are sections of their own after Explore and before Staff roles; the avatar is a bullet of The interface, Profile pictures, before Budgets; Upgrading's 2d paragraph comes first, above 3b's and 3f's, since 3f's part of Upgrading, from its own paragraph to the section's end, may hold no number but 3f's.
- **Task 7's gates (13).** The record changes no code, test, migration or package, so its batch end runs the whole integration suite once, alone, on a fresh test database, with the README's pins, the typecheck and the unit tests, and neither the app's browser check, which Task 6's tree passed and the final gates run again, nor a stack rebuild. Section 15 is filled by the orchestrator's script from the seven tasks' amendments, after Task 7's work and before its commit, rather than by Task 7's own edit.
