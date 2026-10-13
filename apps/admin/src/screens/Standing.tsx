import { RULE_DEFAULT_CATEGORY, type RuleId, type StandingLists } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError, FINDING_WORDS, STANDING_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { Loaded, UserText, type Loadable } from "../ui";

/**
 * The Standing screen (3e design, section 8.6): four lists from one answer, each newest first, each row ending in a link
 * to its case where one exists: the accounts at the ladder's number of strikes, with "Open a case on this account"; the
 * reporting records (the accounts at the warning's threshold, and the warned ones with the marked reports sent since),
 * with the same control under R6; the notices korbat could not send; and the terminations that wait. No list is a queue key and none is weighted; people are handles, shown as text.
 */

/** "Open a case on this account": which row's finding is on its way, and what became of the last one. */
export interface OpeningState {
  handle: string | null;
  error: string | null;
}

export interface StandingViewProps {
  lists: Loadable<StandingLists>;
  opening: OpeningState;
  onOpenCase(id: CaseId): void;
  onOpenFinding(handle: string, ruleId: RuleId): void;
}

/** A row's link to its case, when the answer named one this console can open. */
function Link({ caseId, onOpenCase }: { caseId: string | null; onOpenCase(id: CaseId): void }) {
  const id = caseId === null ? null : parseCaseId(caseId);
  return id ? (
    <>
      {" "}
      <CaseLink id={id} onOpen={onOpenCase}>
        Open the case
      </CaseLink>
    </>
  ) : null;
}

/** How many rows a list holds beyond those shown, when the answer listed fewer than its total. */
const More = ({ total, shown }: { total: number; shown: number }) => (total > shown ? <p className="hint">{STANDING_WORDS.lists.more(total, shown)}</p> : null);

export function StandingView({ lists, opening, onOpenCase, onOpenFinding }: StandingViewProps) {
  const W = STANDING_WORDS.lists;
  return (
    <section aria-labelledby="standing-title">
      <h2 id="standing-title">{W.title}</h2>
      <Loaded
        value={lists}
        render={(value) => (
          <>
            <h3 id="standing-strikes">{W.strikesTitle}</h3>
            <p className="hint">{W.strikes}</p>
            <p className="hint">{W.finding}</p>
            {opening.error ? (
              <p role="alert" className="error">
                {opening.error}
              </p>
            ) : null}
            {value.atThreeStrikes.items.length === 0 ? (
              <p>{W.empty}</p>
            ) : (
              <ul className="plain" aria-labelledby="standing-strikes">
                {value.atThreeStrikes.items.map((row) => (
                  <li key={row.handle}>
                    <UserText>{W.strikesRow(row.handle, row.activeStrikes, row.ruleId, row.newestOn, row.maxDays, row.mayTerminate)}</UserText>{" "}
                    <button type="button" onClick={() => onOpenFinding(row.handle, row.ruleId)} disabled={opening.handle !== null} aria-busy={opening.handle === row.handle}>
                      {W.openCase}
                    </button>
                    <Link caseId={row.caseId} onOpenCase={onOpenCase} />
                  </li>
                ))}
              </ul>
            )}
            <More total={value.atThreeStrikes.total} shown={value.atThreeStrikes.items.length} />

            <h3 id="standing-reporting">{W.reportingTitle}</h3>
            {value.reportingRecords.items.length === 0 ? (
              <p>{W.empty}</p>
            ) : (
              <ul className="plain" aria-labelledby="standing-reporting">
                {value.reportingRecords.items.map((row) => (
                  <li key={row.handle}>
                    <UserText>{W.reportingRow(row.handle, row.unfounded, row.reports)}</UserText> {row.warnedOn === null ? W.reportingThreshold : W.reportingWarned(row.warnedOn, row.marksSince ?? 0)}{" "}
                    <button type="button" onClick={() => onOpenFinding(row.handle, "R6")} disabled={opening.handle !== null} aria-busy={opening.handle === row.handle}>
                      {W.openCase}
                    </button>
                    <Link caseId={row.caseId} onOpenCase={onOpenCase} />
                  </li>
                ))}
              </ul>
            )}
            <More total={value.reportingRecords.total} shown={value.reportingRecords.items.length} />

            <h3 id="standing-notices">{W.noticesTitle}</h3>
            {value.noticesUndelivered.items.length === 0 ? (
              <p>{W.empty}</p>
            ) : (
              <ul className="plain" aria-labelledby="standing-notices">
                {value.noticesUndelivered.items.map((row) => (
                  <li key={`${row.handle} ${row.caseId}`}>
                    <UserText>{W.noticesRow(row.handle, row.decidedOn, row.startsAt)}</UserText>
                    <Link caseId={row.caseId} onOpenCase={onOpenCase} />
                  </li>
                ))}
              </ul>
            )}
            <More total={value.noticesUndelivered.total} shown={value.noticesUndelivered.items.length} />

            <h3 id="standing-terminations">{W.terminationsTitle}</h3>
            {value.terminationsWaiting.items.length === 0 ? (
              <p>{W.empty}</p>
            ) : (
              <ul className="plain" aria-labelledby="standing-terminations">
                {value.terminationsWaiting.items.map((row) => (
                  <li key={`${row.handle} ${row.caseId}`}>
                    <UserText>{W.terminatedOn(row.handle, row.decidedOn)}</UserText>{" "}
                    {row.heldBy === "reply" ? (row.replyOnTime ? W.replyHoldsStart : W.replyHolds) : row.heldBy === "appeal" ? W.appealHolds : row.finalOn !== null ? W.finalOn(row.finalOn) : null}
                    <Link caseId={row.caseId} onOpenCase={onOpenCase} />
                  </li>
                ))}
              </ul>
            )}
            <More total={value.terminationsWaiting.total} shown={value.terminationsWaiting.items.length} />
          </>
        )}
      />
    </section>
  );
}

export function Standing({ api, onOpenCase }: { api: StaffApi; onOpenCase(id: CaseId): void }) {
  const [lists, setLists] = useState<Loadable<StandingLists>>({ state: "loading" });
  const [opening, setOpening] = useState<OpeningState>({ handle: null, error: null });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // Opening the screen is its person's action: the read is marked.
    api.standing({ activity: true }).then(
      (value) => alive.current && setLists({ state: "ready", value }),
      (err: unknown) => alive.current && setLists({ state: "failed", message: describeError(err) }),
    );
    return () => {
      alive.current = false;
    };
  }, [api]);

  /**
   * "Open a case on this account": the moderator's own finding on the account by its handle, under the rule the row names
   * (the newest strike's, or R6 for reporting), with that rule's category; the case it opened or joined is shown next.
   * When the account's open case holds reports, those are decided first and the measure gets a case of its own (8.3).
   */
  const openFinding = async (handle: string, ruleId: RuleId) => {
    setOpening({ handle, error: null });
    try {
      const answer = await api.openFinding({ target: { kind: "account", handle }, ground: "rule", ruleId, category: RULE_DEFAULT_CATEGORY[ruleId] }, { activity: true });
      const id = parseCaseId(answer.caseId);
      if (!alive.current) return;
      setOpening({ handle: null, error: null });
      if (id) onOpenCase(id);
    } catch (err) {
      if (alive.current) setOpening({ handle: null, error: describeError(err, FINDING_WORDS) });
    }
  };

  return <StandingView lists={lists} opening={opening} onOpenCase={onOpenCase} onOpenFinding={(handle, ruleId) => void openFinding(handle, ruleId)} />;
}
