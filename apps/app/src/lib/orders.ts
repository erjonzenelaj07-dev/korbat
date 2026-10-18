/**
 * 3f (design, section 9): the app's own sentences about an authority's order, each under the design's key ([chip.order]
 * is `chip.order`). The notice's own sentences are ORDER_NOTICE of @korbat/rules (W.2), which statementParagraphs renders
 * and the app never words itself; the authority's words are printed whole, in their block, under ORDER_NOTICE's labels.
 * Nothing here is shown while a notice is held: the API answers the author then as it answers a stranger, so no screen of
 * the app has a branch for it.
 */
import { ORDER_RULES } from "@korbat/contracts";

export const ORDER_TEXTS = {
  /** [chip.order]: the author's own post that a DSA Article 9 order removed without withholding it from them. */
  chip: { order: "Removed: an authority's order" },
  /** The row on Cases ("About you"), in words and not by colour (9.3, 9.4). */
  row: {
    disabled: "a post disabled on an authority's order",
    removed: "a post removed on an authority's order",
    lifted: "an authority's order lifted",
    /** 3f's review (people9): an order decision's row gives the day its author was told, not the disabling's (9.3). */
    toldOn: (day: string) => `Told on ${day}`,
  },
  notice: {
    /** The screen's title for a decision of the kind `order` and for the reinstatement after one. */
    title: "Notice: an authority's order",
    noContent: "korbat does not show the post here. While it is disabled korbat keeps it only for the purposes the law names, and shows it only to the authorities and courts that law names.",
    /**
     * 3f's review (people5): the same place on the notice of a DSA Article 9 order that does not ask that the post be kept
     * from its author: they still see it, with its chip, and nobody else does.
     */
    noContentRemoved: "korbat does not show the post here. You can still see it on your profile; other people cannot, for as long as the order's measure stands.",
    noAppeal: "This is not korbat's decision, so korbat's appeal does not apply. The notice says where the order can be challenged.",
    wrongItem: (contact: string) =>
      `If the order does not name this post, korbat made a mistake that it can correct itself. Write to ${contact} from the email address of your korbat account, with the address of the post and the reference this notice shows.`,
    fresh:
      "korbat adds to this notice what it learns: the authority's reasons and the ways to challenge the order as soon as it has recorded them, and what happens to the content. korbat sends you an email each time it adds the authority's words, and the notice says since when it has held them.",
  },
} as const;

/** The app's words for `not_appealable` (9.4): [notice.noAppeal]'s first sentence. */
export const NOT_APPEALABLE = "This is not korbat's decision, so korbat's appeal does not apply.";

/**
 * 3f Task 5 (design, section 9.4, [delete.hold]): what the deletion screen says, under its warning, of the two things the
 * law can oblige korbat to keep for a time. Shown to every account, since it is a rule and not a finding about this one:
 * it promises no report and names no post. Its number is the contracts' ORDER_RULES.reportHoldDays.
 */
export const DELETE_HOLD = `Two things the law can oblige korbat to keep for a time (Terms, Your data). If korbat has sealed images of this account, it keeps your email address, and nothing else, for up to ${ORDER_RULES.reportHoldDays} days, until it has reported them to the authorities or has decided that it need not. And a post that an authority's order obliges korbat to preserve is kept until that time ends. Everything else is deleted at once, as described above.`;
