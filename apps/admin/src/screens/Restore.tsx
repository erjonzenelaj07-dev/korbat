import { GAP_CLASSES, MEASURES, type GapClass, type RestoreGap, type RestoreView, type StaffRole } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { AUTOMATION_WORDS, describeError, RECOVERY_WORDS } from "../messages";
import { CaseLink, NavLink, OrderLink } from "../nav";
import { parseCaseId, parseOrderId, type CaseId, type ConsolePath, type OrderId } from "../router";
import { closeGapWithKey } from "../step-up";
import { bothTimes, Loaded, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";

/**
 * After a restore (3f design, sections 7.17 and 8.8): what the import found lost, in the order in which a person takes it
 * again, from GET /api/staff/restore. Nothing here is in force: each lost measure is taken again under a key, on the
 * order's or the case's own screen, which "Open the order" and "Open the case" lead to with the gap (the decision then
 * confirmed names it and closes it). An admin closes a gap that needs nothing as "Not needed", with the key. The page
 * shows a gap's members and nothing of its lost row; every list is a list of blocks, usable at a phone's width.
 */

const W = RECOVERY_WORDS;

/** A gap the person is about to take again: its id and when the lost decision was made, which the composer's line names. */
export interface GapToTake {
  id: string;
  actedAt: string;
}

/** {measure}: the words of a lost decision's measures, the labels of MEASURES, each quoted. */
const measureWords = (gap: RestoreGap) => (gap.kinds.length === 0 ? "a decision" : gap.kinds.map((kind) => `"${MEASURES[kind].label}"`).join(", "));

/** A gap's line in its class's words (8.8): `n` counts the open gaps of one order, one a lost item. */
function lineOf(gap: RestoreGap, n: number): string {
  const at = bothTimes(gap.actedAt);
  const c = W.classes;
  switch (gap.class) {
    case "order_effect":
      return c.order_effect.line(n, at);
    case "seal_final":
      return c.seal_final.line(at);
    case "seal_interim":
      return c.seal_interim.line(at);
    case "standing":
      return c.standing.line(measureWords(gap), at);
    case "restriction":
      return c.restriction.line(measureWords(gap), at);
    case "reversal":
      return c.reversal.line(at);
    case "no_measure":
      return c.no_measure.line(at);
    case "record":
      return c.record.line(at, W.recordWhat(gap.action));
    case "release":
      // 3d Task 7: a lost end of a held upload's hold says how it ended.
      return gap.action === "upload_hold_ended" && gap.hold !== undefined ? c.release.holdLine(at, gap.hold.endAs) : c.release.line(gap.action, at);
  }
}

export interface RestoreScreenProps {
  view: RestoreView;
  role: StaffRole;
  busy: string | null;
  notice: string | null;
  error: string | null;
  onOpenCase(id: CaseId, gap: GapToTake): void;
  onOpenOrder(id: OrderId): void;
  onNotNeeded(gap: RestoreGap): void;
  /** 3d Task 7: the link to Held uploads beside a lost end of a hold whose refusal is there. */
  onNavigate?: (path: ConsolePath) => void;
}

/** One class's gaps: the open ones with their controls, and the closed ones of the newest import with how they closed. */
function ClassBlock({ cls, gaps, props }: { cls: GapClass; gaps: RestoreGap[]; props: RestoreScreenProps }) {
  const open = gaps.filter((gap) => gap.closedAt === null);
  const closed = gaps.filter((gap) => gap.closedAt !== null);
  // An order's lost disabling is one gap an item: the line counts them and links once to the order.
  const shown = cls === "order_effect" ? open.filter((gap, index) => gap.orderId === null || open.findIndex((other) => other.orderId === gap.orderId) === index) : open;
  return (
    <section className="block" aria-labelledby={`gaps-${cls}`}>
      <h3 id={`gaps-${cls}`}>{W.classes[cls].heading}</h3>
      {cls === "order_effect" && open.length > 0 ? <p className="hint">{W.orderLine}</p> : null}
      <ul className="blocks">
        {shown.map((gap) => {
          const n = cls === "order_effect" && gap.orderId !== null ? open.filter((other) => other.orderId === gap.orderId).length : 1;
          const orderId = gap.orderId === null ? null : parseOrderId(gap.orderId);
          const caseId = gap.caseId === null ? null : parseCaseId(gap.caseId);
          return (
            <li key={gap.id}>
              <p>{lineOf(gap, n)}</p>
              {/* 3d Task 2: [restore.sealAgain] beside a lost seal for good whose post is released. */}
              {gap.released === true ? <p className="hint">{W.sealAgain}</p> : null}
              {/* 3d Task 6 (8.7): [restore.program] beside a lost measure a program took, which a person takes again as theirs. */}
              {gap.action === "automated_decided" ? <p className="hint">{AUTOMATION_WORDS.restoreProgram}</p> : null}
              {/* 3d Task 2 (8.7): no key closes a gap of the class release: the line says who does, and nothing else is offered. */}
              {/* 3d Task 7 [restore.holdEnd]: a lost end of a hold is closed by an admin's end again while the refusal is there. */}
              {cls === "release" && gap.hold !== undefined ? (
                <>
                  {gap.hold.present && props.onNavigate !== undefined ? (
                    <p>
                      <NavLink to="/uploads" onNavigate={props.onNavigate}>
                        {W.classes.release.holdLink}
                      </NavLink>
                    </p>
                  ) : null}
                  <p className="hint">{W.classes.release.holdEnd(gap.hold.present)}</p>
                </>
              ) : cls === "release" ? (
                <p className="hint">{W.classes.release.control(gap.action)}</p>
              ) : null}
              {cls === "record" || cls === "release" ? null : cls === "order_effect" ? (
                orderId !== null ? (
                  <p>
                    <OrderLink id={orderId} onOpen={props.onOpenOrder}>
                      {W.openOrder}
                    </OrderLink>
                  </p>
                ) : (
                  <p className="hint">{W.noTarget}</p>
                )
              ) : caseId !== null ? (
                <p>
                  <CaseLink id={caseId} onOpen={(id) => props.onOpenCase(id, { id: gap.id, actedAt: gap.actedAt })}>
                    {W.openCase}
                  </CaseLink>
                </p>
              ) : (
                <p className="hint">{W.noTarget}</p>
              )}
              {props.role === "admin" && cls !== "release" ? (
                <div className="actions">
                  <button type="button" disabled={props.busy !== null} aria-busy={props.busy === gap.id} onClick={() => props.onNotNeeded(gap)}>
                    {W.notNeeded}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        {closed.map((gap) => (
          <li key={gap.id} className="quiet">
            <p>{lineOf(gap, 1)}</p>
            <p>{W.closed(gap.disposition!, bothTimes(gap.closedAt!))}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RestoreScreen(props: RestoreScreenProps) {
  const { view } = props;
  const open = view.gaps.filter((gap) => gap.closedAt === null);
  return (
    <section aria-labelledby="restore-title">
      <h2 id="restore-title">{W.title}</h2>
      {props.notice ? (
        <p role="status" className="notice">
          {props.notice}
        </p>
      ) : null}
      {props.error ? (
        <p role="alert" className="error">
          {props.error}
        </p>
      ) : null}
      {view.importedAt === null ? null : <p className="quiet">{W.importedAt(bothTimes(view.importedAt))}</p>}
      <p>{W.what}</p>
      <p className={view.mayOpen ? "notice" : "error"}>{view.mayOpen ? W.siteOpen : W.site}</p>
      {view.retentionMay ? <p className="notice">{W.retention}</p> : null}
      <p className="hint">{W.lost}</p>
      {view.holds.length === 0 ? null : (
        <section className="block" aria-labelledby="restore-holds">
          <p id="restore-holds" className="notice">
            {W.holds}
          </p>
          <ul className="blocks">
            {view.holds.map((hold) => {
              const id = parseOrderId(hold.orderId);
              const words = W.holdUntil(hold.holdUntil === null ? null : bothTimes(hold.holdUntil));
              return <li key={hold.orderId}>{id === null ? <p>{words}</p> : <p><OrderLink id={id} onOpen={props.onOpenOrder}>{words}</OrderLink></p>}</li>;
            })}
          </ul>
        </section>
      )}
      {open.length === 0 ? <p className="notice">{W.nothingOpen}</p> : null}
      {props.role === "admin" && open.length > 0 ? <p className="hint">{W.notNeededWhat}</p> : null}
      {GAP_CLASSES.map((cls) => {
        const gaps = view.gaps.filter((gap) => gap.class === cls);
        return gaps.length === 0 ? null : <ClassBlock key={cls} cls={cls} gaps={gaps} props={props} />;
      })}
    </section>
  );
}

export function Restore({
  api,
  credentials,
  role,
  onOpenCase,
  onOpenOrder,
  onNavigate,
}: {
  api: StaffApi;
  credentials: CredentialsLike;
  role: StaffRole;
  onOpenCase(id: CaseId, gap: GapToTake): void;
  onOpenOrder(id: OrderId): void;
  onNavigate?: (path: ConsolePath) => void;
}) {
  const [view, setView] = useState<Loadable<RestoreView>>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void api.restore({ activity: true }).then(
      (value) => alive.current && setView({ state: "ready", value }),
      (err: unknown) => alive.current && setView({ state: "failed", message: describeError(err) }),
    );
    return () => {
      alive.current = false;
    };
  }, [api]);

  const notNeeded = async (gap: RestoreGap) => {
    if (busy !== null) return;
    setBusy(gap.id);
    setNotice(null);
    setError(null);
    try {
      const fresh = await closeGapWithKey({ api, credentials }, gap.id);
      if (!alive.current) return;
      setView({ state: "ready", value: fresh });
      setNotice(W.notNeededDone);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <Loaded
      value={view}
      render={(value) => (
        <RestoreScreen view={value} role={role} busy={busy} notice={notice} error={error} onOpenCase={onOpenCase} onOpenOrder={onOpenOrder} onNotNeeded={(gap) => void notNeeded(gap)} onNavigate={onNavigate} />
      )}
    />
  );
}
