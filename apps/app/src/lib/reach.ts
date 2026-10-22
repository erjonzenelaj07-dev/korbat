import type { ExploreStatusKind, MeResponse, PostView } from "@korbat/contracts";
import { exploreStatusText } from "./explore";
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

export function reach(post: PostView, me: MeResponse | null, explore?: ExploreStatusKind | null): Reach {
  const own = me !== null && post.author.id === me.user.id;
  const publicLine: ReachLine = { text: UI_WORDS["reach.public"] };
  if (!own) return { lines: [publicLine, NEVER], summary: UI_WORDS["reach.summary.public"], asksExplore: false };

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
    lines.push(NEVER);
    return { lines, summary: UI_WORDS["reach.summary.private"], asksExplore: false };
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
