/**
 * The words of korbat's own components and of this sub-project's screens (UI design, sections 1.5 and 8.1), kept out
 * of the markup so a later translation is mechanical: a test of a11y.test.tsx refuses a bare sentence in src/app and
 * src/components. Keys are written as the design's word tables write them (`offline.title`, `feed.loading`); words no
 * table keys take a key of the same shape. A template holds `{name}` where fill() puts a value. Words of an area that
 * has a words module of its own (moderation, standing, orders, Explore, the public pages, the terms) stay there.
 */

/** U+2026, built in code so this file stays plain ASCII. */
const ELLIPSIS = String.fromCharCode(0x2026);

export const UI_WORDS = {
  /** Button's label while its action runs (6.4), word for word what ui.tsx showed before the kit. */
  "button.busy": `Please wait${ELLIPSIS}`,
  /** The centred spinner's name (Loading in ui.tsx). */
  "spinner.label": "Loading",
  /** VerifiedChip (6.13): the visible word and the name a screen reader hears, as ui.tsx had them. */
  "verified.label": "Verified",
  "verified.name": "verified account",
  /** The polite status of a list that shows skeleton rows (6.12). */
  "feed.loading": "Loading posts",
  "accounts.loading": "Loading accounts",
  /** ErrorState (6.12) and its offline form (8.11). */
  "error.retry": "Try again",
  "offline.title": "You're offline",
  "offline.body": "korbat will load this when your connection is back.",
  /** PublicFrame (7.3): the wordmark and the footer's links to the public pages. */
  "frame.wordmark": "korbat",
  "frame.rules": "The rules",
  "frame.transparency": "Transparency",
  "frame.terms": "Terms",
  /** postedWhen() (8.1), the spoken form of timeAgo's short time, which it always contains. */
  "time.posted.now": "posted just now",
  "time.posted.ago": "{short} ago",
  "time.posted.on": "on {date}",
  /** The shell (7.1 to 7.5, 8.1): the skip link, the context column and its card, the header's back button. */
  "shell.skip": "Skip to the main content",
  "shell.about": "About korbat",
  "shell.howTitle": "How korbat works",
  "shell.how1": "Following and Latest are in time order.",
  "shell.how2": "korbat never lowers a post's reach in secret.",
  "shell.how3": "The rules are public, and so is how they are enforced.",
  "shell.rulesLink": "The rules",
  "shell.transparencyLink": "Transparency",
  "shell.exploreLink": "How Explore works",
  "shell.back": "Back",
  /** The navigation landmark's name and its items, the same words at every width (7.1). */
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.bookmarks": "Bookmarks",
  "nav.profile": "Profile",
  "nav.settings": "Settings",
  "nav.signin": "Sign in",
  /** The rail's mark (7.1), the wordmark's first letter, as the favicon draws it. */
  "nav.monogram": "k",
  /** HandleBox, in the context column (7.3), word for word as it had them. */
  "handle.title": "Go to a profile",
  "handle.field": "Handle",
  "handle.placeholder": "@handle",
  "handle.open": "Open",
  "handle.invalid": "Handles are 3 to 20 letters, numbers or underscores.",
  /** A mistyped address and the error boundary (8.11). */
  "notFound.title": "This page doesn't exist",
  "notFound.action": "Go to Home",
  "crash.title": "Something went wrong on this screen",
  "crash.body": "Try again, or go back to Home.",
  "crash.retry": "Try again",
  /** Bookmarks, followers and following (8.4, 8.5): their titles and empty sentences, word for word as the screens had them. */
  "bookmarks.title": "Bookmarks",
  "bookmarks.private": "Private to you.",
  "bookmarks.empty": "Nothing saved yet. Use Save on a post to keep it here.",
  "followers.title": "Followers",
  "followers.empty": "No followers yet.",
  "following.title": "Following",
  "following.empty": "Not following anyone yet.",
  /**
   * The post card (6.6, 8.1, section 10). post.label is the article's name, "Ada, @ada, 3h ago"; post.open is the time
   * link's, whose `when` comes from postedWhen() and always contains the visible short time. The action names leave the
   * number out at zero and when the reader hides counts (decision 15): then they are the `.none` words.
   */
  "post.label": "{name}, @{handle}, {when}",
  "post.open": "{when}, open the post",
  "post.reposted": "{displayName} reposted",
  "post.more": "More options for this post",
  "post.repost": "Repost",
  "post.unrepost": "Undo repost",
  "post.quote": "Quote",
  "post.whoSees": "Who sees this",
  "post.copyLink": "Copy link",
  "post.delete": "Delete",
  "post.reply": "Reply, {n} replies",
  "post.reply.one": "Reply, 1 reply",
  "post.reply.none": "Reply",
  "post.like": "Like, {n} likes",
  "post.like.one": "Like, 1 like",
  "post.like.none": "Like",
  "post.reposts": "Repost, {n} reposts",
  "post.reposts.one": "Repost, 1 repost",
  "post.reposts.none": "Repost",
  "post.save": "Save",
  "post.saved": "Saved",
  /** The delete question (6.6), word for word as PostCard.tsx had it. */
  "post.deleteQuestion": "Delete this post?",
  /** The reply context and the quoted post's tombstones, word for word as PostCard.tsx had them. */
  "post.replyingTo": "Replying to ",
  "post.replyingHidden": "Replying to a post you can't see",
  "post.deleted": "This post was deleted by its author.",
  "post.unavailable": "This post is unavailable.",
  "post.inExplore": "In Explore",
  /** The thread's focused post (8.3): each part left out when zero or hidden, joined by a comma. */
  "thread.stats.reposts": "{n} reposts",
  "thread.stats.reposts.one": "1 repost",
  "thread.stats.quotes": "{n} quotes",
  "thread.stats.quotes.one": "1 quote",
  "thread.stats.likes": "{n} likes",
  "thread.stats.likes.one": "1 like",
  /**
   * Who sees this (6.14), the sentences reach() in lib/reach.ts puts together, word for word as the design reviewed them;
   * the summary is the one line under the menu item.
   */
  "reach.public": "Public. Anyone can read it, including people who are not signed in.",
  "reach.blocked": "Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.",
  "reach.feeds": "It shows in Latest and in your followers' Following, in time order.",
  "reach.inExplore": "Also in Explore.",
  "reach.exploreOff": "Not in Explore: you turned Explore off.",
  "reach.suspended": "Not in Explore while your account is suspended.",
  "reach.reply": "Public. Shown in the thread and on your Replies tab.",
  "reach.replyExplore": "Replies never enter Explore.",
  "reach.quoteExplore": "Quotes never enter Explore.",
  "reach.private": "Only you and korbat's moderators can see it.",
  "reach.order": "Removed for everyone else by an authority's order.",
  "reach.decision": "Read the decision",
  "reach.never": "korbat never lowers a post's reach in secret. Following and Latest are in time order.",
  "reach.how": "How Explore works",
  "reach.summary.public": "Public, signed in or not",
  "reach.summary.private": "Only you and korbat's moderators",
  /** A post's images and the lightbox (6.7), word for word as MediaGrid.tsx, HiddenImage.tsx and MediaViewer.tsx had them. */
  "media.open": "Open image: {alt}",
  "media.showAlt": "Show image descriptions",
  "media.hideAlt": "Hide image descriptions",
  "media.alt": "ALT",
  "media.hidden": "Hidden",
  "media.close": "Close the image viewer",
  "media.previous": "Previous image",
  "media.next": "Next image",
  "media.count": "{n} of {total}",
  /** UI Task 7 (decision 10, 8.7): the link under a grid that holds a hidden image, to the rules page. */
  "media.whyHidden": "Why are images hidden?",
  /** Toasts (5.4, 8.6). */
  "toast.view": "View",
  "toast.linkCopied": "Link copied",
  "toast.saved": "Saved to Bookmarks",
  "toast.failed.like": "Couldn't like this post. Try again.",
  "toast.failed.unlike": "Couldn't remove your like. Try again.",
  "toast.failed.repost": "Couldn't repost this post. Try again.",
  "toast.failed.unrepost": "Couldn't undo the repost. Try again.",
  "toast.failed.save": "Couldn't save this post. Try again.",
  "toast.failed.unsave": "Couldn't remove this post from Bookmarks. Try again.",
  "toast.failed.follow": "Couldn't follow @{handle}. Try again.",
  "toast.failed.unfollow": "Couldn't unfollow @{handle}. Try again.",
  /** What sending says (5.4, 8.6), each with View; the post's names where it is, so View is a convenience. */
  "toast.sent.post": "Your post was sent. It is at the top of Home.",
  "toast.sent.reply": "Your reply was sent",
  "toast.sent.quote": "Your quote was sent",
  /**
   * The composer (6.15, 8.6): the sheet's titles and the compose button's name, the field's names and placeholders, the
   * Post button's words and what it says is missing, the count, the send bar, the discard question and the image tray,
   * word for word as Composer.tsx, ComposeSheet.tsx and ComposerImages.tsx had them; the collapsed cards, the count and
   * the location sentence are new (8.6's table).
   */
  "composer.title.post": "New post",
  "composer.title.reply": "Reply",
  "composer.title.quote": "Quote",
  "composer.newPost": "New post",
  "composer.collapsed": "What's on your mind?",
  "composer.collapsedReply": "Write your reply",
  "composer.field.post": "What's on your mind?",
  "composer.field.reply": "Your reply",
  "composer.field.quote": "Your comment on the quoted post",
  "composer.placeholder.post": "What's on your mind?",
  "composer.placeholder.reply": "Write your reply",
  "composer.placeholder.quote": "Add your comment",
  "composer.action.post": "Post",
  "composer.action.reply": "Reply",
  "composer.action.quote": "Quote",
  "composer.posting": `Posting${ELLIPSIS}`,
  "composer.missing.failed": "Remove the failed image",
  "composer.missing.undescribed": "Describe every image",
  "composer.missing.waiting": `Waiting for images${ELLIPSIS}`,
  "composer.count": "{n} of 1000 characters",
  "composer.cancel": "Cancel",
  "composer.addImage": "Add image",
  "composer.exif": "korbat removes location and camera details from images.",
  "composer.discard.question": "Discard this draft?",
  "composer.discard.confirm": "Discard",
  "composer.discard.keep": "Keep writing",
  /** Under the refusal that replaces the fields while a measure runs (3e, 9.4): where to read about it. */
  "composer.refused.where": "{read}: Settings, Cases.",
  "composer.image.name": "image {n}",
  "composer.image.preview": "Preview of {name}",
  "composer.image.refused": "{name}, not accepted",
  "composer.image.description": "Description of {name}",
  "composer.image.placeholder": "Describe this image for people who cannot see it",
  "composer.image.remove": "Remove {name}",
  "composer.image.removeWord": "Remove",
  "composer.image.uploading": `Uploading${ELLIPSIS}`,
  "composer.image.processing": `Processing${ELLIPSIS}`,
  "composer.image.ready": "Ready",
  "composer.image.failed": "Failed",
  /** FollowButton (8.4), word for word as ProfileList.tsx had them. */
  "follow.follow": "Follow",
  "follow.following": "Following",
  /**
   * Home's feeds (8.2): the marker, the new-posts pill, the gap, the end, the empty states and Load more. The empty
   * sentences and Load more are word for word what index.tsx and PagedList.tsx had; feed.pill.label is the pill's name
   * and feed.pill.announce what a screen reader hears once when it first shows.
   */
  "feed.marker.title": "You were here",
  "feed.marker.body": "Newer posts are above. Below are posts you have already seen.",
  "feed.caughtUp": "You're all caught up",
  "feed.pill": "{n} new posts",
  "feed.pill.one": "1 new post",
  "feed.pill.many": "50+ new posts",
  "feed.pill.label": "{visible} above, go to the first one",
  "feed.pill.announce": "{visible} above",
  "feed.gap": "Show more new posts",
  "feed.end.following": "That's everything in Following.",
  "feed.end.latest": "That's everything in Latest.",
  "feed.empty.following.title": "Your Following feed is empty",
  "feed.empty.following.body": "Nothing here yet. Follow someone, or switch to Latest or Explore.",
  "feed.empty.following.action": "Open Latest",
  "feed.empty.latest.title": "Nothing posted yet",
  "feed.empty.latest.body": "No posts yet.",
  "feed.loadMore": "Load more",
  /** Home (8.2): its title, its tab list's name and its tabs, and the passkey card's words as index.tsx had them. */
  "home.title": "Home",
  "home.tabs": "Feeds",
  "home.following": "Following",
  "home.latest": "Latest",
  "home.explore": "Explore",
  "passkey.title": "Sign in faster with a passkey",
  "passkey.body": "A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.",
  "passkey.add": "Add a passkey",
  "passkey.notNow": "Not now",
  /** A post and its thread (8.3), word for word as post/[id].tsx had them; thread.signIn is new. */
  "thread.title": "Post",
  "thread.missing": "This post is not available",
  "thread.back": "Back to the timeline",
  "thread.quote": "Quote this post",
  "thread.empty": "No replies yet.",
  "thread.signIn": "Sign in to reply.",
  "thread.exploreSetting": "Your Explore setting",
  /** A profile (8.4), word for word as u/[handle]/index.tsx had them; the hidden counts' words and More's name are new. */
  "profile.more": "More options for @{handle}",
  "profile.posts": "posts",
  "profile.followers": "followers",
  "profile.following": "following",
  "profile.followers.hidden": "Followers",
  "profile.following.hidden": "Following",
  "profile.followsYou": "Follows you",
  "profile.mute": "Mute",
  "profile.unmute": "Unmute",
  "profile.block": "Block",
  "profile.unblock": "Unblock",
  "profile.blockQuestion": "Block @{handle}?",
  "profile.blockBody":
    "Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from someone who signs out. You can undo this in your privacy settings.",
  "profile.cancel": "Cancel",
  "profile.signIn": "Sign in to follow this account.",
  "profile.settings": "Security and privacy settings",
  "profile.missing": "This account is not available",
  "profile.tabs": "Profile",
  "profile.tab.posts": "Posts",
  "profile.tab.replies": "Replies",
  "profile.tab.likes": "Likes",
  "profile.empty.posts": "No posts yet.",
  "profile.empty.replies": "No replies yet.",
  "profile.empty.likes": "You have not liked anything yet. Only you can see this tab.",
  "bookmarks.empty.title": "No saved posts",
  /**
   * UI Task 8: the Settings index (8.8, the owner's ruling 10) and the settings row's pages, word for word as
   * SettingsNav.tsx had them; the row's landmark keeps its name.
   */
  "settings.title": "Settings",
  "settings.nav": "Settings",
  "settings.security": "Security",
  "settings.privacy": "Privacy",
  "settings.profile": "Profile",
  "settings.account": "Account",
  /** Appearance and accessibility (8.8), the design's table. */
  "appearance.title": "Appearance and accessibility",
  "appearance.nav": "Appearance",
  "appearance.theme": "Theme",
  "appearance.system": "System",
  "appearance.light": "Light",
  "appearance.dim": "Dim",
  "appearance.dark": "Dark",
  "appearance.darkStyle": "Dark style",
  "appearance.textSize": "Text size",
  "appearance.smaller": "Smaller",
  "appearance.default": "Default",
  "appearance.larger": "Larger",
  "appearance.largest": "Largest",
  "appearance.sample": "This is how posts will read.",
  /** The letters each text size and font row draws in its own size or face, as decoration beside its name. */
  "appearance.glyphs": "Aa",
  "appearance.font": "Font",
  "appearance.korbatFonts": "korbat fonts",
  "appearance.systemFont": "System font",
  "appearance.motion": "Reduce motion",
  "appearance.followSystem": "Follow the system",
  "appearance.always": "Always",
  "appearance.haptics": "Haptics",
  "appearance.reading": "Reading",
  "appearance.autoLoad": "Load older posts automatically",
  "appearance.openNewest": "Open feeds at the newest post",
  /** The owner's ruling 12: it hides follower counts too, and says so. */
  "appearance.hideCounts": "Hide like, repost and follower counts",
  /** "On this device" (8.8, decision 8): what korbat keeps in this browser, and the button that clears it. */
  "device.title": "On this device",
  "device.body":
    "korbat keeps your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent in this browser until you sign out. A random device id, which tells a new device from a known one at sign-in, and your Not now on the passkey card stay.",
  "device.clear": "Clear what this device keeps",
  "toast.cleared": "Cleared",
} as const;

export type UiWord = keyof typeof UI_WORDS;

/**
 * Each screen's browser tab title (8.1, decision 16), read by lib/page-title.tsx: "<what> - korbat", naming the kind of
 * screen and never an account, so a synced browser history holds no handles (the h1 inside the page names the account).
 * A title joins this table with the first screen that sets it.
 */
export const TITLE_WORDS = {
  "title.notFound": "Page not found - korbat",
  "title.bookmarks": "Bookmarks - korbat",
  "title.followers": "Followers - korbat",
  "title.following": "Following - korbat",
  "title.home": "Home - korbat",
  "title.post": "Post - korbat",
  "title.postMissing": "Post not available - korbat",
  "title.profile": "Profile - korbat",
  /** UI Task 7: the public pages (8.9). */
  "title.rules": "Rules - korbat",
  "title.transparency": "Transparency - korbat",
  "title.exploreAbout": "How Explore works - korbat",
  "title.terms": "Terms - korbat",
  /**
   * UI Task 7: screens the design gives no title (8.1 wants one), each named by its kind: the report form, a report's
   * status page (never its reference), and the case screens in the form of 8.8's title.settings, filled, since a title
   * holds no placeholder.
   */
  "title.report": "Report - korbat",
  "title.notice": "Report status - korbat",
  "title.cases": "Cases - Settings - korbat",
  /**
   * UI Task 8: the Settings index and its pages (8.8), each the form of title.settings filled in, since a title holds no
   * placeholder; Appearance takes the settings row's short name, as Cases does.
   */
  "title.settingsIndex": "Settings - korbat",
  "title.settingsAppearance": "Appearance - Settings - korbat",
  "title.settingsSecurity": "Security - Settings - korbat",
  "title.settingsPrivacy": "Privacy - Settings - korbat",
  "title.settingsProfile": "Profile - Settings - korbat",
  "title.settingsAccount": "Account - Settings - korbat",
  /**
   * The sign-in flow and the token pages (8.10). A token page is named korbat alone: its address holds the link's
   * secret and its words say what the link does, so the tab names neither (shell.test.tsx allows this one key).
   */
  "title.signin": "Sign in - korbat",
  "title.code": "Check your email - korbat",
  "title.password": "Sign in with a password - korbat",
  "title.mfa": "Two-factor authentication - korbat",
  "title.age": "Almost there - korbat",
  "title.handle": "Choose your handle - korbat",
  "title.token": "korbat",
} as const;

export type TitleWord = keyof typeof TITLE_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
