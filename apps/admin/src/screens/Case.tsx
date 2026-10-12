import {
  MEASURES,
  REVEAL_REASON_CATEGORIES,
  SUSPECT_EARLIER_MONTHS,
  type CaseDecision,
  type CaseHistoryEntry,
  type CaseItem,
  type CaseSnapshot,
  type CaseView,
  type RevealReasonCategory,
  type RevealResponse,
} from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { Frame } from "../frames";
import { parseImageId, StaffImage, type ImageId } from "../media";
import { CASE_WORDS, DECISION_KINDS, DECISION_OUTCOMES, describeError, messageFor, NOTE_WORDS, OUTCOME_WORDS, REVEAL_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { revealWithKey } from "../step-up";
import { saveStaffText, type RandomBytes } from "../texts";
import { dateTime, Loaded, UserText, type Loadable } from "../ui";
import { categoryLabel, COLLAPSED_RULES, counted, LANE_NAMES, revealable, sourceWords, writtenBy } from "../words";
import type { CredentialsLike } from "../webauthn";

/**
 * The case page without its composer (3c design, sections 7.3 and 8): the header, the banners, the evidence with its
 * images, the items with their sources, the decisions, the history, the notes and the reveal of a source. Every string
 * someone wrote is drawn as text inside a frame that says who wrote it; every address is text, since the console holds
 * no link into the app; and an image is asked of the API only when its person asks to see it.
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
            const shown = openable && id !== null && shownImage?.id === id ? shownImage : null;
            return (
              <li key={image.id}>
                {openable ? (
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
                {image.alt === null ? (
                  <p className="quiet">Its alt text was erased.</p>
                ) : image.alt === "" ? (
                  <p className="quiet">No alt text.</p>
                ) : (
                  <Frame by="Alt text. Written by the author" text={image.alt} collapsedLabel={collapsed} />
                )}
                {!openable || id === null ? null : shown === null ? (
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
  const ground = item.csam ? "child sexual abuse material (notice)" : item.allegesIllegal ? "notice under Art. 16: illegal" : "breaks a rule";
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
      <p>{item.outcome === null ? "Unanswered." : `Answered: ${OUTCOME_WORDS[item.outcome]}.`}</p>
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

function Decision({ decision, view }: { decision: CaseDecision; view: CaseView }) {
  const lifted = (id: string | null) => {
    const by = id === null ? undefined : view.decisions.find((other) => other.id === id);
    return by ? `lifted by the decision of ${dateTime(by.decidedAt)}` : "lifted";
  };
  return (
    <li className="panel decision">
      <p>
        <strong>{DECISION_KINDS[decision.kind]}</strong>
        {`: ${DECISION_OUTCOMES[decision.outcome]}, ${dateTime(decision.decidedAt)}, by `}
        <UserText>{decision.staffHandle}</UserText>
        {decision.ground === null ? "" : decision.ground === "illegal" ? "; on the law" : `; under ${decision.ruleId ?? "a rule"}`}
        {`; ${categoryLabel(decision.category)}.`}
      </p>
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
              {action.kind === "reset_display_name" || action.kind === "reset_bio" ? "; written once; the field as it reads now is shown above" : ""}
              {action.sealed === null ? null : <SealList sealed={action.sealed} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One event of the history in the console's words. A staff member is named by their handle, as text. */
function historyWords(entry: CaseHistoryEntry): string {
  switch (entry.event) {
    case "item":
      return `Item ${entry.seq ?? ""} arrived${entry.reexamination ? " (a re-examination)" : ""}: ${entry.intakeKind === "finding" ? "a moderator's finding" : entry.csam ? "a notice of child sexual abuse material" : entry.allegesIllegal ? "a notice under Art. 16" : "a report"}${entry.ruleId === null ? "" : `, ${entry.ruleId}`}`;
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

export function CaseScreenView(props: CaseScreenViewProps) {
  const { view, busy, notice, error, note } = props;
  return (
    <section aria-labelledby="case-title">
      <h2 id="case-title">{view.target.type === "post" ? "Case about a post" : "Case about an account"}</h2>
      <p>
        {`${LANE_NAMES[view.lane]}${view.lane === 0 ? " lane" : ""}; opened ${dateTime(view.openedAt)}; version ${view.stateVersion}`}
        {view.closedAt === null ? "" : `; closed ${dateTime(view.closedAt)}`}
      </p>
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

      <h3>Evidence</h3>
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
            <Decision key={decision.id} decision={decision} view={view} />
          ))}
        </ul>
      )}
      {view.appeals.map((appeal) => (
        <div key={appeal.id} className="panel">
          <p>{`The author appealed on ${dateTime(appeal.filedAt)}${appeal.result === null ? "; not answered yet" : `; answered: ${appeal.result.split("_").join(" ")}`}.`}</p>
          {appeal.statement === null ? null : <Frame by="Written by the appellant" text={appeal.statement} />}
        </div>
      ))}

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
    </section>
  );
}

export function CaseScreen({ id, api, credentials, onOpenCase }: { id: CaseId; api: StaffApi; credentials: CredentialsLike; onOpenCase(id: CaseId): void }) {
  const [view, setView] = useState<Loadable<CaseView>>({ state: "loading" });
  const [shownImage, setShownImage] = useState<ShownImage | null>(null);
  const [busy, setBusy] = useState<"snapshot" | "note" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const alive = useRef(true);
  /** What the page shows of the case, as the last read left it: a read that fails is judged against it. */
  const page = useRef<Loadable<CaseView>>({ state: "loading" });

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

  return (
    <Loaded
      value={view}
      render={(value) => (
        <CaseScreenView
          caseId={id}
          view={value}
          shownImage={shownImage}
          busy={busy}
          notice={notice}
          error={error}
          note={note}
          reveal={reveal}
          onOpenCase={onOpenCase}
          // One image at a time: showing another puts the first back behind its placeholder.
          onShowImage={(image) => setShownImage({ id: image, clear: false, failed: false })}
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
