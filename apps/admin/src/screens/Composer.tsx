import { FINDING_CATEGORIES, MEASURES, RULE_DEFAULT_CATEGORY, type CaseDecision, type CaseView, type DecisionActionParams, type MeasureKind, type RuleId, type TdbCategory } from "@korbat/contracts";
import { RULES, statementParagraphs, type StatementInput } from "@korbat/rules";
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
  measuresOffered,
  noEffectOf,
  offeredDraft,
  outcomesListed,
  previewOf,
  previewable,
  sealOffered,
  snapshotImages,
  statementSent,
  suspectOpen,
  throughSeqOf,
  toggled,
  type CaseDraft,
  type DraftTextKind,
  type StaffRole,
} from "../compose";
import { COMPOSER_KINDS, COMPOSER_OUTCOMES, COMPOSER_WORDS } from "../messages";
import { dateTime, UserText } from "../ui";
import { categoryLabel } from "../words";

/**
 * The decision composer (3c design, section 8): the outcome first, then, for a restriction, the kind, the ground and the
 * measures this target and kind allow; the category; the facts and the reason; and the preview, which is the statement
 * exactly as its author will receive it. What it offers follows the case and the person's role; the database checks
 * every rule again when the key has confirmed. A correction ("Lift what was done while deciding", "Correct this
 * decision") takes the composer's place while it is open.
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
  if (draft.kind !== "correction" && draft.outcome === "restricted" && !draft.actions.some((action) => MEASURES[action.kind].lifts === null)) {
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

function Confirm({ props, onCancel }: { props: ComposerViewProps; onCancel?: () => void }) {
  return (
    <>
      {props.error ? (
        <p role="alert" className="error">
          {props.error}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="primary" onClick={props.onConfirm} disabled={props.busy || !complete(props.view, props.draft)} aria-busy={props.busy}>
          Confirm with your staff key
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
              <span>{MEASURES[reversal.kind].label}</span>
              {measure.mediaId === null ? null : (
                <>
                  {" "}
                  <code>{measure.mediaId}</code>
                </>
              )}
            </label>
            {reversal.kind === "unseal_media" ? <p className="notice">{deciding ? COMPOSER.sealInError : COMPOSER.sealForGood}</p> : null}
          </li>
        ))}
      </ul>
      <TextField id="compose-review-reason" label="Reason of the correction" kind="review_reason" rows={3} props={props} under={[COMPOSER.personalData]} />
      <Preview view={view} draft={draft} now={props.now} />
      <Confirm props={props} onCancel={props.onCancelCorrection} />
    </section>
  );
}

/** One measure's checkbox, with the image it names for an image measure, and the sentence that it changes nothing now when it would not. */
function Measure({ measure, props, images }: { measure: MeasureKind; props: ComposerViewProps; images: string[] }) {
  const { view, draft } = props;
  const ofImage = MEASURES[measure].target === "image";
  const held = draft.actions.find((action) => action.kind === measure);
  const action: DecisionActionParams = { kind: measure, mediaId: ofImage ? (held?.mediaId ?? images[0] ?? null) : null };
  if (ofImage && images.length === 0) return null;
  return (
    <li>
      <label>
        <input type="checkbox" checked={held !== undefined} disabled={props.busy} onChange={(event) => props.onChange({ actions: toggled({ ...draft, actions: draft.actions.filter((other) => other.kind !== measure) }, action, event.target.checked) })} />{" "}
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
            {images.map((image, index) => (
              <option key={image} value={image}>
                {`Image ${index + 1}`}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {noEffectOf(view, action) !== null ? <p className="hint">{COMPOSER.noEffect}</p> : null}
    </li>
  );
}

export function ComposerView(shown: ComposerViewProps) {
  const { view, role } = shown;
  if (shown.draft.kind === "correction") return <CorrectionView {...shown} />;
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
  const images = snapshotImages(view);
  const left = leftOpen(view);
  const rule = RULES.find((each) => each.id === draft.ruleId) ?? RULES[0];
  const postHidden = view.target.type === "post" && view.target.state !== null && view.target.state !== "visible";
  // Beside the two outcomes of a decision without a measure, whenever they are listed: on a post whose images cannot be
  // opened, such an answer to a report about an image is given unseen.
  const unseen = view.target.type === "post" && !view.imagesAllowed && listed.some((each) => each !== "restricted");
  // Under the facts and under the reason: on a case with an unanswered suspect item, never to say what the images are;
  // then the rule on personal data, with where the text goes. The texts of a decision without a measure never reach its author.
  const underTexts = [...(suspect.length > 0 ? [COMPOSER.neverWrite] : []), restricts ? COMPOSER.personalData : `${COMPOSER_WORDS.personalDataRule} ${COMPOSER_WORDS.staysInRecord}`];

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
              <Measure key={measure} measure={measure} props={props} images={images} />
            ))}
          </ul>
        </fieldset>
      ) : null}

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
