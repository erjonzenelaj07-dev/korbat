import { STANDING_RULES, type AtOnceGround, type AuthorStanding, type CaseStanding, type StrikeDue } from "@korbat/contracts";
import { openReportsIn, standingFacts, strikeDueOf, type StandingFacts } from "./standing-repo";
import type { Runner } from "./repo";

/**
 * Account sanctions as the console reads them on a case (3e design, sections 7.4 and 10.3): on a post case whether a
 * final restriction gives a strike and the author's standing in bands, on an account case the account's standing with
 * what the database would accept now. Every member is an aid that lets a control say why it is greyed before the key is
 * asked; the database decides at the commit.
 */

/**
 * strikeDue of a post case: the database's strike_due for a final restriction on a korbat rule other than R2 that rests
 * on no suspect item, and why it answers false: the post already carries a strike that stands, or it was made before its
 * author was told of their newest strike (strike_due's third and fourth rules).
 */
export async function strikeDue(q: Runner, caseId: string): Promise<StrikeDue> {
  const answer = await strikeDueOf(q, caseId);
  if (answer.due) return { due: true, why: "due" };
  return { due: false, why: answer.struck ? "already_struck" : "before_last_strike" };
}

/** A count as the bands of the author's standing print it. */
const strikesBand = (n: number): AuthorStanding["activeStrikes"] => (n <= 0 ? "0" : n === 1 ? "1" : n === 2 ? "2" : "3_or_more");
const suspensionsBand = (n: number): AuthorStanding["suspensionsInYear"] => (n <= 0 ? "0" : n === 1 ? "1" : "2_or_more");

/** What the live standing measure of an account is now, in the words of the bands. */
function nowOf(facts: StandingFacts): AuthorStanding["now"] {
  if (facts.live === null) return "none";
  if (!facts.live.running) return "announced";
  return facts.live.kind === "terminate" ? "terminated" : "suspended";
}

/** authorStanding of a post case: the author's standing in bands, so that the moderator knows what a strike here leads to. */
export async function authorStanding(q: Runner, authorId: string): Promise<AuthorStanding> {
  const facts = await standingFacts(q, authorId);
  return { activeStrikes: strikesBand(facts.strikes.length), suspensionsInYear: suspensionsBand(facts.suspensionsInYear), now: nowOf(facts) };
}

/**
 * standing of an account case, read as decision_actions_check reads it. The ladder holds with at least ladderStrikes
 * active strikes of which one is newer than the account's newest measure of the ladder that stands; an announced
 * suspension then takes the rung of the suspensions of the ladder decided in the year, and a termination can be announced
 * after as many of them as there are rungs. While a standing measure is live nothing more can be taken (standing_conflict).
 */
export async function caseStanding(q: Runner, caseId: string, accountId: string): Promise<CaseStanding> {
  const facts = await standingFacts(q, accountId);
  const live = facts.live !== null;
  const rungs = STANDING_RULES.ladderDays;
  const ladder = !live && facts.strikes.length >= STANDING_RULES.ladderStrikes && facts.newStrikeSinceLadder;
  const atOnce: AtOnceGround[] = [];
  if (!live) {
    if (facts.threat) atOnce.push("threat");
    if (facts.terrorist) atOnce.push("terrorist");
    if (facts.flood.posts >= STANDING_RULES.floodPosts) atOnce.push("flood");
    if (facts.sealOn !== null) atOnce.push("protective");
    if (facts.threatRepeat) atOnce.push("threat_repeat");
  }
  return {
    activeStrikes: facts.strikes.length,
    strikes: facts.strikes.map((strike) => ({ ...strike, ruleId: strike.ruleId as CaseStanding["strikes"][number]["ruleId"] })),
    ladderRule: facts.ladderRule as CaseStanding["ladderRule"],
    suspensionsInYear: facts.suspensionsInYear,
    lastSuspendedOn: facts.lastSuspendedOn,
    maxDays: ladder ? rungs[Math.min(facts.suspensionsInYear, rungs.length - 1)]! : null,
    mayTerminate: ladder && facts.suspensionsInYear >= rungs.length,
    live,
    openReports: await openReportsIn(q, caseId),
    atOnce,
    flood: facts.flood,
    seal: facts.sealOn === null ? null : { decidedOn: facts.sealOn },
  };
}
