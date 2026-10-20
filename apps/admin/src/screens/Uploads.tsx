import { RETENTION, UPLOAD_END_REASON_LABELS, UPLOAD_END_REASONS, type HeldUpload, type StaffRole, type UploadEnd, type UploadEndReason, type UploadHoldEndedParams, type UploadReleasedParams } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { Frame } from "../frames";
import { CUSTODY_WORDS, describeError, RELEASE_WORDS } from "../messages";
import { endHoldWithKey, releaseUploadWithKey } from "../step-up";
import { bothTimes, Loaded, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";
import { MatchRecordView } from "./Case";

/**
 * 3d Task 7, Held uploads (design, sections 7.12, 8.6 and 10.3): the refusals whose hold has not ended, then those ended as
 * "Report" and not released, then those released or ended as "No report" in the last 30 days. The screen shows no image,
 * requests none and links none: a refusal is its time, its match's record, a count of the same uploader's other held
 * uploads, whether the account still exists, the objection framed, and its state. An admin ends a hold with the step-up
 * upload_hold_ended: the two ends stand side by side, worded as what each does, and neither is chosen when the page
 * loads (rule 4 of section 8); a hold ended as "Report" can be released on a recorded leave (upload_released).
 */

const W = CUSTODY_WORDS.uploads;

/**
 * The ends an admin can still choose for a refusal, as upload_hold_end allows them: both while the hold is open; "No
 * report" after "Report" until a release; "Report" after "No report" until the upload is deleted; none once released.
 */
export function endsOffered(upload: HeldUpload, now: number = Date.now()): UploadEnd[] {
  if (upload.release?.releasedAt != null) return [];
  if (upload.endAs === null) return ["report", "no_report"];
  if (upload.endAs === "report") return ["no_report"];
  return upload.deletesAt !== null && Date.parse(upload.deletesAt) > now ? ["report"] : [];
}

/** The params the key signs for an end: null until an end, and for "No report" its reason, is chosen. */
export function holdEndParams(endAs: UploadEnd | null, reason: UploadEndReason | null): UploadHoldEndedParams | null {
  if (endAs === null) return null;
  if (endAs === "report") return { endAs, reason: null };
  return reason === null ? null : { endAs, reason };
}

/** The params the key signs for the release of a held upload: only on a recorded leave, with its reference. */
export function uploadReleaseParams(upload: HeldUpload): UploadReleasedParams | null {
  const release = upload.release;
  if (release === null || release.releasedAt !== null || release.leave === null) return null;
  return { basis: "leave", leaveId: release.leave.id, theirReference: release.leave.reference };
}

/** A refusal's state line (8.6). */
export function stateLine(upload: HeldUpload): string {
  if (upload.release?.releasedAt != null) return W.state.released(bothTimes(upload.release.releasedAt));
  if (upload.endAs === "report" && upload.endedAt !== null) return W.state.report(bothTimes(upload.endedAt), upload.reported, upload.quarantined);
  if (upload.endAs === "no_report" && upload.endedAt !== null) {
    return W.state.noReport(bothTimes(upload.endedAt), upload.endReason === null ? "" : UPLOAD_END_REASON_LABELS[upload.endReason], upload.deletesAt === null ? "" : bothTimes(upload.deletesAt));
  }
  return W.state.open;
}

/** What the page does for one refusal: whose role, which refusal is on its way, and each refusal's refusal. */
export interface UploadsActions {
  role: StaffRole;
  busy: string | null;
  errors: Record<string, string>;
  onEnd(upload: HeldUpload, params: UploadHoldEndedParams): void;
  onRelease(upload: HeldUpload, params: UploadReleasedParams): void;
}

/**
 * The two ends, side by side as radio buttons of the same weight, neither checked nor focused when the block is drawn,
 * each with what it does; the reasons of "No report" once that end is chosen; then the key. Greyed for a moderator.
 */
function EndControl({ upload, actions }: { upload: HeldUpload; actions: UploadsActions }) {
  const [endAs, setEndAs] = useState<UploadEnd | null>(null);
  const [reason, setReason] = useState<UploadEndReason | null>(null);
  const offered = endsOffered(upload);
  if (offered.length === 0) return null;
  const admin = actions.role === "admin";
  const params = holdEndParams(endAs, reason);
  const busy = actions.busy === upload.id;
  const name = `end-${upload.id}`;
  return (
    <div className={`actions${admin ? "" : " greyed"}`}>
      <p className="hint">{W.unseen}</p>
      <fieldset disabled={!admin || busy}>
        <legend>{W.choose}</legend>
        {offered.map((end) => (
          <label key={end}>
            <input type="radio" name={name} value={end} checked={endAs === end} onChange={() => setEndAs(end)} />
            <strong>{end === "report" ? W.report.label : W.noReport.label}</strong>
            {`: ${end === "report" ? W.report.what : W.noReport.what}`}
          </label>
        ))}
      </fieldset>
      {endAs === "no_report" ? (
        <fieldset disabled={!admin || busy}>
          <legend>{W.noReport.reason}</legend>
          {UPLOAD_END_REASONS.map((value) => (
            <label key={value}>
              <input type="radio" name={`${name}-reason`} value={value} checked={reason === value} onChange={() => setReason(value)} />
              {UPLOAD_END_REASON_LABELS[value]}
            </label>
          ))}
        </fieldset>
      ) : null}
      {endAs === "no_report" && reason === null ? <p className="hint">{W.chooseReason}</p> : null}
      <p className="hint">{W.sign}</p>
      {admin ? null : <p className="hint">{W.adminOnly}</p>}
      {actions.errors[upload.id] ? (
        <p role="alert" className="error">
          {actions.errors[upload.id]}
        </p>
      ) : null}
      <button type="button" disabled={!admin || params === null || busy} aria-busy={busy} onClick={() => params !== null && actions.onEnd(upload, params)}>
        {W.confirm}
      </button>
    </div>
  );
}

/**
 * 8.5's block for a held upload ended as "Report" (8.6): the facts read from the record upload-report opened and the
 * leave recorded for the refusal, the words, and "Release and destroy" while a leave is recorded, for an admin alone.
 * An authority's reference and a leave's are framed. No image is requested or drawn here.
 */
function UploadReleaseBlock({ upload, actions }: { upload: HeldUpload; actions: UploadsActions }) {
  const facts = upload.release;
  if (facts === null) return null;
  const R = RELEASE_WORDS;
  const F = R.facts;
  const admin = actions.role === "admin";
  const params = uploadReleaseParams(upload);
  const busy = actions.busy === upload.id;
  const day = (at: string | null, none: string) => (at === null ? none : bothTimes(at));
  return (
    <section className={`block release${admin ? "" : " greyed"}`} aria-labelledby={`release-${upload.id}`}>
      <h4 id={`release-${upload.id}`}>{R.title}</h4>
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
        <dd>{facts.tellHeld ? F.tell.record : F.tell.atOnce}</dd>
        <dt>{F.quarantined.label}</dt>
        <dd>{facts.quarantined ? F.quarantined.yes : F.quarantined.no}</dd>
      </dl>
      {facts.releasedAt !== null && facts.backupsClearAt !== null ? <p className="notice">{W.releaseDone(bothTimes(facts.releasedAt), facts.noticeHeld === true, bothTimes(facts.backupsClearAt))}</p> : null}
      <p className="hint">{R.backups(RETENTION.backupDays)}</p>
      {facts.silenceDays === null ? <p className="hint">{R.periodUnset}</p> : null}
      {facts.releasedAt !== null ? null : facts.leave === null ? (
        <p className="notice">{facts.answer === "illegal" ? R.assessed : R.nothing}</p>
      ) : (
        <>
          {facts.answer === "not_illegal" ? <p className="error">{R.conflict}</p> : null}
          <p>{R.leave(F.leave.from[facts.leave.from]!)}</p>
        </>
      )}
      {params === null ? null : (
        <div className="actions">
          <p className="hint">{W.releaseSign}</p>
          {admin ? null : <p className="hint">{R.adminOnly}</p>}
          <button type="button" disabled={!admin || busy} aria-busy={busy} onClick={() => actions.onRelease(upload, params)}>
            {R.button}
          </button>
        </div>
      )}
    </section>
  );
}

/** One refusal's block (8.6): its time, its match's record, the uploader's count and state, the objection, and the controls. */
export function UploadBlock({ upload, actions }: { upload: HeldUpload; actions: UploadsActions }) {
  return (
    <article className="panel upload" aria-labelledby={`upload-${upload.id}`}>
      <h3 id={`upload-${upload.id}`}>{W.refusedAt(bothTimes(upload.refusedAt))}</h3>
      <MatchRecordView match={upload.match} />
      <p>{W.others(upload.otherRefusals)}</p>
      {upload.uploaderGone ? <p className="notice">{W.gone}</p> : null}
      <p className="notice">{stateLine(upload)}</p>
      {upload.objection !== null && upload.objectedAt !== null ? (
        <>
          <p>{W.objection.lead(bothTimes(upload.objectedAt))}</p>
          <Frame by={W.objection.by} text={upload.objection} />
        </>
      ) : null}
      <EndControl upload={upload} actions={actions} />
      <UploadReleaseBlock upload={upload} actions={actions} />
    </article>
  );
}

export interface UploadsViewProps {
  rows: Loadable<HeldUpload[]>;
  more: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  actions: UploadsActions;
}

export function UploadsView({ rows, more, loadingMore, onLoadMore, actions }: UploadsViewProps) {
  return (
    <section aria-labelledby="uploads-title">
      <h2 id="uploads-title">{W.title}</h2>
      <p className="hint">{W.what}</p>
      <Loaded
        value={rows}
        render={(list) =>
          list.length === 0 ? (
            <p>{W.empty}</p>
          ) : (
            <div className="uploads">
              {list.map((upload) => (
                // Keyed by the refusal and its state: a block drawn again after an end starts with nothing chosen.
                <UploadBlock key={`${upload.id}-${upload.endAs ?? "open"}-${upload.release?.releasedAt ?? ""}`} upload={upload} actions={actions} />
              ))}
            </div>
          )
        }
      />
      {more ? (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} aria-busy={loadingMore}>
          {W.more}
        </button>
      ) : null}
    </section>
  );
}

/** The screen: reads the first page when it opens, and each further page when the person asks; never on a timer. */
export function Uploads({ api, credentials, role }: { api: StaffApi; credentials: CredentialsLike; role: StaffRole }) {
  const [rows, setRows] = useState<Loadable<HeldUpload[]>>({ state: "loading" });
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api.uploads(null, { activity: true }).then(
      (answer) => {
        if (!alive.current) return;
        setRows({ state: "ready", value: answer.uploads });
        setNext(answer.nextCursor);
      },
      (err: unknown) => alive.current && setRows({ state: "failed", message: describeError(err) }),
    );
    return () => {
      alive.current = false;
    };
    // Read once per opening of the screen; the API client never changes while the page lives.
  }, [api]);

  const loadMore = async () => {
    if (next === null || rows.state !== "ready") return;
    setLoadingMore(true);
    try {
      const answer = await api.uploads(next, { activity: true });
      if (!alive.current) return;
      setRows({ state: "ready", value: [...rows.value, ...answer.uploads] });
      setNext(answer.nextCursor);
    } catch (err) {
      if (alive.current) setRows({ state: "failed", message: describeError(err) });
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  /** Runs one keyed act on a refusal and puts the refusal as it now shows in the place of the one the page showed. */
  const act = async (upload: HeldUpload, run: () => Promise<HeldUpload>) => {
    setBusy(upload.id);
    setErrors((now) => ({ ...now, [upload.id]: "" }));
    try {
      const after = await run();
      if (!alive.current) return;
      setRows((now) => (now.state === "ready" ? { state: "ready", value: now.value.map((row) => (row.id === after.id ? after : row)) } : now));
    } catch (err) {
      if (alive.current) setErrors((now) => ({ ...now, [upload.id]: describeError(err) }));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const actions: UploadsActions = {
    role,
    busy,
    errors,
    onEnd: (upload, params) => void act(upload, () => endHoldWithKey({ api, credentials }, upload.id, params)),
    onRelease: (upload, params) => void act(upload, () => releaseUploadWithKey({ api, credentials }, upload.id, params)),
  };
  return <UploadsView rows={rows} more={next !== null} loadingMore={loadingMore} onLoadMore={() => void loadMore()} actions={actions} />;
}
