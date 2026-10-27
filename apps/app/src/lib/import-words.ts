import { RULES } from "@korbat/rules";
import type { ImportSource, ImportedLabel } from "@korbat/contracts";
import { fill } from "./ui-words";
import { localDay, utcDay } from "./time";

/**
 * Every sentence of the import screens, the provenance label and the Imported tab (3b design, sections 10 and 10.9), in
 * one words module, as the UI sub-project keeps every visible sentence (its section 1.5). `{n}` and the other braces are
 * filled by the screen through fill(); numbers go through Intl.NumberFormat and days and months through lib/time.ts. The
 * keys after the table's (each marked) are sentences the design's screens need and its table leaves out.
 */
export const IMPORT_WORDS = {
  "import.title": "Import posts",
  "import.nav": "Import",
  "import.intro":
    "Bring your own posts from another platform. They go on your profile's Imported tab, not into anyone's feed, and nothing is published until you confirm. People can still repost or quote them, as any post.",
  "import.found": "Anyone who searches the words of an imported post can find the original, and your account there. If korbat is where you stay anonymous, import only what you would post here today.",
  "import.unchecked": "korbat does not check who wrote an archive: import only your own.",
  "import.webOnly": "Importing works on korbat's website for now.",
  "import.whereFrom": "Where from?",
  "import.source.x": "X (Twitter)",
  "import.source.mastodon": "Mastodon",
  "import.source.bluesky": "Bluesky",
  "import.source.x.desc": "The archive from Settings, Your account, Download an archive of your data.",
  "import.source.mastodon.desc": "The archive from Preferences, Import and export, Request your archive.",
  "import.source.bluesky.desc": "The file from Settings, Account, Export my data. Text only: it holds no images.",
  "import.how.title": "How to get your archive",
  "import.how.x":
    "1. On X, open Settings, Your account, Download an archive of your data. 2. Confirm your password there, on X. 3. X emails you when the archive is ready, which can take a few days. 4. Download the .zip file.",
  "import.how.mastodon":
    "1. On your Mastodon server, open Preferences, Import and export, Data export. 2. Choose Request your archive. 3. When it is ready, download the .zip file. Servers older than version 4.2 give a .tar.gz file, which korbat cannot read.",
  "import.how.bluesky": "1. In Bluesky, open Settings, Account, Export my data. 2. Choose Download profile data. 3. Keep the .car file it saves.",
  "import.reads.title": "What korbat reads",
  "import.reads.body": "Only the files that hold your posts and their images. Of those, only your own public posts: not reposts, not posts for followers only, not direct messages.",
  "import.never.title": "What korbat never reads",
  "import.never.x": "Your messages, contacts, followers, likes, login history, ad data and deleted posts. These files stay unopened.",
  "import.never.mastodon":
    "Your direct messages and posts for followers only are in the same file as your public posts. korbat skips them by who they were addressed to, and keeps and logs nothing of them. Your likes, bookmarks, followers and profile files stay unopened.",
  "import.never.bluesky": "Your likes, follows, lists and profile. The file holds no messages.",
  "import.transit": "Your whole archive passes through korbat's server and its network provider on the way in. korbat deletes it when it has been read, at the latest within 24 hours.",
  "import.trim.x":
    "Before uploading you may delete from the archive everything except, in its data folder, manifest.js, the tweets files (tweets.js, the tweets-part files or tweet.js), note-tweet.js, twitter-circle-tweet.js, protected-history.js and the tweets_media folder. korbat never reads the rest.",
  "import.trim.mastodon": "Before uploading you may delete from the archive everything except outbox.json, actor.json and the media_attachments folder. korbat never reads the rest.",
  "import.trim.bluesky": "The .car file holds only your repository; there is nothing to delete.",
  "import.choose": "Choose your archive",
  "import.chosen": "{name}, {size}",
  "import.start": "Upload and read",
  "import.tooLarge": "Archives can be at most 2 GB.",
  "import.notArchive": "This file is not a {source} archive.",
  "import.tarGz": "This is a .tar.gz archive from a Mastodon server older than version 4.2. korbat can only read the .zip archives of newer servers.",
  "import.yours": "Your imports",
  "import.uploading": "Keep this page open while your archive uploads. It must finish within 24 hours of starting.",
  "import.uploaded": "{done} of {total}",
  "import.resume": "Your upload stopped at {done} of {total}. Choose the same file to go on.",
  "import.wrongFile": "This file is not the same size as the one you started with.",
  "import.reading": "Reading your archive. This can take up to 45 minutes. You can leave this page: your preview waits under Settings, Import posts, for 24 hours after reading.",
  "import.settings.ready": "Ready to review",
  "import.now.ready": "Your archive was read. Choose what to publish.",
  "import.now.failed": "Your archive could not be read.",
  "import.now.done": "Your posts were published.",
  "import.cancel": "Cancel import",
  "import.cancel.ask": "Cancel this import? korbat deletes the archive and everything read from it.",
  "import.cancel.keep": "Keep it",
  "import.found.posts": "{n} posts from {first} to {last}",
  "import.found.images": "{n} images, {kept} of them can be imported",
  "import.found.imagesOff": "Images are not imported on this site yet. Your posts come without them.",
  "import.samples": "Your newest posts, as they will look",
  "import.seeAll": "See every post",
  "import.list.leaveOut": "Leave this one out",
  "import.list.describe": "Describe this image (it is left out without a description)",
  "import.list.dimmed": "Left out by your choice: {reason}",
  "import.left.title": "What will be left out",
  "import.skip.repost": "Reposts of other people's posts",
  "import.skip.reply": "Replies to other people (you can include them below)",
  "import.skip.not_public": "Posts that were not public",
  "import.skip.older_version": "Earlier versions of posts you edited",
  "import.skip.poll": "Polls, which korbat does not have",
  "import.skip.adult_label": "Posts you labelled as adult content, which korbat's rules do not allow",
  "import.skip.too_long_to_read": "Posts too long to read",
  "import.skip.too_long": "Posts over 1,000 characters (you can shorten them below)",
  "import.skip.date_out_of_range": "Posts with a date that cannot be right",
  "import.skip.item_too_large": "Entries too large to read",
  "import.skip.unreadable": "Entries korbat could not read",
  "import.skip.empty": "Posts with nothing korbat can show",
  "import.skip.already_imported": "Posts you already imported",
  "import.skip.over_post_cap": "Older posts beyond the limit of 50,000",
  "import.skip.over_item_cap": "The archive was read in part: it holds more than korbat reads in one import",
  "import.skip.new_account_cap": "Older posts beyond 1,000, the limit until your account is 30 days old",
  "import.skip.warning": "Posts with a content warning (you can include them below)",
  "import.skip.protected": "Posts from when your account was protected (you can include them below)",
  "import.skip.left_out": "Posts you chose to leave out",
  "import.image.video": "Videos and animated images, which korbat does not have",
  "import.image.sensitive": "Images of posts you marked as sensitive",
  "import.image.unsupported": "Images in a format korbat does not take",
  "import.image.too_large": "Images over 20 MB",
  "import.image.missing_file": "Images missing from the archive",
  "import.image.bluesky_no_files": "Images, which Bluesky's export does not contain",
  "import.image.images_off": "Images, which this site does not import yet",
  "import.image.over_image_cap": "Images beyond the limit of 5,000",
  "import.image.failed": "Images korbat could not process",
  "import.image.not_checked": "Images that could not be checked in time",
  "import.image.not_chosen": "Images, which you chose not to bring",
  "import.image.no_description": "Images without a description",
  "import.image.flagged": "Images korbat could not accept",
  "import.cleaned": "Characters korbat cannot show were removed from {n} posts.",
  "import.sourceLinks": "Links to posts and profiles on {source} were replaced by words, because they show account names there.",
  "import.warnings": "{n} posts have a content warning. korbat cannot hide them behind it.",
  "import.choose.title": "Choose",
  "import.choose.all": "Everything",
  "import.choose.range": "A range of months",
  "import.choose.from": "From",
  "import.choose.to": "To",
  "import.choose.replies": "Include replies to other people",
  "import.choose.replies.desc": "They are published as posts of their own, without what they answered.",
  "import.choose.long": "Posts over 1,000 characters",
  "import.choose.long.leave": "Leave them out",
  "import.choose.long.shorten": "Shorten them to 1,000 characters",
  "import.choose.warnings": "Include posts with a content warning",
  "import.choose.protected": "Include posts from when your account was protected",
  "import.choose.protected.desc": "If your account on X was protected, its posts were not public then. Do not import them unless you mean to make them public.",
  "import.choose.images": "Bring images",
  "import.choose.images.desc": "Photos can be found by image search and can show other people.",
  "import.choose.images.noAlt": "{n} images have no description. Write one for each in the list of posts, or it is left out.",
  "import.choose.result": "This publishes {posts} posts and {images} images to your Imported tab.",
  "import.rules": "Imported posts follow korbat's rules like any post. One that breaks them can be removed and count against your account.",
  "import.rules.link": "Read the rules",
  "import.statement": "These are my own posts, and they were public where I posted them.",
  "import.statement.after": "If they are not, korbat can remove them, and it can count against your account.",
  "import.publish": "Publish {n} posts",
  "import.publish.needStatement": "Tick the statement to go on.",
  "import.publish.nothing": "Your choice leaves no posts to publish.",
  "import.keptUntil": "This preview is kept until {time}. Then the import is cancelled.",
  "import.started": "Import started",
  "import.preparing": "Preparing images: {done} of {total}",
  "import.publishing": "Publishing posts: {done} of {total}",
  "import.leave": "You can leave this page. The import goes on, and your posts appear on your Imported tab when they are ready.",
  "import.paused": "Your import is paused while your account is suspended.",
  "import.stop": "Stop import",
  "import.stop.ask": "Stop this import? Posts already published stay; you can remove them afterwards.",
  "import.stop.keep": "Keep going",
  "import.done": "{n} posts were published on your Imported tab.",
  "import.done.view": "See your Imported tab",
  "import.stopped.refused_image": 'This import stopped because korbat refused one image, in your post dated {date} that begins "{words}". Nothing from it was published.',
  "import.stopped.notice": "Read the notice",
  "import.stopped.textOnly": "Import the text only",
  "import.stopped.by_staff": "korbat's staff ended this import under {rule}. {n} posts were published before it stopped and are being removed.",
  "import.endedByStaff": "korbat's staff removed the posts of this import under {rule}. You can appeal the decision on its case.",
  "import.stopped.by_author": "You stopped this import. {n} posts were published before it stopped.",
  "import.stopped.time_ran_out": "This import ran out of time. {n} posts were published before it stopped.",
  "import.remove": "Remove imported posts",
  "import.remove.ask": "Remove all {n} posts from this import? This deletes them for everyone. It cannot be undone.",
  "import.remove.confirm": "Remove posts",
  "import.remove.keep": "Keep them",
  "import.removing": "Removing posts: {done} of {total}",
  "import.removed": "The posts from this import were removed.",
  "import.cancelled": "You cancelled this import. Its archive was deleted.",
  "import.expired": "This import was not finished within 24 hours, so korbat deleted it.",
  "import.again": "Start a new import",
  "import.failure.not_this_source": "This file is not a {source} archive.",
  "import.failure.not_an_archive": "This file is not an archive korbat can read.",
  "import.failure.tar_gz": "This is a .tar.gz archive from a Mastodon server older than version 4.2. korbat can only read .zip archives.",
  "import.failure.partial_archive": "This is one part of an X archive split into several, which korbat cannot read yet. Your posts are safe in your archive; try again after korbat's next update.",
  "import.failure.encrypted": "This archive is protected by a password, which korbat cannot read.",
  "import.failure.too_many_entries": "This archive holds more files than korbat reads.",
  "import.failure.too_large_uncompressed": "This archive unpacks to more than korbat reads.",
  "import.failure.bad_entry_name": "This archive has file names korbat does not accept.",
  "import.failure.unreadable": "Part of this archive could not be read. It may be damaged; download it again.",
  "import.failure.nothing_to_import": "korbat found no public posts of your own in this archive.",
  "import.failure.scan_timed_out": "Reading this archive took too long.",
  "import.failure.interrupted": "Reading this archive failed twice.",
  "import.active": "You already have an import in progress.",
  "import.unavailable": "Imports are paused for now. Try again later.",
  "import.limit": "You have published three imports this week. Try again later.",
  "import.limit.network": "Many imports were started from your network today. Try again tomorrow.",
  "import.tooSoon": "You can import posts once your account is 7 days old.",
  "import.label": "Imported from {source}, dated {date}",
  "import.label.shortened": ", shortened on import",
  "import.label.short": "Imported from {source}",
  "import.label.a11y": "Imported from {source}, dated {date}. About imported posts",
  "import.reach": "Imported posts are not in Latest, Following or Explore. They show on their author's profile, under Imported, and wherever someone reposts or quotes them.",
  "import.provenance":
    "Anyone who searches the words of an imported post may find the original and the account that wrote it. This account imported it from {source} on {imported}. The archive dates it {date} (UTC). korbat did not check who wrote it or when.",
  "import.tab": "Imported",
  "import.tab.empty": "No imported posts.",
  "import.explore": "Not in Explore: imported posts enter no feed on their own.",

  // 3b Task 7: sentences the screens need that 10.9's table leaves out (9.4's two own sentences among them).
  /** 9.4: wrong_state's and statement_required's sentences, which the table gives in 9.4 and not in 10.9. */
  "import.wrongState": "This import has moved on. Reload to see where it is.",
  "import.statementRequired": "Confirm that these are your own posts.",
  /** The source's short name, inside the label and the sentences that name it ("Imported from X"). */
  "import.sourceName.x": "X",
  "import.sourceName.mastodon": "Mastodon",
  "import.sourceName.bluesky": "Bluesky",
  /** Each state in words: the heading that starts its view (10.1) and its row under Your imports (10.2). */
  "import.state.uploading": "Uploading your archive",
  "import.state.scanning": "Reading your archive",
  "import.state.ready": "Ready to review",
  "import.state.preparing": "Preparing images",
  "import.state.publishing": "Publishing posts",
  "import.state.done": "Published",
  "import.state.stopped": "Stopped",
  "import.state.undoing": "Removing posts",
  "import.state.undone": "Removed",
  "import.state.failed": "Could not be read",
  "import.state.cancelled": "Cancelled",
  "import.state.expired": "Expired",
  /** A row of Your imports: the state's words and the day the import was started. */
  "import.row": "{state}, started {date}",
  /** The preview's first and last Sections' headings (10.4, What we found and Confirm). */
  "import.found.title": "What we found",
  "import.confirm.title": "Confirm",
  /** The polite sentence of the other changes of state (10.1's import.now.* for the states the table does not name). */
  "import.now.scanning": "Your archive was uploaded. korbat is reading it.",
  "import.now.publishing": "Your images were prepared. Your posts are being published.",
  "import.now.stopped": "This import stopped.",
  "import.now.undone": "The posts from this import were removed.",
  /** The upload's progress bar, which the value text completes ("120 MB of 840 MB"). */
  "import.bar.upload": "Archive uploaded",
  /** The failed screen's link back to the start (10.3). */
  "import.startAgain": "Start again",
  /** Why the list dims a line the choice leaves out (import.list.dimmed's {reason}). */
  "import.dimmed.month": "outside the months you chose",
  "import.dimmed.reply": "a reply to other people",
  "import.dimmed.long": "over 1,000 characters",
  "import.dimmed.warning": "a content warning",
  "import.dimmed.protected": "from when your account was protected",
  /** An image of the list of posts that has no description yet, as its name. */
  "import.list.imageNoAlt": "An image without a description",
  /** The list's next page of 50 lines, and the MonthPicker's way back from its sheet. */
  "import.list.more": "Show the next 50 posts",
  "import.month.done": "Done",
  /** The list's position, "Posts 1 to 50 of 1,240", above its lines. */
  "import.list.range": "Posts {from} to {to} of {total}",
} as const;

export type ImportWord = keyof typeof IMPORT_WORDS;

/** The source's short name, as the label and the sentences print it: X, Mastodon, Bluesky. */
export const sourceName = (source: ImportSource): string => IMPORT_WORDS[`import.sourceName.${source}`];

/**
 * A rule as the import's sentences name it (import.stopped.by_staff, import.endedByStaff): its id and its title from the
 * rulebook, as the rules page words a rule (lib/public-pages.ts); an id the rulebook does not know stays as it is.
 */
export function ruleWords(id: string): string {
  const rule = RULES.find((entry) => entry.id === id);
  return rule === undefined ? id : `rule ${id} (${rule.title})`;
}

/**
 * The provenance label of an imported post (10.6, decision 6), made from the post's own label and nothing else (8.4): the
 * visible line "Imported from X, dated 3 Mar 2019" with ", shortened on import" for a shortened post, and the pressable
 * line's name, "Imported from X, dated 3 March 2019. About imported posts", the day written out. The day is the archive's,
 * in UTC: readers never see its second.
 */
export function importedLabel(label: ImportedLabel): { text: string; name: string } {
  const source = sourceName(label.source);
  const cut = label.shortened ? IMPORT_WORDS["import.label.shortened"] : "";
  return {
    text: fill(IMPORT_WORDS["import.label"], { source, date: utcDay(label.at) }) + cut,
    name: fill(IMPORT_WORDS["import.label.a11y"], { source, date: utcDay(label.at, "long") + cut }),
  };
}

/** QuoteEmbed's short form (10.6): "Imported from X". */
export const importedShort = (source: ImportSource): string => fill(IMPORT_WORDS["import.label.short"], { source: sourceName(source) });

/**
 * Who sees this's provenance paragraph (10.6): its first sentence the fact of decision 28, then the source, the day the
 * post was published on korbat (the day it was imported, in the reader's zone) and the archive's day in UTC.
 */
export function provenanceWords(label: ImportedLabel, publishedAt: string): string {
  return fill(IMPORT_WORDS["import.provenance"], { source: sourceName(label.source), imported: localDay(publishedAt), date: utcDay(label.at, "long") });
}
