import type { ExploreStatusKind, MeResponse, PostView } from "@korbat/contracts";
import { exploreStatusText } from "./explore";
import { IMPORT_WORDS, provenanceWords } from "./import-words";
import { chipText } from "./moderation";
import { CHIP_WORDS } from "./moderation-words";
import { runningMeasure } from "./standing";
import { UI_WORDS } from "./ui-words";

/**
 * Who sees a post (UI design, section 6.14): the sentences of the "Who sees this" sheet, built only from what the client
 * already holds (the post, the reader's /me) and, for the reader's own visible top-level post, the answer of GET
 * /api/posts/:id/explore, which the sheet asks for when `asksExplore` says so. Nothing here claims more than that data
 * says: a reader's view of someone else's post never mentions moderation (readers never receive another account's
 * restricted post, so its absence says nothing); no sentence says a blocked account cannot read a public post, since
 * anyone signed out can; and the sentence of a withheld or removed post names korbat's moderators, who see it too.
 */
export interface ReachLine {
  text: string;
  link?: { label: string; href: string };
  /** 3b Task 7: the provenance paragraph of an imported post, which the label's press opens the sheet at (10.6). */
  mark?: "provenance";
}

export interface Reach {
  lines: ReachLine[];
  /** The one line under the menu item. */
  summary: string;
  /** Whether the sheet should ask the post's Explore status: the reader's own top-level post, when nothing else decides. */
  asksExplore: boolean;
}

/** Always last: how korbat treats reach, with the way to read how Explore ranks. */
const NEVER: ReachLine = { text: UI_WORDS["reach.never"], link: { label: UI_WORDS["reach.how"], href: "/explore/about" } };

/**
 * 3b (design, sections 8.4 and 10.6): an imported post's two lines. import.reach says where imported posts show, in place
 * of the feeds' line and the Explore line (the status is known: none is asked); the provenance paragraph follows, built
 * from the post's own label and its publication day, so it can never name the other platform's account.
 */
function importedLines(post: PostView): ReachLine[] {
  if (post.imported === null) return [];
  return [{ text: IMPORT_WORDS["import.reach"] }, { text: provenanceWords(post.imported, post.createdAt), mark: "provenance" }];
}

export function reach(post: PostView, me: MeResponse | null, explore?: ExploreStatusKind | null): Reach {
  const own = me !== null && post.author.id === me.user.id;
  const publicLine: ReachLine = { text: UI_WORDS["reach.public"] };
  if (!own) return { lines: [publicLine, ...importedLines(post), NEVER], summary: UI_WORDS["reach.summary.public"], asksExplore: false };

  if (post.state !== "visible") {
    const decision = post.moderation;
    const lines: ReachLine[] = [{ text: UI_WORDS["reach.private"] }];
    // The chip's own words; without the decision's facts, the state's plain word, as the chip says it.
    const chip = decision ? chipText(decision) : post.state === "withheld" ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
    if (decision && !decision.order) lines.push({ text: chip, link: { label: UI_WORDS["reach.decision"], href: `/settings/cases/${decision.decisionId}` } });
    else lines.push({ text: chip });
    if (decision?.order) {
      lines.push({ text: UI_WORDS["reach.order"], link: { label: UI_WORDS["reach.decision"], href: `/settings/cases/${decision.decisionId}` } });
    }
    // 3b: a withheld or removed imported post keeps its provenance, which its label still opens.
    if (post.imported !== null) lines.push(importedLines(post)[1]!);
    lines.push(NEVER);
    return { lines, summary: UI_WORDS["reach.summary.private"], asksExplore: false };
  }

  // 3b: the author's own imported post, a thread's reply among them, is on no feed and no Replies tab, and never in Explore.
  if (post.imported !== null) {
    return { lines: [publicLine, { text: UI_WORDS["reach.blocked"] }, ...importedLines(post), NEVER], summary: UI_WORDS["reach.summary.public"], asksExplore: false };
  }

  if (post.replyTo !== null) {
    return { lines: [{ text: UI_WORDS["reach.reply"] }, { text: UI_WORDS["reach.replyExplore"] }, NEVER], summary: UI_WORDS["reach.summary.public"], asksExplore: false };
  }

  const lines: ReachLine[] = [publicLine, { text: UI_WORDS["reach.blocked"] }, { text: UI_WORDS["reach.feeds"] }];
  let asksExplore = false;
  if (post.inExplore) lines.push({ text: UI_WORDS["reach.inExplore"] });
  else if (me.profile?.showInExplore === false) lines.push({ text: UI_WORDS["reach.exploreOff"] });
  else if (runningMeasure(me.standing) !== null) lines.push({ text: UI_WORDS["reach.suspended"] });
  // Quotes never enter Explore, as replies do not (lib/explore.ts): there is nothing to ask.
  else if (post.quoteOf !== null) lines.push({ text: UI_WORDS["reach.quoteExplore"] });
  else if (explore) {
    const text = exploreStatusText(explore);
    if (text !== null) lines.push({ text });
  } else asksExplore = true;
  lines.push(NEVER);
  return { lines, summary: UI_WORDS["reach.summary.public"], asksExplore };
}
