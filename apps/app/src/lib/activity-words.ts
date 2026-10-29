/**
 * The words of Activity (2d design, sections 5.5.3, 10.2, 10.3 and 10.10), word for word as the design's table writes
 * them, kept out of the markup as every sentence is (UI design, section 1.5). `{name}` is a display name, `{n}` a number,
 * `{time}` lib/time.ts's spoken time and `{date}` its day; fill() in lib/ui-words.ts puts them in. A release's, a refused
 * upload's and a lost image's lines are 3d's words unchanged (RELEASE_TEXTS.entry, UPLOAD_TEXTS.entry and
 * IMAGE_LOST_NOTICE.mail), which lib/activity.ts reads from their own modules.
 */
export const ACTIVITY_WORDS = {
  "activity.title": "Activity",
  /** The tab list's name (6.10 requires one). */
  "activity.tabs": "Activity",
  "activity.tab.all": "All",
  "activity.tab.conversations": "Conversations",
  /** The header's quiet link to Settings, Activity. */
  "activity.settingsLink": "Activity settings",
  /** Each entry's article is named by its line and its time, with "New, " first while it is new. */
  "activity.entry.name": "{line}, {time}",
  "activity.entry.newName": "New, {line}, {time}",
  "activity.divider": "New since you last looked",
  "activity.earlier": "Earlier",
  "activity.pill.one": "1 new",
  "activity.pill": "{n} new",
  "activity.pill.many": "20+ new",
  "activity.pill.label": "{visible} above, go to the first one",
  "activity.reply": "{name} replied to your post",
  "activity.mention": "{name} mentioned you",
  "activity.quote": "{name} quoted your post",
  "activity.follow.one": "{name} followed you",
  "activity.follow.two": "{name} and {other} followed you",
  "activity.follow.many": "{name} and {n} others followed you",
  "activity.follow.all": "See your followers",
  "activity.decision.post": "A decision about your post from {date}",
  "activity.decision.profile": "A decision about your profile",
  "activity.decision.account": "A decision about your account",
  "activity.moderation.open": "Open in Cases",
  "activity.empty.all.title": "Nothing here yet",
  "activity.empty.all.body":
    "When someone replies to you, mentions you, quotes you or follows you, it shows here, and so do decisions korbat sent you. korbat does not tell you about replies, mentions, quotes or follows anywhere else.",
  "activity.empty.conversations.title": "No conversations yet",
  "activity.empty.conversations.body": "Replies to your posts, mentions of you and quotes of your posts show here.",
  "activity.end": "That's everything from the last {days} days.",
  "activity.error": "Your activity could not be loaded.",
  /** Under the composer's field while its text holds a handle (4.5, 10.3). */
  "activity.composer.mentions": "Up to 10 accounts you name with @ are told, if their settings allow it.",
} as const;

export type ActivityWord = keyof typeof ACTIVITY_WORDS;
