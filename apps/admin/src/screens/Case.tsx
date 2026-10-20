import {
  MEASURES,
  ORDER_GROUND_LABELS,
  RELEASE_POSTS_MAX,
  RETENTION,
  REVEAL_REASON_CATEGORIES,
  SUSPECT_EARLIER_MONTHS,
  type CaseDecision,
  type CaseHistoryEntry,
  type CaseItem,
  type CaseSnapshot,
  type CaseView,
  type MatchRecord,
  type RevealReasonCategory,
  type RevealResponse,
  type SealRelease,
  type SealReleasedParams,
} from "@korbat/contracts";
import { statementParagraphs } from "@korbat/rules";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import {
  afterRefusal,
  answerDraft,
  COMPOSER,
  confirmDecision,
  confirmWhileBusy,
  correctionDraft,
  decidedNotice,
  newDraft,
  offeredDraft,
  openCorrection,
  programStatementOf,
  openReview,
  reinstateDraft,
  replyOf,
  replyState,
  reviewDraft,
  saveDraftText,
  withdrawDraft,
  withdrawMarksDraft,
  withSavedTexts,
  withSeal,
  type CaseDraft,
  type DraftTextKind,
  type StaffRole,
} from "../compose";
import { Frame } from "../frames";
import { parseImageId, StaffImage, type ImageId } from "../media";
import { APPEAL_WORDS, AUTOMATION_WORDS, CASE_WORDS, CUSTODY_WORDS, DECISION_KINDS, DECISION_OUTCOMES, describeError, messageFor, NOTE_WORDS, ORDER_WORDS, OUTCOME_WORDS, RECOVERY_WORDS, RELEASE_WORDS, REVEAL_WORDS, STANDING_WORDS } from "../messages";
import { CaseLink, OrderLink } from "../nav";
import { parseCaseId, parseOrderId, type CaseId, type OrderId } from "../router";
import { releaseWithKey, revealWithKey } from "../step-up";
import type { DraftSlots } from "../store";
import { normalised, saveStaffText, type RandomBytes } from "../texts";
import { bothTimes, dateTime, Loaded, UserText, type Loadable } from "../ui";
import { categoryLabel, COLLAPSED_RULES, counted, LANE_NAMES, revealable, sourceWords, writtenBy } from "../words";
import type { CredentialsLike } from "../webauthn";
import { AnswerControl, ComposerView, CorrectControl, ReinstateControl, ReviewControl, WithdrawControl, WithdrawMarksControl, type ComposerViewProps } from "./Composer";

/**
 * The case page (3c design, sections 7.3 and 8): the header, the banners, the evidence with its images, the items with
 * their sources, the decisions with what can still be lifted or corrected, the history, the notes, the reveal of a
 * source, and the decision composer. Every string someone wrote is drawn as text inside a frame that says who wrote it;
 * every address is text, since the console holds no link into the app; and an image is asked of the API only when its
 * person asks to see it.
 */

/** The Art. 18 check, shown above the evidence of every case in the urgent lane, to everyone who opens it. */
export const ART_18_BANNER = `Art. 18: decide now, as soon as you have read this case, whether it suggests a crime that threatens someone's life or safety. If it does, or you are unsure, wake the operator at once, at any hour. Record your check in a note ("Art. 18 check: no suspicion" or "Art. 18 check: operator told at <time>"). Nobody gives this case its final decision before that note exists.`;

/** The sentences of the banner of a case that holds an unanswered suspect item. */
export const SUSPECT_BANNER = {
  nobody: "Nobody opens the images this report concerns, here or in the app.",
  reach: (reach: { images: number; posts: number; sealed: number; served: number }) =>
    `This case reaches ${reach.images} images on ${reach.posts} posts; ${reach.sealed} are sealed and ${reach.served} are still shown to someone. Seal them now, while an admin decides: they are then shown to nobody, their author included.`,
  noImage: "This case reaches no image, so there is nothing to seal.",
  post: "Do not open this post in the app while a report of this kind about it is unanswered or its images are sealed: its page also shows the post it replies to and its replies, whose images this case neither freezes nor seals.",
  account:
    "Do not open this account's profile in the app while a report of this kind about it is unanswered or its images are sealed: the profile also shows posts of other accounts that it reposted or quoted, whose images this case neither freezes nor seals, and images posted since the seal. When this page shows images that are not sealed, seal again.",
  quotes: "This post quotes another, whose images its card shows; korbat opened a case on that post too:",
  added: "korbat added this item: a reported post quotes this one, and its card shows this post's images.",
  earlierTarget: (count: number, lastOn: string) => `An admin answered ${count} earlier reports of this kind about this target without a seal in the last ${SUSPECT_EARLIER_MONTHS} months, the last on ${lastOn}.`,
  opened: (day: string) => `Staff last opened an image of this post in the console on ${day}.`,
  earlierAuthor: (count: number, lastOn: string) => `An admin answered ${count} such reports about this author's profile or posts without a seal in the last ${SUSPECT_EARLIER_MONTHS} months, the last on ${lastOn}.`,
  newest: (day: string) => `The newest post with images this case reaches is of ${day}.`,
};

/** In place of every image of a post whose images cannot be opened now. */
export const IMAGES_NOT_SHOWN =
  "Images of this post are not shown: a report or finding of child sexual abuse material about it or about its author's account is open, or its images are sealed. Decide what turns on an image on the text alone, or wait until an admin has answered that report.";

/** The reveal dialog's four reasons, as its list words them. */
const REVEAL_REASONS: Record<RevealReasonCategory, string> = {
  impersonation_claim: "A claim of impersonation",
  abuse_of_reporting: "Abuse of reporting",
  legal_requirement: "A legal requirement",
  other: "Another reason",
};

/** The frame a revealed name is shown in. */
const REVEALED_LABEL = "Revealed to you; recorded and shown to every staff member";

/** What "Confirm with your staff key" in the reveal dialog comes to: the answer, or the console's words for the step that failed. */
export type RevealOutcome = { answer: RevealResponse } | { error: string };

/**
 * The reveal as the page runs it. The reason is saved first, without the key; the key then confirms the reveal under the
 * digest the console computed from what its person wrote (saveStaffText answers no other), never the text and never a
 * digest an answer carried. The two steps fail apart: a save refused for the minute's limit on saved texts is worded as
 * that, never as the day's limit on reveals.
 */
export async function revealSource(
  deps: { api: StaffApi; credentials: CredentialsLike; random?: RandomBytes },
  caseId: CaseId,
  itemId: string,
  category: RevealReasonCategory,
  reason: string,
): Promise<RevealOutcome> {
  let reasonDigest: string;
  try {
    reasonDigest = (await saveStaffText(deps, caseId, "reveal_reason", reason)).digest;
  } catch (err) {
    return { error: describeError(err, NOTE_WORDS) };
  }
  try {
    return { answer: await revealWithKey(deps, itemId, { reasonCategory: category, reasonDigest }) };
  } catch (err) {
    return { error: describeError(err, REVEAL_WORDS) };
  }
}

/**
 * What a read of the case that failed leaves on the page. Only the first read may put the page into its failed state:
 * there is no case to show then. Once the case was read, a later read that fails (after a snapshot, a note, a reveal or a
 * refused image) keeps the page as it is, the name a reveal has just shown with it, and says why on the page's error
 * line. Either way the words are the console's own for the code.
 */
export function afterFailedRead(current: Loadable<CaseView>, err: unknown): { view: Loadable<CaseView>; error: string | null } {
  const message = describeError(err, CASE_WORDS);
  return current.state === "ready" ? { view: current, error: message } : { view: { state: "failed", message }, error: null };
}

/**
 * The reveal dialog's state: which item, the category once one is chosen (the dialog opens with none: the reason on the
 * record is the person's own choice, never a default), the reason as typed, and the answer once the key confirmed.
 */
export interface RevealState {
  itemId: string;
  category: RevealReasonCategory | null;
  reason: string;
  busy: boolean;
  error: string | null;
  answer: RevealResponse | null;
}

/** Whether the dialog holds what a reveal needs: a chosen category and a reason that says something. The API refuses an empty reason too. */
const revealReady = (reveal: RevealState): boolean => reveal.category !== null && reveal.reason.trim() !== "";

/** The one image the person asked to see: whether clearly, and whether it failed to load (the API refused it, or the request failed). */
export interface ShownImage {
  id: ImageId;
  clear: boolean;
  failed: boolean;
}

export interface CaseScreenViewProps {
  caseId: CaseId;
  view: CaseView;
  /** The one image the person asked to see; null while none is shown. */
  shownImage: ShownImage | null;
  busy: "snapshot" | "note" | null;
  notice: string | null;
  error: string | null;
  note: string;
  reveal: RevealState | null;
  onOpenCase(id: CaseId): void;
  onShowImage(id: ImageId): void;
  onShowClearly(): void;
  onHideImage(): void;
  /** The shown image did not load. */
  onImageError(): void;
  onSnapshot(): void;
  onNoteChange(text: string): void;
  onNoteSave(): void;
  onRevealOpen(itemId: string): void;
  onRevealChange(change: Partial<Pick<RevealState, "category" | "reason">>): void;
  onRevealConfirm(): void;
  onRevealClose(): void;
  /** 3f: an order's intake item links to its order. */
  onOpenOrder?: (id: OrderId) => void;
  /** 3f Task 6: [restore.again], when the decision taken here takes again one lost with a restore. */
  again?: string | null;
  /** 3d Task 2: the release of a seal for good, on its decision's block; without it the block shows its facts and no working control. */
  release?: ReleaseProps;
  /**
   * The decision composer, for the person's role, with "Lift what was done while deciding" and "Correct this decision"
   * beside the decisions. Without it the page shows the case and decides nothing.
   */
  compose?: Omit<ComposerViewProps, "view"> & {
    onCorrect(decision: CaseDecision): void;
    onReview(decision: CaseDecision): void;
    onAnswer(decision: CaseDecision): void;
    onWithdraw(decision: CaseDecision): void;
    /** 3e Task 5: "Withdraw this decision's marks" beside a "No breach" decision whose marks stand. */
    onWithdrawMarks(decision: CaseDecision): void;
    /** 3f Task 3: "Reinstate" beside an order's measure that is in force. */
    onReinstate?: (decision: CaseDecision) => void;
  };
}

/** Whether the target as it stands differs from the case's newest snapshot: then the moderator takes a fresh one before deciding. */
export function targetDiffers(view: CaseView): boolean {
  const newest = view.snapshots[0];
  if (!newest || newest.withheld) return true;
  if (view.target.type === "post") return newest.postState !== view.target.state;
  return newest.handle !== view.target.handle || newest.displayName !== view.target.displayName || newest.bio !== view.target.bio;
}

/**
 * The rule whose texts open collapsed, when an item of the case cites one: its words for the button. Everything the
 * target's author wrote takes it, as copied in a snapshot and as it reads now: the post's text, the alt texts, the
 * display name and the bio.
 */
function collapsedLabel(view: CaseView): string | undefined {
  const rule = (["R5", "R3"] as const).find((id) => view.items.some((item) => item.ruleId === id));
  return rule === undefined ? undefined : `Show text (${rule}: ${COLLAPSED_RULES[rule]})`;
}

function SuspectBanner({ view, onOpenCase }: Pick<CaseScreenViewProps, "view" | "onOpenCase">) {
  const { suspicion } = view;
  if (!suspicion?.open) return null;
  const { reach, earlier } = suspicion;
  const quotedCases = [...new Set(view.items.flatMap((item) => (item.quotedCaseId === null ? [] : [item.quotedCaseId])))].flatMap((id) => {
    const checked = parseCaseId(id);
    return checked ? [checked] : [];
  });
  const earlierAny = earlier.target.count > 0 || earlier.author.count > 0;
  return (
    <section className="banner suspect" aria-label="Report of child sexual abuse material">
      <p>{SUSPECT_BANNER.nobody}</p>
      <p>{reach.images === 0 ? SUSPECT_BANNER.noImage : SUSPECT_BANNER.reach(reach)}</p>
      <p>{view.target.type === "post" ? SUSPECT_BANNER.post : SUSPECT_BANNER.account}</p>
      {quotedCases.map((id) => (
        <p key={id}>
          {`${SUSPECT_BANNER.quotes} `}
          <CaseLink id={id} onOpen={onOpenCase}>
            the case on the quoted post
          </CaseLink>
        </p>
      ))}
      {view.items.some((item) => item.quotedByPosition !== null) ? <p>{SUSPECT_BANNER.added}</p> : null}
      {earlier.target.count > 0 && earlier.target.lastOn !== null ? <p>{SUSPECT_BANNER.earlierTarget(earlier.target.count, earlier.target.lastOn)}</p> : null}
      {earlier.target.count > 0 && earlier.target.imagesOpenedOn !== null ? <p>{SUSPECT_BANNER.opened(earlier.target.imagesOpenedOn)}</p> : null}
      {earlier.author.count > 0 && earlier.author.lastOn !== null ? <p>{SUSPECT_BANNER.earlierAuthor(earlier.author.count, earlier.author.lastOn)}</p> : null}
      {earlierAny && reach.newestPostOn !== null ? <p>{SUSPECT_BANNER.newest(reach.newestPostOn)}</p> : null}
    </section>
  );
}

/**
 * 3d Task 7 [case.match] (section 8.4): a match's record as a list of label and value, never a hash value. The source, its
 * list version and the classification are a source's strings, each drawn in a frame "As the source returned it" (rule 3
 * of section 8); the hash type and the kind of match are the console's own words. Under it [case.matchWeak] for a hash
 * that can be made to collide on purpose, then [case.matchActing], [case.matchNear] or [case.matchFlag] by what the record
 * says, and on a case [case.matchWhat]. Held uploads prints the same record (8.6).
 */
export function MatchRecordView({ match, onCase = false }: { match: MatchRecord; onCase?: boolean }) {
  const M = AUTOMATION_WORDS.match;
  const weak = M.weak(match.hashType);
  return (
    <div className="match" role="group" aria-label={M.title}>
      <dl>
        <dt>{M.source}</dt>
        <dd>
          <Frame by={M.frame} text={match.source} />
        </dd>
        <dt>{M.listVersion}</dt>
        <dd>{match.listVersion === null ? M.none : <Frame by={M.frame} text={match.listVersion} />}</dd>
        <dt>{M.hashType}</dt>
        <dd>{match.hashType}</dd>
        <dt>{M.matchKind}</dt>
        <dd>{match.matchKind}</dd>
        <dt>{M.classification}</dt>
        <dd>{match.classification === null ? M.none : <Frame by={M.frame} text={match.classification} />}</dd>
        <dt>{M.queriedAt}</dt>
        <dd>{bothTimes(match.queriedAt)}</dd>
      </dl>
      {weak === null ? null : <p className="notice">{weak}</p>}
      <p className="notice">{match.acting ? M.acting : match.listed ? M.near : M.flag}</p>
      {onCase ? <p className="hint">{M.what}</p> : null}
    </div>
  );
}

/**
 * The images a post's newest snapshot lists. Each has its entry whatever may be opened: its number, its width and height
 * as text, and its alt text in an author frame, since an alt text is text, which staff read on every path. Only the
 * image itself is held back while the post's images cannot be opened: then no grey box stands for it, nothing offers to
 * show it, and the sentence above the list says why.
 */
function Images({
  view,
  caseId,
  media,
  collapsed,
  shownImage,
  onShowImage,
  onShowClearly,
  onHideImage,
  onImageError,
}: Pick<CaseScreenViewProps, "view" | "caseId" | "shownImage" | "onShowImage" | "onShowClearly" | "onHideImage" | "onImageError"> & {
  media: NonNullable<Extract<CaseSnapshot, { withheld: false }>["media"]>;
  /** The words of the button behind which this case's texts open collapsed, when one of its items cites R3 or R5. */
  collapsed: string | undefined;
}) {
  if (view.target.type !== "post") return null;
  const openable = view.imagesAllowed;
  return (
    <>
      {openable ? null : <p className="notice">{IMAGES_NOT_SHOWN}</p>}
      {media.length === 0 ? (
        <p className="quiet">The snapshot lists no image.</p>
      ) : (
        <ul className="images">
          {media.map((image, index) => {
            const id = parseImageId(image.id);
            // 3d Task 7 (rule 2 of section 8): an image that an unerased match record names is closed to staff on every case,
            // also after an answer without a seal: [case.image.matched] in its place, no reveal control and no request.
            const matched = view.matchedImages.includes(image.id);
            const shown = openable && !matched && id !== null && shownImage?.id === id ? shownImage : null;
            // 3d Task 3 (section 8.4): the edge's purge line of an image that stopped being public; none for one that never did.
            const purge = view.purges.find((entry) => entry.mediaId === image.id);
            return (
              <li key={image.id}>
                {matched ? (
                  <p className="notice">{AUTOMATION_WORDS.imageMatched}</p>
                ) : openable ? (
                  <div className="placeholder">
                    {shown === null || id === null ? (
                      <span>{`Image ${index + 1}, not shown`}</span>
                    ) : shown.failed ? (
                      // The API refused the image, or it did not load: the console's own words in its place.
                      <span>{messageFor("image_refused")}</span>
                    ) : (
                      <StaffImage caseId={caseId} mediaId={id} size={shown.clear ? "large" : "small"} clear={shown.clear} onError={onImageError} />
                    )}
                  </div>
                ) : (
                  <p>{`Image ${index + 1}`}</p>
                )}
                <p>{`${image.width} by ${image.height} pixels`}</p>
                {purge === undefined ? null : (
                  <p className={purge.outcome === "failed" ? "purge notice" : "purge hint"}>{AUTOMATION_WORDS.purge(purge.outcome, bothTimes(purge.at))}</p>
                )}
                {image.alt === null ? (
                  <p className="quiet">Its alt text was erased.</p>
                ) : image.alt === "" ? (
                  <p className="quiet">No alt text.</p>
                ) : (
                  <Frame by="Alt text. Written by the author" text={image.alt} collapsedLabel={collapsed} />
                )}
                {!openable || matched || id === null ? null : shown === null ? (
                  <button type="button" onClick={() => onShowImage(id)}>
                    Show image
                  </button>
                ) : (
                  <>
                    {shown.clear || shown.failed ? null : (
                      <button type="button" onClick={onShowClearly}>
                        Show clearly
                      </button>
                    )}
                    <button type="button" onClick={onHideImage}>
                      Hide image
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Snapshot({ snapshot, newest, props }: { snapshot: CaseSnapshot; newest: boolean; props: CaseScreenViewProps }) {
  const collapsed = collapsedLabel(props.view);
  return (
    <article className="panel snapshot">
      <h4>
        {newest ? "Newest snapshot, taken " : "Earlier snapshot, taken "}
        <time dateTime={snapshot.takenAt}>{dateTime(snapshot.takenAt)}</time>
      </h4>
      <p className="hint">
        Digest <code className="hash">{snapshot.digest}</code>
      </p>
      {snapshot.withheld ? (
        <p>Withheld: its content was erased, or copies content that was erased since.</p>
      ) : snapshot.targetType === "post" ? (
        <>
          <p>
            Post by <UserText>{snapshot.authorHandle}</UserText>
            {snapshot.postCreatedAt === null ? "" : `, posted ${dateTime(snapshot.postCreatedAt)}`}
            {snapshot.postState === null ? "" : `, then ${snapshot.postState.split("_").join(" ")}`}
          </p>
          {snapshot.body === null || snapshot.body === "" ? <p className="quiet">The snapshot holds no text.</p> : <Frame by="Written by the author" text={snapshot.body} collapsedLabel={collapsed} />}
          {snapshot.replyToId === null ? null : (
            <p>
              Replies to post <code>{snapshot.replyToId}</code>
            </p>
          )}
          {snapshot.quoteOfId === null ? null : (
            <p>
              Quotes post <code>{snapshot.quoteOfId}</code>
            </p>
          )}
          {newest ? (
            <Images
              view={props.view}
              caseId={props.caseId}
              media={snapshot.media ?? []}
              collapsed={collapsed}
              shownImage={props.shownImage}
              onShowImage={props.onShowImage}
              onShowClearly={props.onShowClearly}
              onHideImage={props.onHideImage}
              onImageError={props.onImageError}
            />
          ) : (
            <p className="quiet">{counted((snapshot.media ?? []).length, "image", "images")} listed.</p>
          )}
        </>
      ) : (
        <>
          <p>
            Account <UserText>{snapshot.handle ?? snapshot.authorHandle}</UserText>
          </p>
          {snapshot.displayName === null || snapshot.displayName === "" ? <p className="quiet">No display name.</p> : <Frame by="Display name. Written by the author" text={snapshot.displayName} collapsedLabel={collapsed} />}
          {snapshot.bio === null || snapshot.bio === "" ? <p className="quiet">No bio.</p> : <Frame by="Bio. Written by the author" text={snapshot.bio} collapsedLabel={collapsed} />}
        </>
      )}
    </article>
  );
}

function Target({ view }: { view: CaseView }) {
  const { target } = view;
  if (target.type === "post") {
    return (
      <p>
        The post now: {target.state === null ? "its row is gone" : `${target.state.split("_").join(" ")}, level ${target.level ?? "unknown"}`}
        {target.authorHandle === null ? null : (
          <>
            , by <UserText>{target.authorHandle}</UserText>
          </>
        )}
        . Its address, as text: <code>{target.link}</code>
      </p>
    );
  }
  // The fields as they read now are the same author's words as the snapshot's: on a case citing R3 or R5 they open
  // collapsed like those.
  const collapsed = collapsedLabel(view);
  return (
    <>
      <p>
        The account now: {target.handle === null ? "its row is gone" : <UserText>{target.handle}</UserText>}
        {target.deleted ? ", deleted" : ""}. The fields as they read now:
      </p>
      {target.displayName === null || target.displayName === "" ? <p className="quiet">No display name.</p> : <Frame by="Display name. Written by the author" text={target.displayName} collapsedLabel={collapsed} />}
      {target.bio === null || target.bio === "" ? <p className="quiet">No bio.</p> : <Frame by="Bio. Written by the author" text={target.bio} collapsedLabel={collapsed} />}
    </>
  );
}

function Item({ item, props }: { item: CaseItem; props: CaseScreenViewProps }) {
  // 3f (design, section 8.6): an order's item is listed with its order, never with a reporter's summary, a reveal or a mark.
  const order = item.source.kind === "authority";
  const orderId = item.orderId ? parseOrderId(item.orderId) : null;
  const ground = order ? "an authority's order" : item.csam ? "child sexual abuse material (notice)" : item.allegesIllegal ? "notice under Art. 16: illegal" : "breaks a rule";
  const by = writtenBy(item.source);
  const collapsed = item.ruleId !== null && Object.hasOwn(COLLAPSED_RULES, item.ruleId) ? `Show text (${item.ruleId}: ${COLLAPSED_RULES[item.ruleId]})` : undefined;
  return (
    <li className="panel item">
      <p>
        <strong>{`Item ${item.seq}`}</strong>
        {` (item ${item.position} of its notice), received ${dateTime(item.createdAt)}. `}
        {`${ground}${item.ruleId === null ? "" : `, ${item.ruleId}`}; ${categoryLabel(item.category)}.`}
      </p>
      <p>
        {"Source: "}
        <UserText>{item.source.label}</UserText>
        {sourceWords(item.source) === "" ? "" : ` (${sourceWords(item.source)})`}
        {/* 3d Task 8 (section 8.4): [case.sameSource], a count of the reporter's other open items; it names no case. */}
        {item.sameSourceOpen > 0 ? ` ${AUTOMATION_WORDS.sameSource(item.sameSourceOpen)}` : ""}
        {orderId !== null && props.onOpenOrder !== undefined ? (
          <>
            {" "}
            <OrderLink id={orderId} onOpen={props.onOpenOrder}>
              Open the order
            </OrderLink>
          </>
        ) : null}
      </p>
      <p>
        Names, as text: <UserText>{item.link}</UserText>
        {item.mediaId === null ? null : (
          <>
            {" and points at image "}
            <code>{item.mediaId}</code>
          </>
        )}
      </p>
      {/* The number is the re-examined item's place in its own notice: the page numbers this case's items otherwise, and the item may lie in an earlier case. */}
      {item.reexaminesPosition === null ? null : <p>{`Re-examination of item ${item.reexaminesPosition} of its notice`}</p>}
      {item.reexaminesYourDecision ? <p className="notice">You decided the item this re-examines. Leave it to another staff member when there is one.</p> : null}
      {item.erased ? <p className="quiet">Its words were erased under korbat's retention rules.</p> : null}
      {item.citedLaw === null ? null : <Frame by={`Cited law. ${by}`} text={item.citedLaw} />}
      {item.explanation === null ? null : <Frame by={`Explanation. ${by}`} text={item.explanation} collapsedLabel={collapsed} />}
      {item.statement === null ? null : <Frame by={`Statement for the re-examination. ${by}`} text={item.statement} collapsedLabel={collapsed} />}
      {/* 3d Task 6 (section 8.4): [case.r1] on an item a program's score opened; the threshold's version, never the score. */}
      {(() => {
        const signal = props.view.signals.find((found) => found.itemId === item.id && found.kind === "r1_score");
        return signal === undefined ? null : <p className="hint">{AUTOMATION_WORDS.caseR1(signal.thresholdVersion ?? 0)}</p>;
      })()}
      {/* 3d Task 7 (section 8.4): [case.match] on every item a match opened, whether it cites R2 or no rule. */}
      {(() => {
        const signal = props.view.signals.find((found) => found.itemId === item.id && found.kind === "known_match");
        return signal?.match == null ? null : <MatchRecordView match={signal.match} onCase />;
      })()}
      <p>{item.outcome === null ? "Unanswered." : `Answered: ${OUTCOME_WORDS[item.outcome]}.`}</p>
      {/* 3e Task 5 (design, section 8.4): the mark "manifestly unfounded" the answering decision set, or its withdrawal. */}
      {item.unfounded ? <p className="notice">{STANDING_WORDS.mark.marked}</p> : item.markWithdrawn ? <p className="hint">{STANDING_WORDS.mark.withdrawn}</p> : null}
      {revealable(item.source) ? (
        <button type="button" onClick={() => props.onRevealOpen(item.id)} disabled={props.reveal !== null}>
          Reveal who sent this
        </button>
      ) : null}
      {props.reveal?.itemId === item.id ? <RevealDialog reveal={props.reveal} onChange={props.onRevealChange} onConfirm={props.onRevealConfirm} onClose={props.onRevealClose} /> : null}
    </li>
  );
}

export function RevealDialog({ reveal, onChange, onConfirm, onClose }: { reveal: RevealState; onChange: CaseScreenViewProps["onRevealChange"]; onConfirm(): void; onClose(): void }) {
  const { answer } = reveal;
  const revealed = answer === null ? null : (answer.handle ?? answer.name);
  return (
    <section className="dialog" role="dialog" aria-labelledby="reveal-title">
      <h4 id="reveal-title">Reveal who sent this</h4>
      {answer === null ? (
        <>
          <p className="hint">A reveal cannot be undone. It is recorded, mailed to every staff account and listed on every staff member's home screen for 30 days.</p>
          <label htmlFor="reveal-category">Why</label>
          {/* The list opens on a line that is no reason: the person chooses the one that goes on the record. */}
          <select
            id="reveal-category"
            value={reveal.category ?? ""}
            disabled={reveal.busy}
            onChange={(event) => onChange({ category: REVEAL_REASON_CATEGORIES.find((category) => category === event.target.value) ?? null })}
          >
            <option value="" disabled>
              Choose why
            </option>
            {REVEAL_REASON_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {REVEAL_REASONS[category]}
              </option>
            ))}
          </select>
          <label htmlFor="reveal-reason">Reason</label>
          <textarea id="reveal-reason" rows={3} value={reveal.reason} disabled={reveal.busy} onChange={(event) => onChange({ reason: event.target.value })} />
          <p className="hint">Write the reason in your own words. Never copy what a reporter or a notifier wrote.</p>
          {reveal.error ? (
            <p role="alert" className="error">
              {reveal.error}
            </p>
          ) : null}
          <div className="actions">
            <button type="button" className="primary" onClick={onConfirm} disabled={reveal.busy || !revealReady(reveal)} aria-busy={reveal.busy}>
              Confirm with your staff key
            </button>
            <button type="button" onClick={onClose} disabled={reveal.busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {revealed === null ? (
            <p>The name is no longer kept, so nothing can be shown. The reveal is recorded all the same.</p>
          ) : (
            <>
              {/* What it is, in the console's words; the name alone in the frame, where its hidden characters can be shown. */}
              <p>{answer.handle === null ? "The name the notifier gave:" : "The reporter's handle:"}</p>
              <Frame by={REVEALED_LABEL} text={revealed} />
            </>
          )}
          <div className="actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SealList({ sealed }: { sealed: NonNullable<CaseDecision["actions"][number]["sealed"]> }) {
  const [open, setOpen] = useState(false);
  const more = sealed.posts - sealed.list.length;
  return (
    <>
      <p>{`${sealed.images} images on ${sealed.posts} posts (${sealed.deletedPosts} of them deleted by their author)`}</p>
      <button type="button" className="quiet-button" onClick={() => setOpen((shown) => !shown)} aria-expanded={open}>
        {open ? "Hide the list of posts" : "Show the list of posts"}
      </button>
      {open ? (
        <>
          <ul className="seal-list">
            {sealed.list.map((row) => (
              <li key={row.postId}>
                {`${dateTime(row.createdAt)} `}
                <code>{row.postId}</code>
                {` ${counted(row.images, "image", "images")}`}
              </li>
            ))}
          </ul>
          {more > 0 ? <p>{`and ${more} more: use the runbook's query for a seal's posts`}</p> : null}
        </>
      ) : null}
    </>
  );
}

/**
 * 3e Task 4 (design, section 8.5): under the decision that holds a suspension or a termination, the person's reply: its
 * text in a frame of its own ([reply.empty] when there is none), when it was filed and where that leaves the measure
 * ([reply.onTime], [reply.late], [reply.lateEnded]), or that the decision which broke its basis answered it
 * ([reply.basisGone]); and "Answer this reply" for whoever may. The text is read here, in the case's logged read only.
 */
function ReplyBlock({ decision, compose }: { decision: CaseDecision; compose: CaseScreenViewProps["compose"] }) {
  const found = replyOf(decision);
  if (found === null) return null;
  const { measure, reply } = found;
  const state = replyState(measure, reply);
  const where =
    state === "onTime"
      ? STANDING_WORDS.reply.onTime
      : state === "late"
        ? STANDING_WORDS.reply.late
        : state === "lateEnded"
          ? STANDING_WORDS.reply.lateEnded(dateTime(measure.period?.endsAt ?? ""))
          : state === "basisGone"
            ? STANDING_WORDS.reply.basisGone
            : STANDING_WORDS.reply.answered(dateTime(reply.answeredAt ?? ""));
  const waiting = state === "onTime" || state === "late" || state === "lateEnded";
  return (
    <div className="reply" role="group" aria-label={STANDING_WORDS.reply.blockTitle}>
      <h4>{STANDING_WORDS.reply.blockTitle}</h4>
      {reply.text === null ? <p className="hint">{STANDING_WORDS.reply.empty}</p> : <Frame by={STANDING_WORDS.reply.writtenBy} text={reply.text} />}
      <p>
        {"Filed on "}
        <time dateTime={reply.filedAt}>{dateTime(reply.filedAt)}</time>.
      </p>
      <p className="hint">{where}</p>
      {compose !== undefined && waiting ? (
        <>
          <AnswerControl decision={decision} role={compose.role} disabled={compose.busy} onAnswer={compose.onAnswer} />
          {decision.needsAdmin && compose.role !== "admin" ? <p className="hint">{STANDING_WORDS.reply.admin}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * 3d (design, section 8.4): under a seal for good's decision, where its files are, from its `custody` (counts and one
 * time, never a file's name): [case.custody.in] while the seal is in force, adding that the others are still in the
 * image store while some but not all are moved; [case.custody.return] while a lifted seal's files are still in the
 * quarantine; [case.custody.lost] in its form for a seal that stands or one that was lifted.
 */
function CustodyLines({ decision }: { decision: CaseDecision }) {
  const custody = decision.custody;
  if (custody === undefined) return null;
  const inForce = decision.actions.some((action) => action.kind === "seal_media" && action.inForce);
  const W = CUSTODY_WORDS;
  return (
    <div className="custody">
      {inForce ? (
        <p className={custody.moved + custody.lost < custody.files ? "notice" : "hint"}>
          {W.custodyIn(custody.moved, custody.files, custody.movedAt === null ? null : bothTimes(custody.movedAt))}
          {custody.moved > 0 && custody.moved + custody.lost < custody.files ? ` ${W.custodyInRest}` : ""}
        </p>
      ) : null}
      {custody.toReturn > 0 ? <p className="notice">{W.custodyReturn(custody.toReturn, custody.lost)}</p> : null}
      {custody.lost > 0 ? <p className="error">{W.custodyLost(custody.lost, inForce)}</p> : null}
    </div>
  );
}

/** 3d Task 2: the release of a seal for good, as the case page runs it: whose role, whether a release is on its way, and its refusal. */
export interface ReleaseProps {
  role: StaffRole;
  busy: boolean;
  error: string | null;
  onRelease(decision: CaseDecision): void;
}

/** The params the key signs for the next release of this seal: the posts as the page shows them, the ground leave, and the recorded leave with its reference. */
export function releaseParams(release: SealRelease): SealReleasedParams | null {
  // 3d review M1: a moderator's answer has no leave at all; neither answer signs anything without one.
  if (release.leave === null || release.leave === undefined || release.postIds.length === 0) return null;
  return { postIds: [...release.postIds], basis: "leave", leaveId: release.leave.id, theirReference: release.leave.reference };
}

/** "The author may be told" (8.5): at once; not yet, by the leave's own mark; or not yet, by the record of the report or an order. */
function tellWords(release: SealRelease): string {
  const W = RELEASE_WORDS.facts.tell;
  if (!release.tellHeld) return W.atOnce;
  const leave = release.leave ?? null;
  if (leave !== null && leave.untold && (leave.untoldUntil === null || Date.parse(leave.untoldUntil) > Date.now())) return W.untold(leave.untoldUntil === null ? null : bothTimes(leave.untoldUntil));
  return W.record;
}

/**
 * 3d Task 2 (design, sections 7.2 and 8.5): the block "Release" under a seal for good in force: the facts of
 * release_facts, each a label and a value, then the words. An authority's assessment is shown as what it is and offers no
 * control; the one control, "Release and destroy", is offered only while a leave or an instruction to destroy is recorded.
 * The reference of the authority and the leave's are drawn framed. No image is requested or drawn here. 3d review M1: the
 * block is an admin's (11.4): a moderator, whose answer holds neither the authority's reference and assessment nor the
 * leave, is shown none of it.
 */
function ReleaseBlock({ decision, release }: { decision: CaseDecision; release: ReleaseProps | undefined }) {
  const whole = decision.release;
  const admin = release?.role === "admin";
  if (whole === undefined || !admin) return null;
  // An admin's answer holds every member; the four of the admin's block read as none should one be missing.
  const facts = { ...whole, theirReference: whole.theirReference ?? null, answer: whole.answer ?? null, answeredAt: whole.answeredAt ?? null, leave: whole.leave ?? null };
  const W = RELEASE_WORDS;
  const F = W.facts;
  const params = releaseParams(facts);
  const day = (at: string | null, none: string) => (at === null ? none : bothTimes(at));
  return (
    <section className="block release" aria-labelledby={`release-${decision.id}`}>
      <h4 id={`release-${decision.id}`}>{W.title}</h4>
      <dl>
        <dt>{F.reported.label}</dt>
        <dd>{facts.reported ? F.reported.yes : F.reported.no}</dd>
        <dt>{F.theirReference.label}</dt>
        <dd>{facts.theirReference === null ? F.theirReference.none : <Frame by={F.theirReference.frame} text={facts.theirReference} />}</dd>
        <dt>{F.answer.label}</dt>
        <dd>{facts.answer === null ? F.answer.none : F.answer.values[facts.answer]}</dd>
        <dt>{F.answeredAt.label}</dt>
        <dd>{day(facts.answeredAt, F.answeredAt.none)}</dd>
        <dt>{F.handedOverAt.label}</dt>
        <dd>{day(facts.handedOverAt, F.handedOverAt.none)}</dd>
        <dt>{F.leave.label}</dt>
        <dd>{facts.leave === null ? F.leave.none : F.leave.from[facts.leave.from]}</dd>
        <dt>{F.leaveReference.label}</dt>
        <dd>{facts.leave === null ? F.leaveReference.none : <Frame by={F.theirReference.frame} text={facts.leave.reference} />}</dd>
        <dt>{F.leaveDay.label}</dt>
        <dd>{facts.leave === null ? F.leaveDay.none : facts.leave.receivedOn}</dd>
        <dt>{F.tell.label}</dt>
        <dd>{tellWords(facts)}</dd>
        <dt>{F.quarantined.label}</dt>
        <dd>{facts.quarantined ? F.quarantined.yes : F.quarantined.no}</dd>
        <dt>{F.preserved.label}</dt>
        <dd>{facts.preserved ? F.preserved.yes : F.preserved.no}</dd>
      </dl>
      {facts.releasedAt !== null && facts.backupsClearAt !== null ? (
        <p className="notice">
          {W.done(bothTimes(facts.releasedAt), facts.releasedPosts, facts.releasedImages, decision.custody?.filesLeft ?? 0, facts.noticeHeld === true, bothTimes(facts.backupsClearAt))}
        </p>
      ) : null}
      <p>{W.what}</p>
      <p>{W.tells}</p>
      <p className="hint">{W.backups(RETENTION.backupDays)}</p>
      {facts.silenceDays === null ? <p className="hint">{W.periodUnset}</p> : null}
      {facts.leave === null ? (
        <p className="notice">{facts.answer === "illegal" ? W.assessed : facts.answer === "not_illegal" ? W.notIllegal : W.nothing}</p>
      ) : (
        <>
          {facts.answer === "not_illegal" ? <p className="error">{W.conflict}</p> : null}
          <p>{W.leave(F.leave.from[facts.leave.from]!)}</p>
        </>
      )}
      {facts.remaining > 0 ? <p className="notice">{W.more(RELEASE_POSTS_MAX, facts.remaining)}</p> : null}
      {params === null ? null : (
        <div className="actions">
          <p className="hint">{W.sign(params.postIds.length)}</p>
          {release?.error ? (
            <p role="alert" className="error">
              {release.error}
            </p>
          ) : null}
          <button type="button" disabled={release === undefined || release.busy} aria-busy={release?.busy === true} onClick={() => release?.onRelease(decision)}>
            {W.button}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * 3d Task 6 (section 8.4): what a program's decision was, in the console's words: [case.auto] with its one measure and the
 * statement its author was sent, drawn again from the decision, and while a withhold of an image is in force [case.autoR1].
 * The statement of a measure this version cannot word is left out rather than guessed; Task 7's seal on a match, with
 * [case.autoR2], is worded.
 */
function ProgramDecision({ decision, view }: { decision: CaseDecision; view: CaseView }) {
  const measure = decision.actions.find((action) => MEASURES[action.kind].lifts === null);
  let paragraphs: string[] = [];
  try {
    paragraphs = statementParagraphs(programStatementOf(view, decision));
  } catch {
    paragraphs = [];
  }
  return (
    <>
      <p className="notice">{AUTOMATION_WORDS.caseAuto(bothTimes(decision.decidedAt), measure === undefined ? "" : MEASURES[measure.kind].label)}</p>
      {paragraphs.length === 0 ? null : (
        <div className="frame preview">
          {paragraphs.map((paragraph, index) => (
            <p key={index} className="frame-text">
              <UserText>{paragraph}</UserText>
            </p>
          ))}
        </div>
      )}
      {measure?.kind === "withhold_media" && measure.inForce ? <p className="hint">{AUTOMATION_WORDS.caseAutoR1}</p> : null}
      {/* 3d Task 7 [case.autoR2]: a program's seal of a post's images, which only an admin answers. */}
      {measure?.kind === "seal_media" && measure.inForce ? <p className="hint">{AUTOMATION_WORDS.caseAutoR2}</p> : null}
    </>
  );
}

function Decision({ decision, view, compose, release }: { decision: CaseDecision; view: CaseView; compose: CaseScreenViewProps["compose"]; release?: ReleaseProps }) {
  const lifted = (id: string | null) => {
    const by = id === null ? undefined : view.decisions.find((other) => other.id === id);
    return by ? `lifted by the decision of ${dateTime(by.decidedAt)}` : "lifted";
  };
  return (
    <li className="panel decision">
      <p>
        <strong>{DECISION_KINDS[decision.kind]}</strong>
        {`: ${DECISION_OUTCOMES[decision.outcome]}, ${dateTime(decision.decidedAt)}, `}
        {decision.byProgram || decision.staffHandle === null ? (
          // 3d Task 6 (section 8.4): a decision without a decider, listed with the chip in the place of a staff handle.
          <span className="chip">{AUTOMATION_WORDS.byProgram}</span>
        ) : (
          <>
            {"by "}
            <UserText>{decision.staffHandle}</UserText>
          </>
        )}
        {decision.ground === null ? "" : decision.ground === "illegal" ? "; on the law" : `; under ${decision.ruleId ?? "a rule"}`}
        {`; ${categoryLabel(decision.category)}.`}
      </p>
      {decision.byProgram ? <ProgramDecision decision={decision} view={view} /> : null}
      {decision.suspect ? <p className="hint">Taken on a report or finding of child sexual abuse material.</p> : null}
      {decision.unseen ? <p className="notice">Taken while nobody could open the post's images: what it answered about an image was answered unseen.</p> : null}
      {decision.needsAdmin ? <p className="hint">An admin's decision.</p> : null}
      {decision.facts === null ? null : <Frame by="Facts. Written by staff" text={decision.facts} />}
      {decision.reason === null ? null : <Frame by="Reason. Written by staff" text={decision.reason} />}
      {decision.legalReference === null ? null : <Frame by="Legal reference. Written by staff" text={decision.legalReference} />}
      {decision.actions.length === 0 ? null : (
        <ul>
          {decision.actions.map((action) => (
            <li key={action.id}>
              {MEASURES[action.kind].label}
              {action.mediaId === null ? null : (
                <>
                  {" "}
                  <code>{action.mediaId}</code>
                </>
              )}
              {MEASURES[action.kind].lifts !== null
                ? ""
                : action.inForce
                  ? ": in force"
                  : action.liftedBy !== null
                    ? `: ${lifted(action.liftedBy)}`
                    : action.kind === "seal_media"
                      ? ": ended with the admin's answer"
                      : ": ended with the case's decision"}
              {action.noEffect === null ? "" : "; changed nothing when imposed"}
              {action.kind === "strike" && action.countsUntil !== null ? `; counts until ${dateTime(action.countsUntil)}` : ""}
              {action.kind === "retire_handle" && action.handle !== undefined ? `; the handle @${action.handle}` : ""}
              {action.kind === "warn_reporting" && action.countsUntil !== null ? `; counts until ${dateTime(action.countsUntil)}` : ""}
              {action.kind === "restrict_reporting" && action.days !== null ? `; ${action.days} ${action.days === 1 ? "day" : "days"}` : ""}
              {action.kind === "reset_display_name" || action.kind === "reset_bio" ? "; written once; the field as it reads now is shown above" : ""}
              {action.kind === "disable_by_order" && action.withholdAuthor !== undefined ? `; ${action.withholdAuthor ? ORDER_WORDS.caseOrder.withheld : ORDER_WORDS.caseOrder.shown}` : ""}
              {action.kind === "reinstate_by_order" && action.orderGround !== undefined ? `: ${ORDER_GROUND_LABELS[action.orderGround]}` : ""}
              {action.sealed === null ? null : <SealList sealed={action.sealed} />}
            </li>
          ))}
        </ul>
      )}
      <CustodyLines decision={decision} />
      <ReleaseBlock decision={decision} release={release} />
      {compose === undefined ? null : <CorrectControl view={view} decision={decision} role={compose.role} disabled={compose.busy} onCorrect={compose.onCorrect} />}
      {compose === undefined ? null : <WithdrawControl view={view} decision={decision} role={compose.role} disabled={compose.busy} onWithdraw={compose.onWithdraw} />}
      {compose === undefined ? null : <WithdrawMarksControl view={view} decision={decision} role={compose.role} disabled={compose.busy} onWithdrawMarks={compose.onWithdrawMarks} />}
      {compose === undefined || compose.onReinstate === undefined ? null : <ReinstateControl decision={decision} role={compose.role} disabled={compose.busy} onReinstate={compose.onReinstate} />}
      <ReplyBlock decision={decision} compose={compose} />
    </li>
  );
}

/** One event of the history in the console's words. A staff member is named by their handle, as text. */
function historyWords(entry: CaseHistoryEntry): string {
  switch (entry.event) {
    case "item":
      return `Item ${entry.seq ?? ""} arrived${entry.reexamination ? " (a re-examination)" : ""}: ${entry.intakeKind === "order" ? "an authority's order" : entry.intakeKind === "finding" ? "a moderator's finding" : entry.intakeKind === "automated" ? AUTOMATION_WORDS.historyItem : entry.csam ? "a notice of child sexual abuse material" : entry.allegesIllegal ? "a notice under Art. 16" : "a report"}${entry.ruleId === null ? "" : `, ${entry.ruleId}`}`;
    case "snapshot":
      return "A snapshot was taken";
    case "decision":
      return `${entry.decisionKind === null ? "Decision" : DECISION_KINDS[entry.decisionKind]}: ${entry.outcome === null ? "" : DECISION_OUTCOMES[entry.outcome]}`;
    case "appeal_filed":
      return "The author appealed";
    case "appeal_answered":
      return `The appeal was answered: ${entry.result === null ? "" : entry.result.split("_").join(" ")}`;
    case "note":
      return "A note was saved";
    case "seal_declined":
      return "Chose not to seal";
    case "reveal":
      return "A source was revealed";
    case "evidence_erased":
      return "A snapshot's content was erased";
    case "redaction":
      return "Content was erased when an R4 decision became final";
  }
}

/**
 * The author's standing on a post case (3e design, section 8.2), above the evidence and in bands, as D 8 words a
 * reporter's summary: so that the moderator knows what a strike here leads to, never as a reason to find a breach.
 */
function AuthorStandingBands({ view }: { view: CaseView }) {
  const standing = view.authorStanding;
  if (standing === null) return null;
  return (
    <section className="panel standing" aria-labelledby="standing-title">
      <h3 id="standing-title">The author's standing</h3>
      <ul className="plain">
        <li>{STANDING_WORDS.bands.activeStrikes[standing.activeStrikes]}</li>
        <li>{STANDING_WORDS.bands.suspensionsInYear[standing.suspensionsInYear]}</li>
        <li>{STANDING_WORDS.bands.now[standing.now]}</li>
      </ul>
      <p className="hint">{STANDING_WORDS.postStanding}</p>
    </section>
  );
}

export function CaseScreenView(props: CaseScreenViewProps) {
  const { view, busy, notice, error, note } = props;
  return (
    <section aria-labelledby="case-title">
      <h2 id="case-title">{view.target.type === "post" ? "Case about a post" : "Case about an account"}</h2>
      <p>
        {`${LANE_NAMES[view.lane]}${view.lane === 0 ? " lane" : ""}; opened ${dateTime(view.openedAt)}; version ${view.stateVersion}`}
        {view.closedAt === null ? "" : `; closed ${dateTime(view.closedAt)}`}
      </p>
      {/* 3d Task 8 (section 8.4): [case.flag] under the header, with its chip; counts only, never a reporter. */}
      {view.flag === null ? null : (
        <p className="notice">
          <span className="chip">{AUTOMATION_WORDS.queueFlag}</span> <span>{AUTOMATION_WORDS.caseFlag(view.flag.items, view.flag.reporters)}</span>
        </p>
      )}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {view.lane === 0 ? <p className="banner art18">{ART_18_BANNER}</p> : null}
      <SuspectBanner view={view} onOpenCase={props.onOpenCase} />
      <AuthorStandingBands view={view} />
      {/* 3d Task 6 (section 8.4): [case.objection], while the measure the author asked about is in force; the text is theirs. */}
      {view.objection === null ? null : (
        <section className="panel objection" aria-label={AUTOMATION_WORDS.queue.objected}>
          <p className="notice">{AUTOMATION_WORDS.objection.lead(bothTimes(view.objection.createdAt))}</p>
          <Frame by={AUTOMATION_WORDS.objection.by} text={view.objection.text} />
          <p className="hint">{AUTOMATION_WORDS.objection.tail}</p>
        </section>
      )}

      <h3>Evidence</h3>
      {/* 3f (design, section 8.6): a post preserved under an order shows no text and no image; korbat's rules are its own. */}
      {view.preserved ? <p className="notice">{ORDER_WORDS.caseOrder.preserved}</p> : null}
      {view.decisions.some((decision) => decision.kind === "order") ? <p className="hint">{ORDER_WORDS.caseOrder.own}</p> : null}
      {view.noticeHeld === null ? null : <p className="notice">{ORDER_WORDS.caseOrder.heldToo(view.noticeHeld.until === null ? null : dateTime(view.noticeHeld.until))}</p>}
      {/* 3f Task 5 (sections 7.13 and 8.6): a report to the authorities owed for this case, since when; nothing more. */}
      {view.reportOwed === null ? null : <p className="notice">{ORDER_WORDS.caseOwed(bothTimes(view.reportOwed.since))}</p>}
      <Target view={view} />
      {targetDiffers(view) ? (
        <button type="button" onClick={props.onSnapshot} disabled={busy !== null} aria-busy={busy === "snapshot"}>
          Take a fresh snapshot
        </button>
      ) : null}
      {view.snapshots.length === 0 ? <p className="quiet">The case holds no snapshot.</p> : null}
      {view.snapshots.map((snapshot, index) => (
        <Snapshot key={snapshot.id} snapshot={snapshot} newest={index === 0} props={props} />
      ))}
      {/* The images' list says so itself, above its entries; a case whose newest snapshot shows no content has no list. */}
      {view.target.type === "post" && !view.imagesAllowed && (view.snapshots[0] === undefined || view.snapshots[0].withheld) ? <p className="notice">{IMAGES_NOT_SHOWN}</p> : null}

      <h3>Items</h3>
      <ul className="plain">
        {view.items.map((item) => (
          <Item key={item.id} item={item} props={props} />
        ))}
      </ul>

      <h3>Decisions</h3>
      {view.decisions.length === 0 ? (
        <p className="quiet">No decision yet.</p>
      ) : (
        <ul className="plain">
          {view.decisions.map((decision) => (
            <Decision key={decision.id} decision={decision} view={view} compose={props.compose} {...(props.release === undefined ? {} : { release: props.release })} />
          ))}
        </ul>
      )}
      {view.appeals.map((appeal) => {
        const appealed = view.decisions.find((decision) => decision.id === appeal.decisionId);
        return (
          <div key={appeal.id} className="panel">
            <p>{`The author appealed${appealed ? ` the decision of ${dateTime(appealed.decidedAt)}` : ""} on ${dateTime(appeal.filedAt)}${appeal.result === null ? "; not answered yet" : `; answered: ${appeal.result.split("_").join(" ")}`}.`}</p>
            {appeal.statement === null ? null : <Frame by="Written by the appellant" text={appeal.statement} />}
            {/* A pending appeal says who may review it; the control stands only for the person the API marked. */}
            {appeal.result !== null ? null : (
              <>
                {appeal.needsAdmin ? <p className="hint">{APPEAL_WORDS.needsAdmin}</p> : null}
                {appeal.reviewer === null || appeal.reviewer === "available" ? null : <p className="notice">{APPEAL_WORDS.reviewer[appeal.reviewer]}</p>}
                {appeal.mayReview ? null : <p className="hint">{APPEAL_WORDS.mayNotReview}</p>}
                {props.compose === undefined || !appealed ? null : <ReviewControl view={view} decision={appealed} disabled={props.compose.busy} onReview={props.compose.onReview} />}
              </>
            )}
          </div>
        );
      })}

      <h3>History</h3>
      <ol className="history">
        {view.history.map((entry, index) => (
          <li key={`${entry.at} ${entry.event} ${entry.refId ?? index}`}>
            <time dateTime={entry.at}>{dateTime(entry.at)}</time>
            {` ${historyWords(entry)}`}
            {entry.staffHandle === null ? null : (
              <>
                {", by "}
                <UserText>{entry.staffHandle}</UserText>
              </>
            )}
          </li>
        ))}
      </ol>

      <h3>Notes</h3>
      <p className="hint">Notes are for staff only and go with the case's evidence.</p>
      {view.notes.length === 0 && view.sealsDeclined.length === 0 ? <p className="quiet">No note yet.</p> : null}
      {view.notes.map((text) => (
        <div key={text.id}>
          <p>
            <UserText>{text.staffHandle}</UserText>
            {`, ${dateTime(text.createdAt)}`}
          </p>
          <Frame by="Note. Written by staff" text={text.text} />
        </div>
      ))}
      {view.sealsDeclined.map((text) => (
        <div key={text.id}>
          <p>
            {"Chose not to seal: "}
            <UserText>{text.staffHandle}</UserText>
            {`, ${dateTime(text.createdAt)}`}
          </p>
          <Frame by="Reason. Written by staff" text={text.text} />
        </div>
      ))}
      <label htmlFor="case-note">Add a note</label>
      <textarea id="case-note" rows={3} value={note} disabled={busy !== null} onChange={(event) => props.onNoteChange(event.target.value)} />
      <div className="actions">
        <button type="button" onClick={props.onNoteSave} disabled={busy !== null || note.trim() === ""} aria-busy={busy === "note"}>
          Save the note
        </button>
      </div>

      {props.again ? <p className="notice">{props.again}</p> : null}
      {props.compose === undefined ? null : <ComposerView view={view} {...props.compose} />}
    </section>
  );
}

export function CaseScreen({
  id,
  api,
  credentials,
  role,
  drafts,
  onOpenCase,
  onOpenOrder,
  gap = null,
  onGapTaken,
}: {
  id: CaseId;
  api: StaffApi;
  credentials: CredentialsLike;
  role: StaffRole;
  drafts: DraftSlots;
  onOpenCase(id: CaseId): void;
  onOpenOrder?: (id: OrderId) => void;
  /** 3f Task 6: the restore gap this case was opened for from After a restore: the decision confirmed here closes it. */
  gap?: { id: string; actedAt: string } | null;
  /** Told once a decision that named the gap has been recorded. */
  onGapTaken?: () => void;
}) {
  const [view, setView] = useState<Loadable<CaseView>>({ state: "loading" });
  const [shownImage, setShownImage] = useState<ShownImage | null>(null);
  // 3d Task 6 (section 8.4, [case.r1]): every image this person opened on this case, which the API logged as viewed: the
  // composer's preview says from it whether the decision follows a look at the image a program rated.
  const [viewedImages, setViewedImages] = useState<string[]>([]);
  const [busy, setBusy] = useState<"snapshot" | "note" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  // The composer's draft lives in the store's slot for this case, so that it is still there after a session that ended
  // and a sign-in by the same handle; the page keeps its own copy to draw.
  const [draft, setDraft] = useState<CaseDraft | null>(() => drafts.get(id));
  const draftNow = useRef<CaseDraft | null>(draft);
  /** The decision's draft that a correction or a review took the place of, to come back to when that is put away. */
  const beforeCorrection = useRef<CaseDraft | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [textErrors, setTextErrors] = useState<Partial<Record<DraftTextKind, string>>>({});
  /** The saves of texts that are on their way, by the text's kind: a confirmation waits for them, so that no text is saved twice. */
  const saving = useRef(new Map<DraftTextKind, Promise<void>>());
  const [declining, setDeclining] = useState<{ reason: string; busy: boolean; error: string | null } | null>(null);
  const alive = useRef(true);
  /** What the page shows of the case, as the last read left it: a read that fails is judged against it. */
  const page = useRef<Loadable<CaseView>>({ state: "loading" });

  /** Keeps a draft: in the store's slot, and on the page. */
  const keep = (next: CaseDraft) => {
    drafts.set(next);
    draftNow.current = next;
    setDraft(next);
  };

  /** A case with no draft yet gets a fresh one, with the texts its person saved on it before (a reload fetches them back). */
  const openDraft = async (value: CaseView) => {
    if (draftNow.current !== null) return;
    const fresh = await withSavedTexts(newDraft(id, value, role), value.drafts);
    if (!alive.current || draftNow.current !== null) return;
    // Not put into the store's slot before its person changes it: an untouched draft is made again from the case.
    draftNow.current = fresh;
    setDraft(fresh);
  };

  /**
   * Reads the case: its person opened the page or acted on it, so the read is marked. True when the page now shows what
   * was just read. A read that fails after the first keeps the page and uses its error line (afterFailedRead).
   */
  const read = (): Promise<boolean> =>
    api.caseView(id, { activity: true }).then(
      (value) => {
        if (!alive.current) return false;
        page.current = { state: "ready", value };
        setView(page.current);
        void openDraft(value);
        return true;
      },
      (err: unknown) => {
        if (!alive.current) return false;
        const failed = afterFailedRead(page.current, err);
        page.current = failed.view;
        setView(failed.view);
        if (failed.error !== null) setError(failed.error);
        return false;
      },
    );

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
    // Read once per opening of the page; the API client never changes while the page lives.
  }, [api, id]);

  const snapshot = async () => {
    setBusy("snapshot");
    setNotice(null);
    setError(null);
    try {
      await api.takeSnapshot(id, { activity: true });
      // The snapshot's content is read with the case: that read is what the access log and the day's limit count.
      const fresh = await read();
      if (alive.current) setNotice(fresh ? "A fresh snapshot is the case's newest now." : "A fresh snapshot was taken. This page still shows the case as it was read before.");
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const saveNote = async () => {
    setBusy("note");
    setNotice(null);
    setError(null);
    try {
      await saveStaffText({ api }, id, "note", note);
      if (!alive.current) return;
      setNote("");
      const fresh = await read();
      if (alive.current) setNotice(fresh ? "The note is saved." : "The note is saved. This page still shows the case as it was read before.");
    } catch (err) {
      if (alive.current) setError(describeError(err, NOTE_WORDS));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const confirmReveal = async () => {
    if (reveal === null || reveal.busy || reveal.category === null || !revealReady(reveal)) return;
    const { itemId, category, reason } = reveal;
    setReveal({ ...reveal, busy: true, error: null });
    const outcome = await revealSource({ api, credentials }, id, itemId, category, reason);
    if (!alive.current) return;
    if ("error" in outcome) {
      setReveal((current) => (current === null ? null : { ...current, busy: false, error: outcome.error }));
      return;
    }
    setReveal((current) => (current === null ? null : { ...current, busy: false, answer: outcome.answer }));
    // The history gains the reveal. Should this read fail, the page and the name it shows stay as they are.
    void read();
  };

  /**
   * 3d Task 2 (section 7.2): "Release and destroy" on a seal for good, confirmed by the key with exactly the params the
   * block shows. The answer is the case as it now stands; a refusal is worded in place and the case is read again, since
   * the facts it rests on moved between the read and the key.
   */
  const release = async (decision: CaseDecision) => {
    const seal = decision.actions.find((action) => action.kind === "seal_media");
    const params = decision.release === undefined ? null : releaseParams(decision.release);
    if (releasing || seal === undefined || params === null) return;
    setReleasing(true);
    setReleaseError(null);
    try {
      const answer = await releaseWithKey({ api, credentials }, id, seal.id, params);
      if (!alive.current) return;
      page.current = { state: "ready", value: answer };
      setView(page.current);
    } catch (err) {
      if (!alive.current) return;
      setReleaseError(describeError(err));
      void read();
    } finally {
      if (alive.current) setReleasing(false);
    }
  };

  /** A text that is saved now: the refusal of an earlier save of it, worded under its field, no longer holds. */
  const textSaved = (kind: DraftTextKind) => setTextErrors((errors) => Object.fromEntries(Object.entries(errors).filter(([refused]) => refused !== kind)));

  /**
   * A text's field lost focus: the text is saved, without the key, so that a reload before the first confirmation brings
   * it back (3c design, section 7.4). A refusal is worded under its field. What was written stays in the draft either
   * way: a text whose save failed is saved again by the confirmation.
   */
  const saveText = (kind: DraftTextKind) => {
    const written = draftNow.current;
    if (written === null || composing) return;
    const run = (async () => {
      const outcome = await saveDraftText({ api }, id, written, kind);
      if (!alive.current || outcome === null) return;
      if ("error" in outcome) {
        setTextErrors((errors) => ({ ...errors, [kind]: outcome.error }));
        return;
      }
      textSaved(kind);
      // Remembered only while the draft still holds the text that was saved: its person may have typed on meanwhile.
      const now = draftNow.current;
      if (now !== null && now.kind === written.kind && normalised(now.written[kind]) === outcome.saved.text) keep({ ...now, texts: { ...now.texts, [kind]: outcome.saved } });
    })();
    saving.current.set(kind, run);
    void run.finally(() => {
      if (saving.current.get(kind) === run) saving.current.delete(kind);
    });
  };

  /**
   * "Confirm with your staff key": the draft as the composer showed it, saved, confirmed and sent; the page then shows
   * what the answer says now stands. The busy flag is confirmWhileBusy's: down again on every way out.
   */
  const confirm = () => {
    if (composing) return Promise.resolve();
    const confirming = {
      alive: () => alive.current,
      shown: () => (page.current.state === "ready" ? page.current.value : null),
      draft: () => draftNow.current,
      saving: () => [...saving.current.values()],
      setBusy: setComposing,
    };
    return confirmWhileBusy(confirming, async (shown, held) => {
      setComposeError(null);
      setNotice(null);
      setError(null);
      const sent = offeredDraft(shown, role, held);
      const outcome = await confirmDecision({ api, credentials, gap: gap?.id ?? null }, id, shown, sent, (kind, saved) => {
        // The confirmation saved a text whose save had failed when its field lost focus.
        textSaved(kind);
        if (draftNow.current !== null) keep({ ...draftNow.current, texts: { ...draftNow.current.texts, [kind]: saved } });
      });
      if (!alive.current) return;
      if ("error" in outcome) {
        // The refusal is worded in place and the draft kept. A text that is gone or was used is saved again at the next
        // try; a case or a snapshot that is no longer what the page shows is read again.
        const then = afterRefusal(outcome.code);
        if (then.saveAgain && draftNow.current !== null) keep({ ...draftNow.current, texts: {} });
        setComposeError(outcome.error);
        if (then.readAgain) void read();
        return;
      }
      const now = "view" in outcome ? outcome.view : outcome.fresh;
      page.current = { state: "ready", value: now };
      setView(page.current);
      if ("fresh" in outcome) {
        setNotice(outcome.notice);
        return;
      }
      // Decided: the draft is done with, and the composer starts anew on the case as it now stands.
      drafts.clear(id);
      // Task 6: the gap the decision named is closed with it; the next decision here is a new one.
      if (gap !== null) onGapTaken?.();
      beforeCorrection.current = null;
      draftNow.current = newDraft(id, now, role);
      setDraft(draftNow.current);
      setTextErrors({});
      setNotice(sent.kind === "review" ? COMPOSER.reviewed : decidedNotice(shown, now, sent.kind === "final"));
    });
  };

  /** "Do not seal now": the reason is saved as a text of its own kind, which is complete when saved, and the case is read again. */
  const declineSeal = async () => {
    if (declining === null || declining.busy) return;
    setDeclining({ ...declining, busy: true, error: null });
    try {
      await saveStaffText({ api }, id, "seal_declined", declining.reason);
      if (!alive.current) return;
      setDeclining(null);
      const fresh = await read();
      if (alive.current) setNotice(fresh ? COMPOSER.declined : `${COMPOSER.declined} This page still shows the case as it was read before.`);
    } catch (err) {
      if (alive.current) setDeclining((current) => (current === null ? null : { ...current, busy: false, error: describeError(err, NOTE_WORDS) }));
    }
  };

  /**
   * Opens a correction of Task 4 (an answer to a reply, a withdrawal) as "Correct this decision" opens one: the draft it
   * replaces is kept for Cancel, and the reason its person saved on this case before comes back, unless they have typed.
   */
  const openAnother = (value: CaseView, opened: CaseDraft) => {
    setComposeError(null);
    setTextErrors({});
    if (draftNow.current !== null && draftNow.current.kind !== "correction" && draftNow.current.kind !== "review") beforeCorrection.current = draftNow.current;
    keep(opened);
    void withSavedTexts(opened, value.drafts).then((restored) => {
      if (alive.current && draftNow.current === opened) keep(restored);
    });
  };

  const composeProps = (value: CaseView): CaseScreenViewProps["compose"] =>
    draft === null
      ? undefined
      : {
          role,
          draft,
          now: new Date(),
          viewedImages,
          busy: composing,
          error: composeError,
          textErrors,
          declining,
          onChange: (change) => {
            setComposeError(null);
            // A text that is typed on again is judged anew at its next save.
            if (change.written !== undefined) setTextErrors({});
            if (draftNow.current !== null) keep({ ...draftNow.current, ...change });
          },
          onTextBlur: saveText,
          onSeal: () => {
            setComposeError(null);
            if (draftNow.current !== null) keep(withSeal(value, offeredDraft(value, role, draftNow.current)));
          },
          onConfirm: () => void confirm(),
          onDeclineOpen: () => setDeclining({ reason: "", busy: false, error: null }),
          onDeclineChange: (reason) => setDeclining((current) => (current === null ? null : { ...current, reason })),
          onDeclineSave: () => void declineSeal(),
          onDeclineClose: () => setDeclining(null),
          onCorrect: (decision) => {
            setComposeError(null);
            setTextErrors({});
            if (draftNow.current !== null && draftNow.current.kind !== "correction" && draftNow.current.kind !== "review") beforeCorrection.current = draftNow.current;
            const opened = correctionDraft(id, value, decision, role);
            keep(opened);
            // The reason its person saved for a correction on this case before comes back with it, unless they have typed since.
            void openCorrection(id, value, decision, role).then((restored) => {
              if (alive.current && draftNow.current === opened) keep(restored);
            });
          },
          onReview: (decision) => {
            setComposeError(null);
            setTextErrors({});
            if (draftNow.current !== null && draftNow.current.kind !== "correction" && draftNow.current.kind !== "review") beforeCorrection.current = draftNow.current;
            const opened = reviewDraft(id, value, decision, role);
            keep(opened);
            // As for a correction: a review reason saved on this case before comes back, unless its person has typed since.
            void openReview(id, value, decision, role).then((restored) => {
              if (alive.current && draftNow.current === opened) keep(restored);
            });
          },
          // 3e Task 4: an answer to the reply, and the withdrawal of an announced measure, open as a correction does.
          onAnswer: (decision) => openAnother(value, answerDraft(id, value, decision, role)),
          onWithdraw: (decision) => openAnother(value, withdrawDraft(id, value, decision, role)),
          // 3e Task 5: the withdrawal of a decision's marks opens as a correction does.
          onWithdrawMarks: (decision) => openAnother(value, withdrawMarksDraft(id, value, decision, role)),
          // 3f Task 3: the reinstatement after an order opens as a correction does.
          onReinstate: (decision) => openAnother(value, reinstateDraft(id, value, decision, role)),
          onCancelCorrection: () => {
            setComposeError(null);
            setTextErrors({});
            keep(beforeCorrection.current ?? newDraft(id, value, role));
            beforeCorrection.current = null;
          },
        };

  return (
    <Loaded
      value={view}
      render={(value) => (
        <CaseScreenView
          caseId={id}
          view={value}
          compose={composeProps(value)}
          shownImage={shownImage}
          busy={busy}
          notice={notice}
          error={error}
          note={note}
          reveal={reveal}
          onOpenCase={onOpenCase}
          {...(onOpenOrder === undefined ? {} : { onOpenOrder })}
          again={gap === null ? null : RECOVERY_WORDS.again(bothTimes(gap.actedAt))}
          release={{ role, busy: releasing, error: releaseError, onRelease: (decision) => void release(decision) }}
          // One image at a time: showing another puts the first back behind its placeholder.
          onShowImage={(image) => {
            setShownImage({ id: image, clear: false, failed: false });
            setViewedImages((seen) => (seen.includes(image) ? seen : [...seen, image]));
          }}
          onShowClearly={() => setShownImage((current) => (current === null ? null : { ...current, clear: true }))}
          onHideImage={() => setShownImage(null)}
          // The image did not load: its place says so, and the case is read again, since what may be opened has
          // probably changed (a report froze the post, or its images were sealed, since the page read the case).
          onImageError={() => {
            setShownImage((current) => (current === null ? null : { ...current, failed: true }));
            void read();
          }}
          onSnapshot={() => void snapshot()}
          onNoteChange={setNote}
          onNoteSave={() => void saveNote()}
          onRevealOpen={(itemId) => setReveal({ itemId, category: null, reason: "", busy: false, error: null, answer: null })}
          onRevealChange={(change) => setReveal((current) => (current === null ? null : { ...current, ...change }))}
          onRevealConfirm={() => void confirmReveal()}
          onRevealClose={() => setReveal(null)}
        />
      )}
    />
  );
}
