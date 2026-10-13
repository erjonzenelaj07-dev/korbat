import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { REPLY_TEXT_MAX, RETENTION, STANDING_RULES, type AccountStanding, type DecisionView } from "@korbat/contracts";
import { ReplyPanel, replyOpening } from "../src/app/settings/cases/[id]/reply";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { StandingBanner } from "../src/components/StandingBanner";
import { messageFor } from "../src/lib/api";
import { bannerSentences, nowSentence, STANDING_TEXTS, standingDay, standingTime } from "../src/lib/standing";

/**
 * The app's part of announced suspensions, replies and termination (3e design, sections 9.1 to 9.3 and 9.8; Task 4): the
 * banner in every state of a suspension and of a termination, with "Reply"; the decision's block "Where it stands now",
 * what the measure rests on, the reply and the appeal's sentences; the reply screen; and [terminate.delete]. Components
 * are server-rendered with made-up answers; what a static render cannot show (the requests) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: () => createElement("img") };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .split(" ")
    .filter((part) => part !== "")
    .join(" ");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EARLIEST = "2026-10-15T10:00:00.000Z";
const STARTS = "2026-10-16T10:00:00.000Z";
const ENDS = "2026-10-19T10:00:00.000Z";
const APPEAL = "2027-04-12T10:00:00.000Z";
const FILED = "2026-10-13T08:00:00.000Z";

const measure = (more: Partial<NonNullable<AccountStanding["measure"]>> = {}): AccountStanding => ({
  activeStrikes: 3,
  measure: {
    decisionId: id(9),
    kind: "suspend",
    days: 3,
    state: "unfixed",
    earliestStart: EARLIEST,
    startsAt: null,
    endsAt: null,
    reply: null,
    replyOpen: true,
    appealUntil: APPEAL,
    appealPending: false,
    ...more,
  },
  reporting: null,
  handleRetired: false,
});

/** An announced suspension's decision as its author reads it, with where it stands now. */
const decision = (standing: Partial<NonNullable<DecisionView["standing"]>> = {}, extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(9),
  kind: "final",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R1",
  rulesVersion: 3,
  redressVersion: 2,
  legalReference: null,
  facts: "When this was written the account had 3 active strikes.",
  reason: "Three strikes in two weeks.",
  source: "own_initiative",
  decidedAt: "2026-10-12T10:00:00.000Z",
  post: null,
  measures: [{ kind: "suspend", mediaId: null, noEffect: null, sealed: null, announced: true, days: 3, basis: "strikes", earliestStart: EARLIEST }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  appealUntil: APPEAL,
  reversedOn: null,
  content: { kind: "account", handle: "someone", displayName: "Someone", bio: "" },
  appeal: null,
  strike: null,
  standing: {
    state: "unfixed",
    earliestStart: EARLIEST,
    startsAt: null,
    endsAt: null,
    endedAt: null,
    endedBy: null,
    replaced: false,
    restsOn: [
      { decisionId: id(1), ruleId: "R3", decidedAt: "2026-09-20T09:00:00.000Z", countsUntil: "2026-12-19T09:00:00.000Z", state: "counts", overruledAt: null },
      { decisionId: id(2), ruleId: "R1", decidedAt: "2026-09-27T09:00:00.000Z", countsUntil: "2026-12-26T09:00:00.000Z", state: "overruled", overruledAt: "2026-10-01T09:00:00.000Z" },
    ],
    reply: null,
    replyOpen: true,
    ...standing,
  },
  ...extra,
});
const termination = (standing: Partial<NonNullable<DecisionView["standing"]>> = {}, extra: Partial<DecisionView> = {}): DecisionView =>
  decision(standing, { measures: [{ kind: "terminate", mediaId: null, noEffect: null, sealed: null, announced: true, days: null, basis: "ladder_end", earliestStart: EARLIEST }], ...extra });

describe("3e Task 4: the words (design, sections 9.1 to 9.3 and 9.8)", () => {
  test("the banner's sentences are the design's, with the mail's days from RETENTION and every time as standingTime prints it", () => {
    expect(STANDING_TEXTS.banner.unfixed("suspend", 3, EARLIEST)).toBe(
      `korbat has decided to suspend your account for 3 days. Nothing is restricted yet. It will not start before ${standingTime(EARLIEST)}; the exact time appears here within ${RETENTION.mailGiveUpDays} days, once korbat knows whether its email to you could be sent.`,
    );
    expect(STANDING_TEXTS.banner.unfixed("terminate", null, EARLIEST)).toContain("korbat has decided to terminate your account. Nothing is restricted yet.");
    expect(STANDING_TEXTS.banner.announced("suspend", 3, STARTS)).toBe(
      `korbat will suspend your account for 3 days from ${standingTime(STARTS)}. Nothing is restricted until then. If you reply before it starts, it waits for korbat's answer.`,
    );
    expect(STANDING_TEXTS.banner.held("suspend", FILED, EARLIEST)).toBe(
      `You replied on ${standingDay(FILED)}. The suspension does not start while your reply is unanswered. korbat answers you here and by email. If korbat keeps its decision, the suspension starts with that answer, and never before ${standingTime(EARLIEST)}.`,
    );
    expect(STANDING_TEXTS.banner.held("terminate", FILED, EARLIEST)).toContain("The termination does not start while your reply is unanswered.");
    expect(STANDING_TEXTS.banner.terminated(APPEAL)).toBe(
      `korbat has terminated your account. You cannot post or interact; your posts stay visible for now. korbat deletes the account once the decision is final: on ${standingTime(APPEAL)} if you do not appeal, or when your appeal is answered and the decision kept. Until then you can reply, appeal, export your data, or delete the account yourself.`,
    );
    expect(STANDING_TEXTS.banner.terminated(APPEAL).startsWith(STANDING_TEXTS.banner.terminatedFirst)).toBe(true);
    expect(STANDING_TEXTS.banner.appealed).toBe("Your appeal is waiting for a reviewer. Nothing is deleted before it is answered.");
    expect(STANDING_TEXTS.banner.replied).toBe("Your reply is waiting for an answer. Nothing is deleted before it is answered.");
  });

  test("the reply screen's, the decision's and the appeal's sentences, each number from the contracts", () => {
    expect(STANDING_TEXTS.reply.title).toBe("Reply to korbat");
    expect(STANDING_TEXTS.reply.before("suspend", STARTS)).toBe(
      `korbat has decided to suspend your account from ${standingTime(STARTS)}. If you reply before then, the suspension does not start until a moderator has read your reply and answered you. The answer reverses the suspension, or keeps it; a kept suspension starts with the answer, and never before ${standingTime(STARTS)}, so replying early costs you nothing.`,
    );
    expect(STANDING_TEXTS.reply.unfixed("suspend", EARLIEST)).toContain(`suspend your account not before ${standingTime(EARLIEST)}. If you reply before it starts,`);
    expect(STANDING_TEXTS.reply.running("suspend", ENDS)).toBe(
      `Your account is suspended until ${standingTime(ENDS)}. A moderator reads your reply and answers you, and can end the suspension at once. The suspension goes on meanwhile.`,
    );
    expect(STANDING_TEXTS.reply.running("terminate", null)).toBe(
      "Your account is terminated. A moderator reads your reply and answers you, and can end the termination at once. Nothing is deleted before your reply is answered.",
    );
    expect(STANDING_TEXTS.reply.count(12)).toBe(`12 of ${REPLY_TEXT_MAX} characters`);
    expect(STANDING_TEXTS.reply.sentOnTime("suspend", FILED)).toBe(`korbat received your reply on ${standingTime(FILED)}, before the start. The suspension is held until korbat answers.`);
    expect(STANDING_TEXTS.reply.sentLate("terminate", FILED)).toBe(`korbat received your reply on ${standingTime(FILED)}. The termination stays until korbat answers, and nothing is deleted before that.`);
    expect(STANDING_TEXTS.rests.hint).toBe(`Each strike is appealed on its own decision's screen. If one is overruled and fewer than ${STANDING_RULES.ladderStrikes} of these still stand, this suspension ends at once.`);
    expect(STANDING_TEXTS.terminateDelete).toBe("If you delete your account now, your appeal ends with it: nothing is left to restore.");
    expect(messageFor("reply_not_open")).toBe("You cannot reply to this decision: you already replied, or it has ended or was lifted.");
  });
});

describe("3e Task 4: the banner in every state (design, section 9.1)", () => {
  test("a suspension not started: unfixed, announced and held, in amber, with Reply while no reply was sent", () => {
    expect(bannerSentences(measure())).toEqual([STANDING_TEXTS.banner.unfixed("suspend", 3, EARLIEST)]);
    expect(bannerSentences(measure({ state: "announced", startsAt: STARTS, endsAt: ENDS }))).toEqual([STANDING_TEXTS.banner.announced("suspend", 3, STARTS)]);
    const held = measure({ state: "held", reply: { filedAt: FILED, onTime: true, answeredAt: null }, replyOpen: false });
    expect(bannerSentences(held)).toEqual([STANDING_TEXTS.banner.held("suspend", FILED, EARLIEST)]);
    const out = html(<StandingBanner standing={measure()} />);
    expect(out).toContain('aria-level="2"');
    expect(out).toContain(`href="/settings/cases/${id(9)}/reply"`);
    expect(textOf(out)).toContain(` ${STANDING_TEXTS.banner.reply} `);
    // Once replied, no Reply; the running suspension is red.
    expect(html(<StandingBanner standing={held} />)).not.toContain("/reply");
    // Amber before the start, red while it runs: the colour repeats the words (a static render carries no class, so the source says it).
    expect(read("components", "StandingBanner.tsx")).toContain('measure.state === "running" ? "border-red-800 bg-red-950" : "border-amber-700 bg-amber-950"');
  });

  test("a termination: announced in the suspension's words with terminate your account; running with its deletion, its appeal pending, and its reply unanswered", () => {
    const terminate = { kind: "terminate" as const, days: null };
    expect(bannerSentences(measure({ ...terminate }))).toEqual([STANDING_TEXTS.banner.unfixed("terminate", null, EARLIEST)]);
    expect(bannerSentences(measure({ ...terminate, state: "running", startsAt: STARTS }))).toEqual([STANDING_TEXTS.banner.terminated(APPEAL)]);
    expect(bannerSentences(measure({ ...terminate, state: "running", startsAt: STARTS, appealPending: true }))).toEqual([STANDING_TEXTS.banner.terminatedFirst, STANDING_TEXTS.banner.appealed]);
    const replied = measure({ ...terminate, state: "running", startsAt: STARTS, appealPending: true, reply: { filedAt: FILED, onTime: false, answeredAt: null }, replyOpen: false });
    expect(bannerSentences(replied)).toEqual([STANDING_TEXTS.banner.terminatedFirst, STANDING_TEXTS.banner.appealed, STANDING_TEXTS.banner.replied]);
    const out = textOf(html(<StandingBanner standing={replied} />));
    expect(out).toContain(STANDING_TEXTS.banner.replied);
    // The appeal is pending: no Appeal button, and no Reply once replied.
    expect(out).not.toContain(` ${STANDING_TEXTS.banner.appeal} `);
    expect(out).not.toContain(` ${STANDING_TEXTS.banner.reply} `);
  });
});

describe("3e Task 4: the decision's screen (design, section 9.2)", () => {
  test("Where it stands now: one sentence for each state, read fresh", () => {
    const at = (state: NonNullable<DecisionView["standing"]>["state"], more: Partial<NonNullable<DecisionView["standing"]>> = {}) => ({ ...decision().standing!, state, ...more });
    expect(nowSentence(at("unfixed"), "suspend", false)).toBe(`Start: not fixed yet, and not before ${standingTime(EARLIEST)}.`);
    expect(nowSentence(at("announced", { startsAt: STARTS, endsAt: ENDS }), "suspend", false)).toBe(`Starts on ${standingTime(STARTS)}. Ends on ${standingTime(ENDS)}.`);
    expect(nowSentence(at("held", { reply: { filedAt: FILED, onTime: true, text: null, erasedAt: null, answeredAt: null, answeredBy: null } }), "suspend", false)).toBe(
      `Held by your reply of ${standingDay(FILED)}: it has not started.`,
    );
    expect(nowSentence(at("running", { startsAt: STARTS, endsAt: ENDS }), "suspend", false)).toBe(`Started on ${standingTime(STARTS)}. Ends on ${standingTime(ENDS)}.`);
    expect(nowSentence(at("ended", { startsAt: STARTS, endsAt: ENDS }), "suspend", false)).toBe(`Ran from ${standingTime(STARTS)} to ${standingTime(ENDS)}.`);
    const lifted = "2026-10-14T09:00:00.000Z";
    expect(nowSentence(at("never", { endedAt: lifted, endedBy: id(5) }), "suspend", false)).toBe(`Never started: korbat reversed it on ${standingDay(lifted)}.`);
    expect(nowSentence(at("never", { endedAt: lifted, endedBy: id(5), replaced: true }), "suspend", false)).toBe(
      `Never started: korbat withdrew it on ${standingDay(lifted)} because it took another measure on your account.`,
    );
    expect(nowSentence(at("lifted", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-17T09:00:00.000Z" }), "suspend", false)).toBe(`Lifted on ${standingDay("2026-10-17T09:00:00.000Z")}.`);
    expect(nowSentence(at("lifted", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-25T09:00:00.000Z" }), "suspend", false)).toContain("it no longer counts toward a later suspension.");
    expect(nowSentence(at("basis_ended", { endedAt: lifted }), "suspend", false)).toBe(`It will not start: korbat reversed a decision it rested on, on ${standingDay(lifted)}.`);
    expect(nowSentence(at("basis_ended", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-17T09:00:00.000Z" }), "suspend", true)).toBe(
      `Ended on ${standingDay("2026-10-17T09:00:00.000Z")}, because korbat lifted the seal it rested on.`,
    );
    expect(nowSentence(at("basis_ended", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-25T09:00:00.000Z" }), "suspend", false)).toContain(
      `On ${standingDay("2026-10-25T09:00:00.000Z")} korbat reversed a decision it rested on, so it no longer counts toward a later suspension.`,
    );
    expect(nowSentence(at("running", { startsAt: STARTS }), "terminate", false, APPEAL)).toBe(
      `Started on ${standingTime(STARTS)}. It has no end date. The account is deleted once this decision is final: on ${standingTime(APPEAL)} if you do not appeal. Nothing is deleted while your appeal or your reply is unanswered.`,
    );
  });

  test("the block under the statement: the sentence, the strikes it rests on as links with [rests.hint], Reply, and [appeal.early] above the appeal", () => {
    const out = html(<DecisionDetail view={decision()} />);
    const text = textOf(out);
    expect(text).toContain(STANDING_TEXTS.now.title);
    expect(text).toContain(STANDING_TEXTS.now.unfixed(EARLIEST));
    expect(text).toContain(`Strike of ${standingDay("2026-09-20T09:00:00.000Z")} under R3: counts until ${standingTime("2026-12-19T09:00:00.000Z")}`);
    expect(text).toContain(`Strike of ${standingDay("2026-09-27T09:00:00.000Z")} under R1: overruled on ${standingDay("2026-10-01T09:00:00.000Z")}`);
    expect(out).toContain(`href="/settings/cases/${id(1)}"`);
    expect(out).toContain(`href="/settings/cases/${id(2)}"`);
    expect(text).toContain(STANDING_TEXTS.rests.hint);
    expect(out).toContain(`href="/settings/cases/${id(9)}/reply"`);
    expect(text).toContain(STANDING_TEXTS.appeal.early);
    expect(text.indexOf(STANDING_TEXTS.now.title)).toBeLessThan(text.indexOf(STANDING_TEXTS.appeal.early));
    // A decision without a suspension or a termination has no block.
    expect(textOf(html(<DecisionDetail view={decision({}, { standing: null })} />))).not.toContain(STANDING_TEXTS.now.title);
  });

  test("the reply: its text while kept, or that it was erased; not answered, answered with a link, closed by a withdrawal or by a broken basis; and [appeal.again] after a kept answer", () => {
    const reply = { filedAt: FILED, onTime: true, text: "I quoted a film.", erasedAt: null, answeredAt: null, answeredBy: null };
    const waiting = textOf(html(<DecisionDetail view={decision({ state: "held", reply, replyOpen: false })} />));
    expect(waiting).toContain(`${STANDING_TEXTS.reply.replied(FILED)} I quoted a film. ${STANDING_TEXTS.reply.waiting}`);
    expect(waiting).not.toContain(` ${STANDING_TEXTS.reply.button} `);
    const answeredAt = "2026-10-14T09:00:00.000Z";
    const kept = html(<DecisionDetail view={decision({ state: "announced", startsAt: "2026-10-15T10:00:00.000Z", endsAt: ENDS, reply: { ...reply, answeredAt, answeredBy: id(6) }, replyOpen: false })} />);
    expect(textOf(kept)).toContain(STANDING_TEXTS.reply.answered(answeredAt));
    expect(kept).toContain(`href="/settings/cases/${id(6)}"`);
    expect(textOf(kept)).toContain(STANDING_TEXTS.appeal.again(answeredAt, APPEAL));
    const erased = textOf(html(<DecisionDetail view={decision({ state: "ended", startsAt: STARTS, endsAt: ENDS, reply: { ...reply, text: null, erasedAt: "2027-05-01T09:00:00.000Z", answeredAt, answeredBy: id(6) }, replyOpen: false })} />));
    expect(erased).toContain(STANDING_TEXTS.reply.erased("2027-05-01T09:00:00.000Z"));
    expect(erased).not.toContain("I quoted a film.");
    const withdrawn = textOf(html(<DecisionDetail view={decision({ state: "never", endedAt: answeredAt, endedBy: id(7), replaced: true, reply: { ...reply, answeredAt, answeredBy: id(7) }, replyOpen: false })} />));
    expect(withdrawn).toContain(STANDING_TEXTS.reply.closedWithdrawn(answeredAt));
    expect(withdrawn).toContain(STANDING_TEXTS.now.endedBy);
    expect(withdrawn).not.toContain(STANDING_TEXTS.appeal.again(answeredAt, APPEAL));
    const basis = textOf(html(<DecisionDetail view={decision({ state: "basis_ended", endedAt: answeredAt, endedBy: id(8), reply: { ...reply, answeredAt, answeredBy: id(8) }, replyOpen: false })} />));
    expect(basis).toContain(STANDING_TEXTS.reply.closedBasis(answeredAt));
  });

  test("a termination: its sentence with the appeal's last moment, and [terminate.delete] beside its appeal and in Settings, Account", () => {
    const text = textOf(html(<DecisionDetail view={termination({ state: "running", startsAt: STARTS })} />));
    expect(text).toContain(STANDING_TEXTS.now.terminated(STARTS, APPEAL));
    expect(text).toContain(STANDING_TEXTS.terminateDelete);
    expect(textOf(html(<DecisionDetail view={decision({ state: "running", startsAt: STARTS, endsAt: ENDS })} />))).not.toContain(STANDING_TEXTS.terminateDelete);
    const account = read("app", "settings", "account.tsx");
    expect(account).toContain('{me.standing?.measure?.kind === "terminate" ? <Body>{STANDING_TEXTS.terminateDelete}</Body> : null}');
    expect(account.indexOf("STANDING_TEXTS.terminateDelete")).toBeLessThan(account.indexOf("<DeleteSection"));
  });
});

describe("3e Task 4: the reply screen (design, section 9.3)", () => {
  test("its opening follows the decision's standing: before a fixed start, before one not fixed, while it runs; none once the reply is closed", () => {
    expect(replyOpening(decision())).toBe(STANDING_TEXTS.reply.unfixed("suspend", EARLIEST));
    expect(replyOpening(decision({ state: "announced", startsAt: STARTS, endsAt: ENDS }))).toBe(STANDING_TEXTS.reply.before("suspend", STARTS));
    expect(replyOpening(decision({ state: "running", startsAt: STARTS, endsAt: ENDS }))).toBe(STANDING_TEXTS.reply.running("suspend", ENDS));
    expect(replyOpening(termination({ state: "running", startsAt: STARTS }))).toBe(STANDING_TEXTS.reply.running("terminate", null));
    expect(replyOpening(decision({ state: "held", replyOpen: false }))).toBeNull();
    expect(replyOpening(decision({}, { standing: null }))).toBeNull();
  });

  test("the form: the opening, the optional field with its count, the three hints and Send reply; a closed reply says so with the way back", () => {
    const send = async () => ({ filedAt: FILED, onTime: true });
    const out = html(<ReplyPanel view={decision({ state: "announced", startsAt: STARTS, endsAt: ENDS })} onSend={send} />);
    const text = textOf(out);
    expect(text).toContain(STANDING_TEXTS.reply.before("suspend", STARTS));
    expect(out).toContain(`aria-label="${STANDING_TEXTS.reply.field}"`);
    expect(out).toContain(`maxLength="${REPLY_TEXT_MAX}"`);
    expect(text).toContain(STANDING_TEXTS.reply.count(0));
    for (const line of [STANDING_TEXTS.reply.hint, STANDING_TEXTS.reply.once, STANDING_TEXTS.reply.kept]) expect(text).toContain(line);
    expect(text).toContain(STANDING_TEXTS.reply.send);
    const closed = textOf(html(<ReplyPanel view={decision({ state: "held", replyOpen: false })} onSend={send} />));
    expect(closed).toContain(STANDING_TEXTS.reply.closed);
    expect(closed).toContain(STANDING_TEXTS.reply.back);
    expect(closed).not.toContain(STANDING_TEXTS.reply.send);
  });

  test("the screen posts to the reply route through the moderation client, and sits beside the decision's screen", () => {
    expect(read("app", "settings", "cases", "[id]", "reply.tsx")).toContain("moderation.reply(id, statement)");
    expect(read("lib", "moderation.ts")).toContain("/api/moderation/decisions/${encodeURIComponent(id)}/reply`, { json: statementOf(statement), schema: ReplyResponse }");
    const reply = read("app", "settings", "cases", "[id]", "reply.tsx");
    expect(reply).toContain('<SettingsNav current="cases" />');
    expect(reply.indexOf("sentOnTime")).toBeLessThan(reply.indexOf("export default function Reply"));
  });
});
