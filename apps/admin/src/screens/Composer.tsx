import {
  FINDING_CATEGORIES,
  MEASURES,
  ORDER_DRAFTS,
  ORDER_GROUNDS,
  ORDER_GROUND_LABELS,
  RULE_DEFAULT_CATEGORY,
  STANDING_RULES,
  type AppealsReviewedParams,
  type CaseDecision,
  type CaseView,
  type DecisionActionParams,
  type MeasureKind,
  type RuleId,
  type TdbCategory,
} from "@korbat/contracts";
import { ORDER_NOTICE, RULES, statementParagraphs, type StatementInput } from "@korbat/rules";
import {
  COMPOSER,
  complete,
  correctable,
  correctionChoices,
  holds,
  kindsOffered,
  lawOffered,
  leftOpen,
  liftable,
  liftedKind,
  hiddenWhileDeciding,
  imagesOffered,
  measuresOffered,
  markableItems,
  marksWithdrawable,
  reportingControlState,
  reportingKindOf,
  reversalLabel,
  unmarkableItems,
  withMark,
  withReporting,
  type ReportingClosed,
  type ReportingControl,
  AT_ONCE_DAYS,
  AT_ONCE_ORDER,
  answerable,
  atOnceState,
  ofControl,
  replyOf,
  standingControlState,
  suspensionOf,
  withAnswer,
  withAtOnce,
  withStanding,
  withdrawable,
  type AtOnceKey,
  type StandingClosed,
  type StandingControl,
  noEffectOf,
  offeredDraft,
  outcomesListed,
  previewOf,
  previewable,
  reinstatable,
  reinstateGroundOf,
  withReinstateGround,
  retireMoved,
  retireOpen,
  reviewChoices,
  reviewOutcomeOf,
  reviewable,
  sealOffered,
  snapshotImages,
  standingStrikeOf,
  strikeCarriesStanding,
  strikeLine,
  statementSent,
  suspectOpen,
  throughSeqOf,
  toggled,
  type CaseDraft,
  type DraftTextKind,
  type StaffRole,
} from "../compose";
import { APPEAL_WORDS, COMPOSER_KINDS, COMPOSER_OUTCOMES, COMPOSER_WORDS, messageFor, ORDER_WORDS, REVIEW_OUTCOMES, STANDING_WORDS } from "../messages";
import { dateTime, UserText } from "../ui";
import { categoryLabel } from "../words";

/**
 * The decision composer (3c design, section 8): the outcome first, then, for a restriction, the kind, the ground and the
 * measures this target and kind allow; the category; the facts and the reason; and the preview, which is the statement
 * exactly as its author will receive it. What it offers follows the case and the person's role; the database checks
 * every rule again when the key has confirmed. A correction ("Lift what was done while deciding", "Correct this
 * decision") takes the composer's place while it is open, and so does the review of an appeal ("Review this appeal").
 */

/** "Do not seal now": the reason as typed, and what became of saving it. */
export interface DecliningState {
  reason: string;
  busy: boolean;
  error: string | null;
}

export interface ComposerViewProps {
  view: CaseView;
  role: StaffRole;
  draft: CaseDraft;
  /** The time the preview is rendered for: the decision's time, were it confirmed now. */
  now: Date;
  busy: boolean;
  error: string | null;
  /** The refusal of a text's save, worded in place under its field. */
  textErrors: Partial<Record<DraftTextKind, string>>;
  declining: DecliningState | null;
  onChange(change: Partial<CaseDraft>): void;
  /** A text's field lost focus: the text is saved, without the key. */
  onTextBlur(kind: DraftTextKind): void;
  /** "Seal the images this case reaches". */
  onSeal(): void;
  onConfirm(): void;
  onDeclineOpen(): void;
  onDeclineChange(reason: string): void;
  onDeclineSave(): void;
  onDeclineClose(): void;
  onCancelCorrection(): void;
}

/**
 * The statement as its author will receive it, each paragraph as text in a frame of its own direction. In its place the
 * page says so when there is nothing to show yet (a restriction without a measure), nothing it can show (a post whose
 * snapshot cannot be shown: no creation time is made up), or nothing that is sent.
 */
function Preview({ view, draft, now }: Pick<ComposerViewProps, "view" | "draft" | "now">) {
  // A restriction without a measure has no statement yet: the page says so rather than show one that restricts nothing.
  if (draft.kind !== "correction" && draft.kind !== "review" && draft.outcome === "restricted" && !draft.actions.some((action) => MEASURES[action.kind].lifts === null)) {
    return <p className="hint">{COMPOSER.previewNeedsMeasure}</p>;
  }
  if (!previewable(view)) return <p className="hint">{COMPOSER_WORDS.previewAfterSnapshot}</p>;
  let input: StatementInput;
  let paragraphs: string[];
  try {
    input = previewOf(view, draft, now);
    paragraphs = statementParagraphs(input);
  } catch {
    return null;
  }
  // A decision that restricts nothing and ends nothing sends its author nothing: no statement is shown as if it were sent.
  if (!statementSent(input)) return <p className="hint">{COMPOSER_WORDS.noStatement}</p>;
  return (
    <div className="frame preview">
      <h4>Preview: the statement as its author will receive it</h4>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="frame-text">
          <UserText>{paragraph}</UserText>
        </p>
      ))}
      {draft.actions.some((action) => action.kind === "seal_media") ? <p className="hint">{COMPOSER_WORDS.sealSettled}</p> : null}
    </div>
  );
}

/** One of the draft's texts, as its person types it. It is saved when the field loses focus; a refusal of that save stands under the field. */
function TextField({ id, label, kind, rows, props, under }: { id: string; label: string; kind: DraftTextKind; rows: number; props: ComposerViewProps; under: string[] }) {
  const { draft } = props;
  const refused = props.textErrors[kind];
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={draft.written[kind]}
        disabled={props.busy}
        onChange={(event) => props.onChange({ written: { ...draft.written, [kind]: event.target.value } })}
        onBlur={() => props.onTextBlur(kind)}
      />
      {refused ? (
        <p role="alert" className="error">
          {refused}
        </p>
      ) : null}
      {under.map((sentence) => (
        <p key={sentence} className="hint">
          {sentence}
        </p>
      ))}
    </>
  );
}

function Confirm({ props, onCancel, label }: { props: ComposerViewProps; onCancel?: () => void; label?: string }) {
  const held = props.view.noticeHeld;
  return (
    <>
      {/* 3f (design, section 8.6): [case.heldToo] in the confirmation, while an order's notice about the post is held. */}
      {held === null ? null : <p className="notice">{ORDER_WORDS.caseOrder.heldToo(held.until === null ? null : dateTime(held.until))}</p>}
      {props.error ? (
        <p role="alert" className="error">
          {props.error}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="primary" onClick={props.onConfirm} disabled={props.busy || !complete(props.view, props.draft)} aria-busy={props.busy}>
          {label ?? "Confirm with your staff key"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={props.busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * 3e (design, section 8.7): beside a correction or a review of a decision whose strike stands, that the strike falls only
 * with its whole finding, and, when a suspension or termination that stands rests on it, what reversing it does.
 */
function StrikeNotes({ decision }: { decision: CaseDecision }) {
  if (standingStrikeOf(decision) === undefined) return null;
  return (
    <>
      <p className="hint">{STANDING_WORDS.reviewStrike}</p>
      {strikeCarriesStanding(decision) ? <p className="notice">{STANDING_WORDS.reviewRests}</p> : null}
    </>
  );
}

/** A correction of one decision: what of it to lift, the reason, and the preview. */
function CorrectionView(props: ComposerViewProps) {
  const { view, role, draft } = props;
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const choices = correctionChoices(view, draft, role);
  if (!decision || choices.length === 0) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">{COMPOSER.correctLabel}</h3>
        <p>Nothing of that decision is in force any more.</p>
        <div className="actions">
          <button type="button" onClick={props.onCancelCorrection}>
            Cancel
          </button>
        </div>
      </section>
    );
  }
  const deciding = decision.kind === "interim";
  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">{deciding ? COMPOSER.liftLabel : COMPOSER.correctLabel}</h3>
      <p>{`The decision of ${dateTime(decision.decidedAt)}. A correction only lifts: choose what of it to lift.`}</p>
      <ul className="plain">
        {choices.map(({ measure, reversal }) => (
          <li key={measure.id}>
            <label>
              <input type="checkbox" checked={holds(draft, reversal)} disabled={props.busy} onChange={(event) => props.onChange({ actions: toggled(draft, reversal, event.target.checked) })} />{" "}
              <span>{reversalLabel(measure, reversal)}</span>
              {measure.mediaId === null ? null : (
                <>
                  {" "}
                  <code>{measure.mediaId}</code>
                </>
              )}
            </label>
            {reversal.kind === "unseal_media" ? <p className="notice">{deciding ? COMPOSER.sealInError : COMPOSER.sealForGood}</p> : null}
            {/* 3e (design, section 8.7): [review.handle] beside "Give the handle back". */}
            {reversal.kind === "unretire_handle" ? <p className="hint">{STANDING_WORDS.reviewHandle}</p> : null}
          </li>
        ))}
      </ul>
      <StrikeNotes decision={decision} />
      <StandingNotes decision={decision} />
      <TextField id="compose-review-reason" label="Reason of the correction" kind="review_reason" rows={3} props={props} under={[COMPOSER.personalData]} />
      <Preview view={view} draft={draft} now={props.now} />
      <Confirm props={props} onCancel={props.onCancelCorrection} />
    </section>
  );
}

const REVIEW_ANSWERS: AppealsReviewedParams["outcome"][] = ["kept", "partly_reversed", "reversed"];

/**
 * The review of an appeal (3c design, section 8): Keep, Reverse in part or Reverse; the reversals of the decision's
 * measures that are still in force; the reason; and the preview of the review's statement. A review only lifts. "Keep"
 * lifts nothing and "Reverse" everything still in force, so the page sets those itself; "Reverse in part" is chosen
 * measure by measure. Once the appeal is answered, or for a person the API did not mark as its reviewer, nothing is
 * offered but the way back.
 */
function ReviewView(props: ComposerViewProps) {
  const { view, role, draft } = props;
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const offered = decision ? reviewable(view, decision) : null;
  if (!decision || offered === null) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">{COMPOSER.reviewLabel}</h3>
        <p>{APPEAL_WORDS.notYours}</p>
        <div className="actions">
          <button type="button" onClick={props.onCancelCorrection}>
            Cancel
          </button>
        </div>
      </section>
    );
  }
  const choices = reviewChoices(view, draft, role);
  const answer = reviewOutcomeOf(view, draft);
  // "Keep" lifts nothing and "Reverse" everything still in force; a part keeps what was chosen while it is one, and starts empty otherwise.
  const partial = draft.actions.length > 0 && draft.actions.length < choices.length;
  const choose = (next: AppealsReviewedParams["outcome"]) => props.onChange({ review: next, actions: next === "reversed" ? choices.map((choice) => choice.reversal) : next === "partly_reversed" && partial ? draft.actions : [] });
  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">{COMPOSER.reviewLabel}</h3>
      <p>{`The decision of ${dateTime(decision.decidedAt)}. A review keeps it or lifts measures of it, and never adds one.`}</p>
      <fieldset>
        <legend>Answer</legend>
        {REVIEW_ANSWERS.map((option) => (
          <label key={option}>
            <input type="radio" name="compose-review" checked={answer === option} disabled={props.busy} onChange={() => choose(option)} /> <span>{REVIEW_OUTCOMES[option]}</span>
          </label>
        ))}
      </fieldset>
      <ul className="plain">
        {choices.map(({ measure, reversal }) => (
          <li key={measure.id}>
            <label>
              {/* What "Keep" and "Reverse" lift follows from the answer: only a part is chosen measure by measure. */}
              <input type="checkbox" checked={holds(draft, reversal)} disabled={props.busy || answer !== "partly_reversed"} onChange={(event) => props.onChange({ actions: toggled(draft, reversal, event.target.checked) })} />{" "}
              <span>{reversalLabel(measure, reversal)}</span>
              {measure.mediaId === null ? null : (
                <>
                  {" "}
                  <code>{measure.mediaId}</code>
                </>
              )}
            </label>
            {reversal.kind === "unseal_media" ? <p className="notice">{COMPOSER.sealForGood}</p> : null}
            {reversal.kind === "unretire_handle" ? <p className="hint">{STANDING_WORDS.reviewHandle}</p> : null}
          </li>
        ))}
      </ul>
      <StrikeNotes decision={decision} />
      <StandingNotes decision={decision} />
      {/* 3e Task 4 (8.7): [review.reply] while the decision's reply waits, and [review.admin] for a decision that needed an admin. */}
      {replyOf(decision)?.reply.answeredAt === null ? <p className="notice">{STANDING_WORDS.reviewReply}</p> : null}
      {decision.needsAdmin ? <p className="hint">{STANDING_WORDS.reviewAdmin}</p> : null}
      <TextField id="compose-review-reason" label="Reason of the review" kind="review_reason" rows={3} props={props} under={[COMPOSER.personalData]} />
      <Preview view={view} draft={draft} now={props.now} />
      <Confirm props={props} onCancel={props.onCancelCorrection} />
    </section>
  );
}

/**
 * 3e (design, section 8.7): beside a review or a correction, what reversing the decision ends: a suspension (or
 * termination) taken at once that rests on it ([review.basis]); and for a decision that holds a protective suspension,
 * that its review does not wait for the authorities ([review.protective]).
 */
function StandingNotes({ decision }: { decision: CaseDecision }) {
  const basis = (decision.standingOn ?? []).some((entry) => entry.basis === "threat" || entry.basis === "terrorist" || entry.basis === "protective" || entry.basis === "threat_repeat");
  const protective = decision.actions.some((action) => action.kind === "suspend" && action.basis === "protective");
  // 3e Task 5: a restriction of reporting rests on this decision's warning ([review.warning]).
  const warning = (decision.standingOn ?? []).some((entry) => entry.kind === "restrict_reporting");
  if (!basis && !protective && !warning) return null;
  return (
    <>
      {basis ? <p className="notice">{STANDING_WORDS.reviewBasis}</p> : null}
      {protective ? <p className="hint">{STANDING_WORDS.reviewProtective}</p> : null}
      {warning ? <p className="notice">{STANDING_WORDS.reviewWarning}</p> : null}
    </>
  );
}

/** The sentence of one ground of a suspension at once, with the case answer's numbers where it has them. */
function groundSentence(view: CaseView, ground: AtOnceKey): string {
  const standing = view.standing;
  if (ground === "flood") return STANDING_WORDS.atOnce.flood(standing?.flood.posts ?? 0, dateTime(standing?.flood.from ?? ""), dateTime(standing?.flood.to ?? ""));
  if (ground === "protective") return standing?.seal ? STANDING_WORDS.atOnce.protective(standing.seal.decidedOn) : STANDING_WORDS.atOnce.noSeal;
  return STANDING_WORDS.atOnce[ground];
}

/** The sentence that greys "Suspend at once", by its key. */
const CLOSED_WORDS = {
  conflict: STANDING_WORDS.conflict,
  admin: STANDING_WORDS.atOnce.admin,
  other: STANDING_WORDS.atOnce.other,
  reportsFirst: STANDING_WORDS.reportsFirst,
  noSeal: STANDING_WORDS.atOnce.noSeal,
  unmet: STANDING_WORDS.atOnce.unmet,
} as const;

/**
 * 3e (design, section 8.3): "Suspend at once" on an account case's final restriction, offered to an admin when the ground
 * of the chosen rule is met, with its days, and greyed with its reason otherwise. The four grounds are listed, each marked
 * whether the database would accept it now. Choosing it adds the suspension and the ground's drafted facts.
 */
function AtOnce({ props }: { props: ComposerViewProps }) {
  const { view, role, draft } = props;
  const state = atOnceState(view, role, draft);
  if (state === null || view.standing === null) return null;
  const held = suspensionOf(draft);
  const max = state.ground === null ? 1 : AT_ONCE_DAYS[state.ground];
  const days = typeof held?.days === "number" ? held.days : max;
  const choose = (on: boolean, value: number) => {
    if (!state.open) return;
    props.onChange(on ? withAtOnce(view, draft, state.ground, Math.min(max, Math.max(1, value))) : { actions: draft.actions.filter((action) => action.kind !== "suspend") });
  };
  return (
    <li>
      <label>
        <input type="checkbox" checked={held !== undefined} disabled={props.busy || !state.open} onChange={(event) => choose(event.target.checked, days)} /> <span>{STANDING_WORDS.atOnce.label}</span>
      </label>
      {held !== undefined && state.open ? (
        <>
          {" "}
          <label htmlFor="compose-at-once-days">{STANDING_WORDS.atOnce.days(max)}</label>{" "}
          <input id="compose-at-once-days" type="number" min={1} max={max} value={days} disabled={props.busy} onChange={(event) => choose(true, Number(event.target.value) || 1)} />
        </>
      ) : null}
      {state.open ? null : <p className="hint">{CLOSED_WORDS[state.why]}</p>}
      <p className="hint">{STANDING_WORDS.atOnce.what}</p>
      <ul className="plain grounds">
        {AT_ONCE_ORDER.map((ground) => (
          <li key={ground}>
            <strong>{view.standing!.atOnce.includes(ground) ? STANDING_WORDS.atOnce.met : STANDING_WORDS.atOnce.unmet}</strong> <span>{groundSentence(view, ground)}</span>
          </li>
        ))}
      </ul>
      {held !== undefined ? (
        <>
          <p className="hint">{STANDING_WORDS.facts}</p>
          <p className="hint">{STANDING_WORDS.previewTimes}</p>
        </>
      ) : null}
    </li>
  );
}

/** The sentence that greys a control of Task 4, by its key. */
function standingClosedWords(view: CaseView, why: StandingClosed): string {
  switch (why) {
    case "conflict":
      return STANDING_WORDS.conflict;
    case "reportsFirst":
      return STANDING_WORDS.reportsFirst;
    case "short":
      return STANDING_WORDS.suspend.short(view.standing?.activeStrikes ?? 0);
    case "stale":
      return STANDING_WORDS.suspend.stale;
    case "notYet":
      return STANDING_WORDS.terminate.notYet;
    case "admin":
      return STANDING_WORDS.terminate.admin;
    case "noRepeat":
      return STANDING_WORDS.terminate.noRepeat;
    case "r2":
      return STANDING_WORDS.terminateR2;
  }
}

/**
 * 3e Task 4 (design, section 8.3): "Announce a suspension" with its days, "Announce a termination" and "Terminate at
 * once" on an account case's final restriction, each offered when the case answer says the database would accept it and
 * greyed with its reason otherwise. Choosing one puts any other suspension or termination away, sets the newest strike's
 * rule for a measure of the ladder, and drafts the facts.
 */
function StandingMeasureControl({ props, control }: { props: ComposerViewProps; control: StandingControl }) {
  const { view, role, draft } = props;
  const state = standingControlState(view, role, draft, control);
  const standing = view.standing;
  if (state === null || standing === null) return null;
  const held = draft.actions.find((action) => ofControl(action, control));
  const max = standing.maxDays ?? 1;
  const days = typeof held?.days === "number" ? held.days : max;
  const label = control === "announce" ? STANDING_WORDS.suspend.label : control === "announceTerminate" ? STANDING_WORDS.terminate.announceLabel : STANDING_WORDS.terminate.atOnceLabel;
  const choose = (on: boolean, value: number) => {
    if (!state.open) return;
    props.onChange(on ? withStanding(view, draft, control, control === "announce" ? Math.min(max, Math.max(1, value)) : null) : { actions: draft.actions.filter((action) => !ofControl(action, control)) });
  };
  const id = `compose-${control}`;
  return (
    <li>
      <label>
        <input type="checkbox" checked={held !== undefined} disabled={props.busy || !state.open} onChange={(event) => choose(event.target.checked, days)} /> <span>{label}</span>
      </label>
      {held !== undefined && state.open && control === "announce" ? (
        <>
          {" "}
          <label htmlFor={`${id}-days`}>{STANDING_WORDS.suspend.daysLabel(max)}</label>{" "}
          <input id={`${id}-days`} type="number" min={1} max={max} value={days} disabled={props.busy} onChange={(event) => choose(true, Number(event.target.value) || 1)} />
        </>
      ) : null}
      {state.open ? null : <p className="hint">{standingClosedWords(view, state.why)}</p>}
      {control === "announce" ? (
        <>
          <p className="hint">{STANDING_WORDS.suspend.what(days)}</p>
          {state.open && standing.maxDays !== null ? <p className="hint">{STANDING_WORDS.suspend.days(standing.maxDays, standing.suspensionsInYear + 1)}</p> : null}
          {state.open && standing.ladderRule !== null ? <p className="hint">{STANDING_WORDS.suspend.rule(standing.ladderRule)}</p> : null}
        </>
      ) : (
        <p className="hint">{STANDING_WORDS.terminate.what}</p>
      )}
      {held !== undefined ? (
        <>
          <p className="hint">{STANDING_WORDS.facts}</p>
          <p className="hint">{STANDING_WORDS.previewTimes}</p>
        </>
      ) : null}
    </li>
  );
}

/**
 * 3e Task 4 (design, section 8.5): the answer to the person's reply, a correction of the decision that holds the measure:
 * Keep or Reverse, with what each does by when the reply came, the reply's text, the reason for the person, and the
 * preview of the answer's statement.
 */
function AnswerView(props: ComposerViewProps) {
  const { view, role, draft } = props;
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const found = decision ? replyOf(decision) : null;
  if (!decision || found === null || !answerable(decision, role)) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">{STANDING_WORDS.reply.answerLabel}</h3>
        <p>Nothing is left to answer: the reply was answered, or its measure ended with the decision it rested on.</p>
        <div className="actions">
          <button type="button" onClick={props.onCancelCorrection}>
            Cancel
          </button>
        </div>
      </section>
    );
  }
  const { measure, reply } = found;
  const ended = measure.period?.state === "ended";
  const endsAt = measure.period?.endsAt ? dateTime(measure.period.endsAt) : "";
  const does =
    draft.answer === "kept"
      ? reply.onTime
        ? STANDING_WORDS.keep.onTime(dateTime(measure.earliestStart ?? ""), measure.kind === "terminate" ? null : measure.days)
        : ended
          ? STANDING_WORDS.keep.lateEnded(endsAt)
          : STANDING_WORDS.keep.late(endsAt)
      : reply.onTime
        ? STANDING_WORDS.reverse.onTime
        : ended
          ? STANDING_WORDS.reverse.lateEnded(endsAt)
          : STANDING_WORDS.reverse.late;
  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">{STANDING_WORDS.reply.answerLabel}</h3>
      <p>{`The reply of ${dateTime(reply.filedAt)} to the decision of ${dateTime(decision.decidedAt)}.`}</p>
      {reply.text === null ? (
        <p className="hint">{STANDING_WORDS.reply.empty}</p>
      ) : (
        <div className="frame">
          <h4>{STANDING_WORDS.reply.writtenBy}</h4>
          <p className="frame-text">
            <UserText>{reply.text}</UserText>
          </p>
        </div>
      )}
      <fieldset>
        <legend>Answer</legend>
        {(["kept", "reversed"] as const).map((option) => (
          <label key={option}>
            <input type="radio" name="compose-answer" checked={draft.answer === option} disabled={props.busy} onChange={() => props.onChange(withAnswer(draft, decision, option))} />{" "}
            <span>{option === "kept" ? STANDING_WORDS.reply.keepLabel : STANDING_WORDS.reply.reverseLabel}</span>
          </label>
        ))}
        <p className="hint">{does}</p>
      </fieldset>
      <p className="hint">{STANDING_WORDS.reply.same}</p>
      {decision.needsAdmin ? <p className="hint">{STANDING_WORDS.reply.admin}</p> : null}
      <TextField id="compose-review-reason" label="Reason of the answer" kind="review_reason" rows={3} props={props} under={[STANDING_WORDS.reply.reason, COMPOSER.personalData]} />
      <Preview view={view} draft={draft} now={props.now} />
      <Confirm props={props} onCancel={props.onCancelCorrection} />
    </section>
  );
}

/**
 * 3e Task 4 (design, section 8.7): "Withdraw it for another measure": a correction that lifts an announced measure that
 * has not started, signed `replaced`, to make room for a measure at once; with [replace.what], and [replace.reply] when a
 * reply waits, which the withdrawal closes without an answer on its merits.
 */
function WithdrawView(props: ComposerViewProps) {
  const { view, role, draft } = props;
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const measure = decision ? withdrawable(view, decision, role) : null;
  if (!decision || measure === null) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">{STANDING_WORDS.replace.label}</h3>
        <p>Nothing can be withdrawn: the measure has started, was lifted, or no other measure is waiting for room.</p>
        <div className="actions">
          <button type="button" onClick={props.onCancelCorrection}>
            Cancel
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">{STANDING_WORDS.replace.label}</h3>
      <p>{`The ${measure.kind === "terminate" ? "termination" : "suspension"} announced by the decision of ${dateTime(decision.decidedAt)}.`}</p>
      <p className="notice">{STANDING_WORDS.replace.what}</p>
      {measure.reply !== null && measure.reply.answeredAt === null ? <p className="hint">{STANDING_WORDS.replace.reply}</p> : null}
      <TextField id="compose-review-reason" label="Reason of the withdrawal" kind="review_reason" rows={3} props={props} under={[COMPOSER.personalData]} />
      <Preview view={view} draft={draft} now={props.now} />
      <Confirm props={props} onCancel={props.onCancelCorrection} />
    </section>
  );
}

/**
 * 3f Task 3 (design, section 8.6): "Reinstate", a correction of an order decision that lifts its measure on a ground the
 * admin chooses after checking the message it came in. The reason is the ground's fixed draft, shown and never edited;
 * the preview is the notice's reinstatement paragraphs (W.2).
 */
function ReinstateView(props: ComposerViewProps) {
  const { view, draft } = props;
  const W = ORDER_WORDS.caseOrder;
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const measure = decision ? reinstatable(decision) : null;
  const ground = reinstateGroundOf(draft);
  if (!decision || measure === null) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">{W.reinstate}</h3>
        <p>Nothing can be reinstated: the order's measure on this post is no longer in force.</p>
        <div className="actions">
          <button type="button" onClick={props.onCancelCorrection}>
            Cancel
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">{W.reinstate}</h3>
      <p>{`${MEASURES.disable_by_order.label}, by the decision of ${dateTime(decision.decidedAt)}.`}</p>
      <p className="notice">{W.reinstateWhat}</p>
      {view.orderErasedOn !== null ? <p className="notice">{W.reinstateErased(view.orderErasedOn)}</p> : null}
      <fieldset>
        <legend>What happened</legend>
        {ORDER_GROUNDS.map((each) => (
          <label key={each}>
            <input type="radio" name="reinstate-ground" checked={ground === each} disabled={props.busy} onChange={() => props.onChange(withReinstateGround(draft, each))} /> <span>{ORDER_GROUND_LABELS[each]}</span>
          </label>
        ))}
      </fieldset>
      <p className="hint">{W.reinstateTold}</p>
      {ground === "not_authentic" && view.noticeHeld !== null ? <p className="notice">{W.reinstateFake}</p> : null}
      {ground === null ? null : (
        <>
          <div className="frame">
            <h4>Reason: the fixed words of this ground, never edited</h4>
            <p className="frame-text">
              <UserText>{ORDER_DRAFTS.reinstate[ground]}</UserText>
            </p>
          </div>
          <div className="frame preview">
            <h4>Preview: the notice's reinstatement as its author will receive it</h4>
            {/* Task 4: after the preservation's end erased the post, the notice says that nothing can be shown again. */}
            {[ORDER_NOTICE.reinstated.ground[ground], view.orderErasedOn === null ? ORDER_NOTICE.reinstated.now : ORDER_NOTICE.reinstated.erased(view.orderErasedOn), ORDER_NOTICE.lifted].map((paragraph) => (
              <p key={paragraph} className="frame-text">
                <UserText>{paragraph}</UserText>
              </p>
            ))}
          </div>
        </>
      )}
      <Confirm props={props} onCancel={props.onCancelCorrection} label={W.reinstateButton} />
    </section>
  );
}

/** "Reinstate" beside an order's measure that is in force: live for an admin, greyed with admin_required's words for anyone else. */
export function ReinstateControl({ decision, role, disabled, onReinstate }: { decision: CaseDecision; role: StaffRole; disabled: boolean; onReinstate(decision: CaseDecision): void }) {
  if (reinstatable(decision) === null) return null;
  const admin = role === "admin";
  return (
    <>
      <button type="button" onClick={() => onReinstate(decision)} disabled={disabled || !admin}>
        {ORDER_WORDS.caseOrder.reinstate}
      </button>
      {admin ? null : <p className="hint">{messageFor("admin_required")}</p>}
    </>
  );
}

/** The sentence that greys a reporting control, by its key, with the case answer's numbers. */
function reportingClosedWords(view: CaseView, why: ReportingClosed): string {
  const reporting = view.standing?.reporting;
  const W = STANDING_WORDS.reporting;
  switch (why) {
    case "reportsFirst":
      return STANDING_WORDS.reportsFirst;
    case "warnShort":
      return W.warnShort(reporting?.unfounded ?? 0, reporting?.reports ?? 0);
    case "warnStanding":
      return W.warnStanding(reporting?.warnedOn ?? "");
    case "noWarning":
      return W.restrictNoWarning;
    case "restrictShort":
      return W.restrictShort(reporting?.marksSince ?? 0, reporting?.warnedOn ?? "");
    case "running":
      return W.restrictRunning(dateTime(reporting?.restrictedUntil ?? ""));
  }
}

/**
 * 3e Task 5 (design, section 8.3): "Warn about reporting" and "Restrict reporting" with its days, on an account case's
 * final restriction, each offered when the case answer says the database would accept it and greyed with its reason
 * otherwise. Both cite R6, which choosing one sets, and choosing one drafts the facts from the case answer.
 */
function ReportingMeasureControl({ props, control }: { props: ComposerViewProps; control: ReportingControl }) {
  const { view, draft } = props;
  const state = reportingControlState(view, draft, control);
  const reporting = view.standing?.reporting;
  if (state === null || reporting === undefined) return null;
  const kind = reportingKindOf(control);
  const held = draft.actions.find((action) => action.kind === kind);
  const max = STANDING_RULES.reportRestrictDays;
  const days = typeof held?.days === "number" ? held.days : max;
  const W = STANDING_WORDS.reporting;
  const choose = (on: boolean, value: number) => {
    if (!state.open) return;
    props.onChange(on ? withReporting(view, draft, control, control === "restrict" ? Math.min(max, Math.max(1, value)) : null, props.now) : { actions: draft.actions.filter((action) => action.kind !== kind) });
  };
  const id = `compose-${control}-reporting`;
  return (
    <li>
      <label>
        <input type="checkbox" checked={held !== undefined} disabled={props.busy || !state.open} onChange={(event) => choose(event.target.checked, days)} /> <span>{control === "warn" ? W.warnLabel : W.restrictLabel}</span>
      </label>
      {held !== undefined && state.open && control === "restrict" ? (
        <>
          {" "}
          <label htmlFor={`${id}-days`}>{W.daysLabel}</label> <input id={`${id}-days`} type="number" min={1} max={max} value={days} disabled={props.busy} onChange={(event) => choose(true, Number(event.target.value) || 1)} />
        </>
      ) : null}
      {state.open ? null : <p className="hint">{reportingClosedWords(view, state.why)}</p>}
      <p className="hint">{control === "warn" ? W.warnWhat(reporting.unfounded, reporting.reports) : W.restrictWhat(days)}</p>
      {held !== undefined ? (
        <>
          <p className="hint">{W.rule}</p>
          <p className="hint">{STANDING_WORDS.facts}</p>
        </>
      ) : null}
    </li>
  );
}

/**
 * 3e Task 5 (design, section 8.4): with the outcome "No breach" of a final decision, a tick box "Manifestly unfounded"
 * beside each item it answers whose `markable` is true; the ticked items are the signed list. [mark.rule] and
 * [mark.undone] stand under them, and [mark.never] once when an item it answers cannot be marked.
 */
function Marks({ props }: { props: ComposerViewProps }) {
  const { view, draft } = props;
  const items = markableItems(view, draft);
  const unmarkable = unmarkableItems(view, draft);
  if (items.length === 0 && unmarkable.length === 0) return null;
  const W = STANDING_WORDS.mark;
  return (
    <fieldset>
      <legend>{W.legend}</legend>
      <ul className="plain">
        {items.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={(draft.unfounded ?? []).includes(item.id)} disabled={props.busy} onChange={(event) => props.onChange({ unfounded: withMark(draft, item.id, event.target.checked) })} />{" "}
              <span>{`${W.label}: item ${item.seq}`}</span>
            </label>
          </li>
        ))}
      </ul>
      {items.length > 0 ? <p className="hint">{W.rule}</p> : null}
      {unmarkable.length > 0 ? <p className="hint">{W.never}</p> : null}
      {items.length > 0 ? <p className="hint">{W.undone}</p> : null}
    </fieldset>
  );
}

/**
 * 3e Task 5 (design, sections 8.4 and 8.7): "Withdraw this decision's marks": a correction kept of a "No breach" decision
 * whose marks stand, which holds no action and signs no list; the database withdraws every mark of the decision. It sends
 * the author nothing, so the page says so in place of a preview.
 */
function MarksView(props: ComposerViewProps) {
  const { view, role, draft } = props;
  const decision = view.decisions.find((decided) => decided.id === draft.reviewsDecisionId);
  const marked = decision ? marksWithdrawable(view, decision, role) : [];
  const W = STANDING_WORDS.mark;
  if (!decision || marked.length === 0) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">{W.withdrawLabel}</h3>
        <p>No mark of that decision stands any more.</p>
        <div className="actions">
          <button type="button" onClick={props.onCancelCorrection}>
            Cancel
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">{W.withdrawLabel}</h3>
      <p>{`The decision of ${dateTime(decision.decidedAt)} marked ${marked.length === 1 ? "item" : "items"} ${marked.map((item) => item.seq).join(", ")} manifestly unfounded.`}</p>
      <p className="notice">{W.withdrawWhat}</p>
      <TextField id="compose-review-reason" label="Reason of the correction" kind="review_reason" rows={3} props={props} under={[`${COMPOSER_WORDS.personalDataRule} ${COMPOSER_WORDS.staysInRecord}`]} />
      <p className="hint">{W.noStatement}</p>
      <Confirm props={props} onCancel={props.onCancelCorrection} />
    </section>
  );
}

/** Beside a decision whose reply waits: "Answer this reply", for whoever may ([reply.admin] where only an admin may). */
export function AnswerControl({ decision, role, disabled, onAnswer }: { decision: CaseDecision; role: StaffRole; disabled: boolean; onAnswer(decision: CaseDecision): void }) {
  if (!answerable(decision, role)) return null;
  return (
    <button type="button" onClick={() => onAnswer(decision)} disabled={disabled}>
      {STANDING_WORDS.reply.answerLabel}
    </button>
  );
}

/** Beside a decision whose announced measure has not started, while the account's case shows [conflict]: "Withdraw it for another measure", for an admin. */
export function WithdrawControl({ view, decision, role, disabled, onWithdraw }: { view: CaseView; decision: CaseDecision; role: StaffRole; disabled: boolean; onWithdraw(decision: CaseDecision): void }) {
  if (withdrawable(view, decision, role) === null) return null;
  return (
    <button type="button" onClick={() => onWithdraw(decision)} disabled={disabled}>
      {STANDING_WORDS.replace.label}
    </button>
  );
}

/** One measure's checkbox, with the image it names for an image measure, and the sentence that it changes nothing now when it would not. */
function Measure({ measure, props, images }: { measure: MeasureKind; props: ComposerViewProps; images: string[] }) {
  const { view, draft } = props;
  const ofImage = MEASURES[measure].target === "image";
  const held = draft.actions.find((action) => action.kind === measure);
  const action: DecisionActionParams = { kind: measure, mediaId: ofImage ? (held?.mediaId ?? images[0] ?? null) : null };
  if (ofImage && images.length === 0) return null;
  // 3e (design, section 8.3): the retirement is greyed with [retire.none] while the profile holds a placeholder.
  const retiring = measure === "retire_handle";
  const closed = retiring && !retireOpen(view);
  return (
    <li>
      <label>
        <input type="checkbox" checked={held !== undefined} disabled={props.busy || closed} onChange={(event) => props.onChange({ actions: toggled({ ...draft, actions: draft.actions.filter((other) => other.kind !== measure) }, action, event.target.checked) })} />{" "}
        <span>{MEASURES[measure].label}</span>
      </label>
      {ofImage && held !== undefined ? (
        <>
          {" "}
          <label htmlFor={`compose-image-${measure}`} className="visually-hidden">
            Which image
          </label>
          <select
            id={`compose-image-${measure}`}
            value={action.mediaId ?? ""}
            disabled={props.busy}
            onChange={(event) => props.onChange({ actions: [...draft.actions.filter((other) => other.kind !== measure), { kind: measure, mediaId: images.find((image) => image === event.target.value) ?? null }] })}
          >
            {/* Each image keeps its number in the snapshot, also when an image before it is not offered. */}
            {images.map((image) => (
              <option key={image} value={image}>
                {`Image ${snapshotImages(view).indexOf(image) + 1}`}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {noEffectOf(view, action, draft.kind === "final" ? "final" : "interim") !== null ? <p className="hint">{COMPOSER.noEffect}</p> : null}
      {retiring ? <RetireNotes view={view} chosen={held !== undefined} closed={closed} /> : null}
    </li>
  );
}

/**
 * 3e (design, section 8.3): the sentences beside "Retire the handle": why it is greyed ([retire.none]); else what it does
 * ([retire.what]), that it is the decision's first measure once chosen ([retire.first]), and that the profile changed its
 * handle after the snapshot, whose handle is the one retired ([retire.moved]).
 */
function RetireNotes({ view, chosen, closed }: { view: CaseView; chosen: boolean; closed: boolean }) {
  if (closed) return <p className="hint">{STANDING_WORDS.retire.none}</p>;
  return (
    <>
      <p className="hint">{STANDING_WORDS.retire.what}</p>
      {chosen ? <p className="hint">{STANDING_WORDS.retire.first}</p> : null}
      {retireMoved(view) ? <p className="notice">{STANDING_WORDS.retire.moved}</p> : null}
    </>
  );
}

export function ComposerView(shown: ComposerViewProps) {
  const { view, role } = shown;
  // 3e Task 4: a correction that answers a reply, and one that withdraws an announced measure, have views of their own.
  // Task 5: so has a correction that withdraws a "No breach" decision's marks.
  if (shown.draft.kind === "correction") {
    if (shown.draft.reinstate === true) return <ReinstateView {...shown} />;
    if (shown.draft.withdrawMarks === true) return <MarksView {...shown} />;
    return shown.draft.answer !== undefined ? <AnswerView {...shown} /> : shown.draft.replaced === true ? <WithdrawView {...shown} /> : <CorrectionView {...shown} />;
  }
  if (shown.draft.kind === "review") return <ReviewView {...shown} />;
  // What the draft holds is shown as far as it is offered, and that is what the key confirms.
  const draft = offeredDraft(view, role, shown.draft);
  const props: ComposerViewProps = { ...shown, draft };
  const kinds = kindsOffered(view, role);
  if (kinds.length === 0) {
    return (
      <section className="panel composer" aria-labelledby="composer-title">
        <h3 id="composer-title">Decide</h3>
        <p>{COMPOSER.closed}</p>
      </section>
    );
  }
  const kind = draft.kind === "final" ? "final" : "interim";
  const listed = outcomesListed(view, role);
  const outcome = draft.outcome;
  const restricts = outcome === "restricted";
  const law = restricts && draft.ground === "illegal";
  const suspect = suspectOpen(view);
  const sealChosen = draft.actions.some((action) => action.kind === "seal_media");
  const left = leftOpen(view);
  const rule = RULES.find((each) => each.id === draft.ruleId) ?? RULES[0];
  const postHidden = view.target.type === "post" && view.target.state !== null && view.target.state !== "visible";
  // Beside the two outcomes of a decision without a measure, whenever they are listed: on a post whose images cannot be
  // opened, such an answer to a report about an image is given unseen.
  const unseen = view.target.type === "post" && !view.imagesAllowed && listed.some((each) => each !== "restricted");
  // Under the facts and under the reason: on a case with an unanswered suspect item, never to say what the images are;
  // then the rule on personal data, with where the text goes. The texts of a decision without a measure never reach its author.
  const underTexts = [...(suspect.length > 0 ? [COMPOSER.neverWrite] : []), restricts ? COMPOSER.personalData : `${COMPOSER_WORDS.personalDataRule} ${COMPOSER_WORDS.staysInRecord}`];
  // 3e: the strike line on a post case, under "Restrict".
  const strike = strikeLine(view, draft);

  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <h3 id="composer-title">Decide</h3>

      <fieldset>
        <legend>Outcome</legend>
        {kinds.includes("final") ? null : <p className="notice">{COMPOSER.adminFinal}</p>}
        {listed.map((each) => (
          <label key={each}>
            {/* An outcome without a measure is a final decision's: choosing it makes the decision final, and puts its measures away. */}
            <input
              type="radio"
              name="compose-outcome"
              checked={outcome === each}
              disabled={props.busy}
              onChange={() => props.onChange(each === "restricted" ? { outcome: each } : { outcome: each, kind: "final", actions: draft.actions.filter((action) => MEASURES[action.kind].lifts !== null) })}
            />{" "}
            <span>{COMPOSER_OUTCOMES[each]}</span>
          </label>
        ))}
        {unseen ? <p className="notice">{COMPOSER.unseen}</p> : null}
      </fieldset>

      {restricts ? (
        <fieldset>
          <legend>When</legend>
          {kinds.map((each) => (
            <label key={each}>
              {/* A measure belongs to one kind: the other kind's measures are put away with the change. */}
              <input type="radio" name="compose-kind" checked={kind === each} disabled={props.busy} onChange={() => props.onChange({ kind: each, actions: [] })} /> <span>{COMPOSER_KINDS[each]}</span>
            </label>
          ))}
          {/* 3e (design, section 8.2): not a choice; the console signs the strike exactly when this says it is given. */}
          {strike === null ? null : <p className="hint">{strike === "due" ? STANDING_WORDS.strike.due : STANDING_WORDS.strike.none[strike]}</p>}
        </fieldset>
      ) : null}

      {suspect.length > 0 ? (
        <div className="banner suspect">
          <p>{(view.suspicion?.reach.served ?? 0) > 0 ? COMPOSER.onlySealEnds : COMPOSER.noteEnds}</p>
          {sealOffered(view, kind, role) ? (
            <div className="actions">
              <button type="button" onClick={props.onSeal} disabled={props.busy || sealChosen}>
                {MEASURES.seal_media.label}
              </button>
              {/* The choice not to seal belongs beside the seal taken while deciding: an admin deciding the case seals for good or answers without a seal. */}
              {kind === "interim" ? (
                <button type="button" onClick={props.onDeclineOpen} disabled={props.busy || props.declining !== null}>
                  Do not seal now
                </button>
              ) : null}
            </div>
          ) : null}
          {props.declining === null || kind !== "interim" ? null : (
            <div className="dialog" role="group" aria-labelledby="decline-title">
              <h4 id="decline-title">Do not seal now</h4>
              <p>{COMPOSER.declineWords}</p>
              <label htmlFor="decline-reason">Why you do not seal now</label>
              <textarea id="decline-reason" rows={3} value={props.declining.reason} disabled={props.declining.busy} onChange={(event) => props.onDeclineChange(event.target.value)} />
              {props.declining.error ? (
                <p role="alert" className="error">
                  {props.declining.error}
                </p>
              ) : null}
              <div className="actions">
                <button type="button" onClick={props.onDeclineSave} disabled={props.declining.busy || props.declining.reason.trim() === ""} aria-busy={props.declining.busy}>
                  Record this choice
                </button>
                <button type="button" onClick={props.onDeclineClose} disabled={props.declining.busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {role === "admin" && kind === "final" ? (
            <>
              <p>{COMPOSER.admin.endsFreeze}</p>
              <p>{COMPOSER.admin.unseen}</p>
              {view.target.type === "post" ? <p>{COMPOSER.admin.answersEarlier}</p> : null}
              <p>{COMPOSER.admin.afterwards}</p>
            </>
          ) : null}
        </div>
      ) : view.lane === 0 && (postHidden || view.target.type === "account") ? (
        <p className="notice">{view.target.type === "account" ? COMPOSER.noteAdviceAccount : COMPOSER.noteAdvicePost}</p>
      ) : null}

      {restricts ? (
        <>
          <label htmlFor="compose-ground">Ground</label>
          <select
            id="compose-ground"
            value={law ? "illegal" : "incompatible"}
            disabled={props.busy}
            onChange={(event) => props.onChange(event.target.value === "illegal" ? { ground: "illegal", terrorist: false } : { ground: "incompatible", terrorist: false, category: RULE_DEFAULT_CATEGORY[draft.ruleId] })}
          >
            <option value="incompatible">A korbat rule</option>
            {lawOffered(view, kind) ? <option value="illegal">The law</option> : null}
          </select>
          {law ? (
            <>
              <TextField id="compose-legal" label="Legal reference" kind="legal_reference" rows={2} props={props} under={[]} />
              <label>
                <input type="checkbox" checked={draft.terrorist} disabled={props.busy} onChange={(event) => props.onChange({ terrorist: event.target.checked })} /> <span>Terrorist content (Regulation (EU) 2021/784, Article 2(7))</span>
              </label>
            </>
          ) : (
            <>
              <label htmlFor="compose-rule">Rule</label>
              <select id="compose-rule" value={draft.ruleId} disabled={props.busy} onChange={(event) => props.onChange({ ruleId: event.target.value as RuleId, category: RULE_DEFAULT_CATEGORY[event.target.value as RuleId] })}>
                {/* A decision under R2 rests on a report or finding of child sexual abuse material: it is offered only where one is unanswered. */}
                {RULES.filter((each) => each.id !== "R2" || suspect.length > 0).map((each) => (
                  <option key={each.id} value={each.id}>{`${each.id}: ${each.title}`}</option>
                ))}
              </select>
              <p>{rule.text}</p>
              <div className="examples">
                <div>
                  <h5>Allowed</h5>
                  <ul>
                    {rule.allowed.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h5>Not allowed</h5>
                  <ul>
                    {rule.notAllowed.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </>
      ) : null}

      {/* Every decision carries a category, so every decision shows the one the key will confirm. */}
      <label htmlFor="compose-category">Category</label>
      <select id="compose-category" value={draft.category} disabled={props.busy} onChange={(event) => props.onChange({ category: event.target.value as TdbCategory })}>
        {FINDING_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {categoryLabel(category)}
          </option>
        ))}
      </select>

      {restricts ? (
        <fieldset>
          <legend>Measures</legend>
          <ul className="plain">
            {sealChosen ? (
              <li>
                <label>
                  <input type="checkbox" checked disabled={props.busy} onChange={() => props.onChange({ actions: draft.actions.filter((action) => action.kind !== "seal_media") })} /> <span>{`${MEASURES.seal_media.label}: chosen`}</span>
                </label>
              </li>
            ) : null}
            {measuresOffered(view, kind).map((measure) => (
              <Measure key={measure} measure={measure} props={props} images={imagesOffered(view, kind, measure)} />
            ))}
            {/* 3e (design, section 8.3): a suspension at once, on an account case's final restriction. */}
            <AtOnce props={props} />
            {/* 3e Task 4: an announced suspension, an announced termination and a termination at once. */}
            <StandingMeasureControl props={props} control="announce" />
            <StandingMeasureControl props={props} control="announceTerminate" />
            <StandingMeasureControl props={props} control="terminateAtOnce" />
            {/* 3e Task 5: the warning about reporting and the restriction of it. */}
            <ReportingMeasureControl props={props} control="warn" />
            <ReportingMeasureControl props={props} control="restrict" />
            {kind === "interim" && view.target.type === "post" && hiddenWhileDeciding(view) ? (
              <li>
                <p className="hint">{COMPOSER.alreadyHidden}</p>
              </li>
            ) : null}
          </ul>
        </fieldset>
      ) : null}

      {/* 3e Task 5 (design, section 8.4): "No breach" may mark the reports it answers "manifestly unfounded". */}
      <Marks props={props} />

      {/* A restriction needs both texts; a decision without a measure may carry them, for the case's record. */}
      <TextField id="compose-facts" label="Facts" kind="facts" rows={4} props={props} under={underTexts} />
      <TextField id="compose-reason" label="Reason" kind="reason" rows={4} props={props} under={underTexts} />

      {kind === "final" && left.length > 0 && liftable(view).length > 0 ? (
        <fieldset>
          <legend>Measures taken while deciding</legend>
          <ul className="plain">
            {liftable(view).map((reversal) => (
              <li key={`${reversal.kind} ${reversal.mediaId ?? ""}`}>
                <label>
                  <input type="checkbox" checked={holds(draft, reversal)} disabled={props.busy} onChange={(event) => props.onChange({ actions: toggled(draft, reversal, event.target.checked) })} />{" "}
                  <span>{`Lift: ${MEASURES[liftedKind(reversal)].label}`}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      {kind === "final" && suspect.length > 0 && left.length > 0 ? <p className="notice">{COMPOSER.staysOpen(throughSeqOf(view), left.length)}</p> : null}

      <Preview view={view} draft={draft} now={props.now} />
      <Confirm props={props} />
    </section>
  );
}

/** Beside a decision with a measure in force: "Lift what was done while deciding" or "Correct this decision", for whoever may. */
export function CorrectControl({ view, decision, role, disabled, onCorrect }: { view: CaseView; decision: CaseDecision; role: StaffRole; disabled: boolean; onCorrect(decision: CaseDecision): void }) {
  const offered = correctable(view, decision, role);
  if (offered === null) return null;
  return (
    <button type="button" onClick={() => onCorrect(decision)} disabled={disabled}>
      {offered.label}
    </button>
  );
}

/** Beside a "No breach" decision whose marks stand: "Withdraw this decision's marks" ([mark.withdraw]), for whoever may correct it. */
export function WithdrawMarksControl({ view, decision, role, disabled, onWithdrawMarks }: { view: CaseView; decision: CaseDecision; role: StaffRole; disabled: boolean; onWithdrawMarks(decision: CaseDecision): void }) {
  if (marksWithdrawable(view, decision, role).length === 0) return null;
  return (
    <button type="button" onClick={() => onWithdrawMarks(decision)} disabled={disabled}>
      {STANDING_WORDS.mark.withdrawLabel}
    </button>
  );
}

/** Beside a pending appeal: "Review this appeal", for the person the API marked as one who may review it. */
export function ReviewControl({ view, decision, disabled, onReview }: { view: CaseView; decision: CaseDecision; disabled: boolean; onReview(decision: CaseDecision): void }) {
  if (reviewable(view, decision) === null) return null;
  return (
    <button type="button" onClick={() => onReview(decision)} disabled={disabled}>
      {APPEAL_WORDS.reviewLabel}
    </button>
  );
}
