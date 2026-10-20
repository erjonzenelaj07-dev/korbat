import {
  AuthorCasesPage,
  AuthorNoticesPage,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DecisionView,
  NOTICE_LIMITS,
  NoticeRequest,
  NoticeResponse,
  NoticeStatus,
  NoticeTarget,
  ReexamineResponse,
  ReleaseNoticeView,
  ReplyResponse,
  ReportsPage,
  UploadRefusalView,
  type CsamKeywordChoice,
  type NoticeItemStatus,
  type PostModeration,
  type ReportRuleId,
  type TdbFormCategory,
} from "@korbat/contracts";
import type { Rule } from "@korbat/rules";
import { api, ApiError, errorMessage } from "./api";
import { CHIP_WORDS, DAILY_LIMIT_WORDS, DECISION_WORDS, REPORT_WORDS } from "./moderation-words";
import { ORDER_TEXTS } from "./orders";
import { STANDING_TEXTS } from "./standing";

/**
 * Reports, notices and moderation cases in the app (3c design, section 9): the calls, and the rules the screens share.
 * Everything that decides is a plain function here, so a test can call it: what a report's address carries, what the
 * form sends, which sentence a failure gets, and what stands beside an item's outcome.
 */

/**
 * The users' contact address, which Expo inlines into the web bundle at export time (WEB_CONTACT_EMAIL in infra/.env; the
 * web image refuses to build without one). The report form names it when the form itself cannot be used, and the terms
 * page shows it.
 */
export const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "";

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");

/**
 * What an appeal or a request for a re-examination carries of what its person typed: the statement, trimmed, when
 * something was written, and nothing otherwise. It is optional and free of form.
 */
export function statementOf(written: string): { statement?: string } {
  const statement = written.trim();
  return statement.length > 0 ? { statement } : {};
}

/** The moderation endpoints the app calls, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const moderation = {
  /** One report or notice. Signed out it carries the human check's token; the answer's token is shown once. */
  send: (request: NoticeRequest) => api("/api/notices", { json: request, schema: NoticeResponse }),
  /** Where a notice stands. The token travels in the body of a POST, never in an address. */
  status: (ref: string, token: string) => api("/api/notices/status", { json: { ref, token }, schema: NoticeStatus }),
  /** The status page's buttons, for which only the token of a mail's link works. */
  contact: (ref: string, token: string, choice: "confirm" | "stop") => api("/api/notices/contact", { json: { ref, token, choice } }),
  cases: (cursor?: string) => api(`/api/moderation/cases${query(cursor)}`, { schema: AuthorCasesPage }),
  decision: (id: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}`, { schema: DecisionView }),
  reports: (cursor?: string) => api(`/api/moderation/reports${query(cursor)}`, { schema: ReportsPage }),
  /** 3d Task 2: the notices about the account's posts that are not decisions, newest first: the releases of its sealed images. */
  notices: (cursor?: string) => api(`/api/moderation/notices${query(cursor)}`, { schema: AuthorNoticesPage }),
  /** 3d Task 2: one release's notice, for its author alone; not_found for anyone else, and while it may not be told yet. */
  release: (id: string) => api(`/api/moderation/releases/${encodeURIComponent(id)}`, { schema: ReleaseNoticeView }),
  /** 3d Task 7: a refused upload's notice, for its uploader alone; not_found for anyone else. */
  upload: (id: string) => api(`/api/moderation/uploads/${encodeURIComponent(id)}`, { schema: UploadRefusalView }),
  /** 3d Task 7: "Object" on a refused upload, with the one message its uploader writes; the answer is the notice as it now reads. */
  objectToUpload: (id: string, text: string) => api(`/api/moderation/uploads/${encodeURIComponent(id)}/objection`, { json: { text }, schema: UploadRefusalView }),
  resumeReportMail: () => api("/api/moderation/report-mail/resume", { method: "POST" }),
  /** The author's appeal of a decision about them. The answer is the decision as it now reads, with the appeal waiting. */
  appeal: (id: string, statement: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}/appeal`, { json: statementOf(statement), schema: DecisionView }),
  /**
   * 3e Task 4: the person's reply to a decision that holds a suspension or a termination, with what they wrote, if
   * anything. The answer says when korbat received it and whether that was before the start.
   */
  reply: (id: string, statement: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}/reply`, { json: statementOf(statement), schema: ReplyResponse }),
  /**
   * 3d Task 6 (design, sections 7.10 and 9.4): "Ask for a person" about a program's decision, with the one message its
   * subject writes. The answer is the decision as it now reads, with the request sent.
   */
  objection: (id: string, text: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}/objection`, { json: { text }, schema: DecisionView }),
  /** A re-examination of an item of a notice, asked with the status page's token, which travels in the body of a POST. */
  reexamineNotice: (ref: string, token: string, position: number, statement: string) => api("/api/notices/reexamine", { json: { ref, token, position, ...statementOf(statement) }, schema: ReexamineResponse }),
  /** A re-examination of an item of a report the signed-in account sent, named by the id its list carries. */
  reexamineOwn: (itemId: string, statement: string) => api(`/api/moderation/items/${encodeURIComponent(itemId)}/reexamine`, { json: statementOf(statement), schema: ReexamineResponse }),
};

// ---------------------------------------------------------------- what a report is opened on

/** A post, optionally with the one of its images that is meant, or a profile: what "Report" was pressed on. */
export type GivenTarget = Extract<NoticeTarget, { kind: "post" | "account" }>;

/** The report form's address: on its own, or opened on a post, on one image of a post, or on a profile. */
export function reportHref(on?: { post: string; media?: string } | { account: string }): string {
  if (!on) return "/report";
  if ("account" in on) return `/report?account=${encodeURIComponent(on.account)}`;
  return `/report?post=${encodeURIComponent(on.post)}${on.media ? `&media=${encodeURIComponent(on.media)}` : ""}`;
}

const one = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** What the form's address names, or null when it names nothing the API would take: the form then asks for a link. */
export function givenTarget(params: { post?: unknown; media?: unknown; account?: unknown }): GivenTarget | null {
  const [post, media, account] = [one(params.post), one(params.media), one(params.account)];
  const parsed = post !== undefined ? NoticeTarget.safeParse({ kind: "post", id: post, ...(media !== undefined ? { mediaId: media } : {}) }) : account !== undefined ? NoticeTarget.safeParse({ kind: "account", handle: account }) : null;
  return parsed?.success && parsed.data.kind !== "link" ? parsed.data : null;
}

// ---------------------------------------------------------------- the form

export type Ground = "rule" | "illegal" | "csam";

/** The category of an illegal-ground notice: one of the 14 the form shows, or "not specified" for someone who is not sure. */
export type NoticeCategoryChoice = TdbFormCategory | "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE";

/** What the person has filled in so far. */
export interface ReportDraft {
  ground: Ground | null;
  /** The rule of the rule ground; on the illegal ground, a rule it also breaks. */
  ruleId: ReportRuleId | null;
  explanation: string;
  category: NoticeCategoryChoice;
  citedLaw: string;
  bonaFide: boolean;
  keyword: CsamKeywordChoice | null;
  name: string;
  email: string;
  /** The item's link, when the form was opened without an item. */
  link: string;
  /** Up to nine more korbat links. */
  others: string[];
}

export const EMPTY_DRAFT: ReportDraft = {
  ground: null,
  ruleId: null,
  explanation: "",
  category: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
  citedLaw: "",
  bonaFide: false,
  keyword: null,
  name: "",
  email: "",
  link: "",
  others: [],
};

/** How many more links "Other items" takes. */
export const OTHER_LINKS_MAX = NOTICE_LIMITS.maxTargets - 1;

/** What the draft names, in order: the item the form was opened on or its link, then the other links that hold something. */
export function draftTargets(draft: ReportDraft, given: GivenTarget | null): NoticeTarget[] {
  const links = [...(given ? [] : [draft.link]), ...draft.others].map((url) => url.trim()).filter((url) => url.length > 0);
  return [...(given ? [given] : []), ...links.map((url) => ({ kind: "link" as const, url }))];
}

/** The handle a target names when it is a profile: an account, or a link to /u/<handle>. Null for anything else. */
function profileOf(target: NoticeTarget): string | null {
  if (target.kind === "account") return target.handle.toLowerCase();
  if (target.kind !== "link") return null;
  try {
    const match = /^[/]u[/]@?([A-Za-z0-9_]{3,20})[/]?$/.exec(new URL(target.url).pathname);
    return match ? match[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** How many different profiles the targets name. */
export function profilesNamed(targets: readonly NoticeTarget[]): number {
  return new Set(targets.map(profileOf).filter((handle) => handle !== null)).size;
}

/**
 * Whether the form asks for the post or the image itself: on the anonymous path, for images, when the only item is a
 * profile. From a profile alone korbat cannot tell which image is meant. The form says so and never refuses the profile.
 */
export function profileOnly(draft: ReportDraft, given: GivenTarget | null): boolean {
  const targets = draftTargets(draft, given);
  return draft.ground === "csam" && (draft.keyword === "csam" || draft.keyword === "deepfake") && targets.length === 1 && profileOf(targets[0]!) !== null;
}

/** Whether the anonymous path's report names more profiles than one report may: the form says so before anything is sent. */
export function tooManyProfiles(draft: ReportDraft, given: GivenTarget | null): boolean {
  return draft.ground === "csam" && profilesNamed(draftTargets(draft, given)) > CSAM_NOTICE_MAX_ACCOUNTS;
}

const text = (value: string): string | undefined => (value.trim().length > 0 ? value.trim() : undefined);

/**
 * The request the draft makes, or the sentence that says what is still missing. A signed-out sender needs the human
 * check's token on every ground; a name and an address are sent only signed out and only on the illegal ground, since a
 * signed-in sender's contact is their account and the anonymous path asks for neither.
 */
export function noticeFrom(draft: ReportDraft, given: GivenTarget | null, sender: { signedIn: boolean; turnstileToken: string | null }): { request: NoticeRequest } | { problem: string } {
  const missing = REPORT_WORDS.missing;
  if (draft.ground === null) return { problem: missing.ground };
  const targets = draftTargets(draft, given);
  if (targets.length === 0) return { problem: missing.link };
  if (targets.some((target) => target.kind === "link" && !/^https?:[/][/]/i.test(target.url))) return { problem: missing.linkInvalid };
  const human = sender.signedIn ? {} : { turnstileToken: sender.turnstileToken ?? undefined };
  const explanation = text(draft.explanation);
  let request: unknown;
  if (draft.ground === "rule") {
    if (draft.ruleId === null) return { problem: missing.rule };
    request = { ground: "rule", ruleId: draft.ruleId, targets, ...(explanation ? { explanation } : {}), ...human };
  } else if (draft.ground === "illegal") {
    if (!explanation) return { problem: missing.whyIllegal };
    if (!draft.bonaFide) return { problem: missing.bonaFide };
    const [citedLaw, name, email] = [text(draft.citedLaw), text(draft.name), text(draft.email)];
    request = {
      ground: "illegal",
      targets,
      category: draft.category,
      ...(citedLaw ? { citedLaw } : {}),
      explanation,
      bonaFide: true,
      ...(draft.ruleId ? { ruleId: draft.ruleId } : {}),
      ...(!sender.signedIn && name ? { name } : {}),
      ...(!sender.signedIn && email ? { email } : {}),
      ...human,
    };
  } else {
    if (draft.keyword === null) return { problem: missing.keyword };
    if (tooManyProfiles(draft, given)) return { problem: REPORT_WORDS.oneProfile };
    request = { ground: "csam", targets, keyword: draft.keyword, ...(explanation ? { explanation } : {}), ...(draft.bonaFide ? { bonaFide: true } : {}), ...human };
  }
  if (!sender.signedIn && !sender.turnstileToken) return { problem: missing.human };
  const parsed = NoticeRequest.safeParse(request);
  return parsed.success ? { request: parsed.data } : { problem: missing.details };
}

/** The first sentence of a rule's text: the one line the form shows under its title. */
export function ruleLine(rule: Pick<Rule, "text">): string {
  const end = rule.text.indexOf(". ");
  return end === -1 ? rule.text : rule.text.slice(0, end + 1);
}

/** A wait as the form words it, from the answer's Retry-After: in minutes under an hour, in hours otherwise. */
export function waitWords(seconds: number | undefined): string {
  if (seconds === undefined || seconds >= 3600) {
    const hours = seconds === undefined ? 1 : Math.ceil(seconds / 3600);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * What the form shows for a failed send. Three failures get the form's own words, which name the users' contact address,
 * since for each the form itself is what does not work: the human check, the limits and an API that cannot take reports.
 * On the anonymous path each is followed by what a mail gives away. Anything else is the server's message, as elsewhere.
 */
export function reportFailure(err: unknown, anonymous: boolean, contact: string = CONTACT_EMAIL): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  let words: string | null = null;
  if (err.code === "human_check_failed") words = REPORT_WORDS.humanCheckFailed(contact);
  if (err.code === "rate_limited") words = REPORT_WORDS.rateLimited(waitWords(err.retryAfter), contact);
  if (err.code === "service_unavailable") words = REPORT_WORDS.unavailable(contact);
  if (words === null) return errorMessage(err);
  return anonymous ? `${words} ${REPORT_WORDS.mailShowsAddress}` : words;
}

/** What the appeal form and the re-examination control show for a failed request: the day's limit in words of its own, with the wait; anything else as elsewhere. */
export function dailyLimitFailure(err: unknown, limit: keyof typeof DAILY_LIMIT_WORDS): string {
  if (err instanceof ApiError && err.code === "rate_limited") return DAILY_LIMIT_WORDS[limit](waitWords(err.retryAfter));
  return errorMessage(err);
}

// ---------------------------------------------------------------- the status page

/** The status page's address for a notice, its token in the fragment, which no server is sent. */
export function statusLink(origin: string, ref: string, token: string): string {
  return `${origin}/notice/${ref}#t=${token}`;
}

/** The token a status page's address carries in its fragment, or null when the fragment holds none. */
export function fragmentToken(hash: string): string | null {
  return /^#t=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
}

/**
 * What stands beside one item on the status page and in Your reports (3c design, section 9, and the rule of 7.8 step 4):
 *   - `waiting`: nothing is released yet;
 *   - `final`: the outcome was changed on review or by a correction, or answers a re-examination: it is final within
 *     korbat. An answer given while nobody could open the post's images is never final: it leaves the re-examination
 *     unspent;
 *   - `reexamination`: the answer can still be examined again, until the item's date;
 *   - `courts`: any other decided outcome, which cannot be examined again.
 */
export function itemRedress(item: NoticeItemStatus): "waiting" | "final" | "reexamination" | "courts" {
  if (item.outcome === null) return "waiting";
  const unseenAnswer = item.unseen && (item.outcome === "no_violation" || item.outcome === "not_evident");
  if (item.changed || (item.reexamines && !unseenAnswer)) return "final";
  if (item.reexamination?.open) return "reexamination";
  return "courts";
}

/**
 * Whether asking for a re-examination of the item at `index` examines another item too (3c design, section 7.2): the
 * item is a report of child sexual abuse material that the sender named, and the item korbat added for the post it
 * quotes can be examined again as well. korbat then examines both, and the page says so beside the control.
 */
export function quotedExaminedToo(items: readonly NoticeItemStatus[], index: number): boolean {
  const item = items[index];
  if (!item || !item.suspect || item.quotedBy !== null || !item.reexamination?.open) return false;
  return items.some((other) => other.quotedBy === item.position && !other.reexamines && other.reexamination?.open === true);
}

// ---------------------------------------------------------------- the appeal's state

/**
 * What a pending appeal's line says on the decision's screen (3c design, section 7.7), from the decision's own data and
 * the API's two answers about its review, which name nobody:
 *   - an appeal of a decision that sealed images waits for the authorities' assessment, whoever could review it;
 *   - otherwise, while someone at korbat may review it, it waits for a reviewer;
 *   - when nobody may: for a review that is an admin's, that it waits for an admin, and that korbat has one while it
 *     has one; else that korbat has one moderator, or that none who took no part in the case is available now. The last
 *     gives no reason: a moderator may be unable to review through a relation to someone in the case.
 */
export function appealWaitWords(view: Pick<DecisionView, "measures" | "appeal">): string | null {
  const appeal = view.appeal;
  if (appeal === null || appeal.state !== "pending") return null;
  const waits = DECISION_WORDS.appealWaits;
  if (view.measures.some((measure) => measure.kind === "seal_media")) return waits.sealed;
  if (appeal.reviewer === "available") return DECISION_WORDS.appealWaiting;
  if (appeal.needsAdmin) return appeal.reviewer === "none_single_staff" ? `${waits.admin} ${waits.oneAdmin}` : waits.admin;
  return waits[appeal.reviewer];
}

// ---------------------------------------------------------------- chips and times

/** The chip of the author's own withheld or removed post: "Under review: R4", "Removed: illegal content". */
export function chipText(decision: PostModeration): string {
  // 3f (design, section 9.1): [chip.order], a post a DSA order removed without withholding it from its author.
  if (decision.order === true) return ORDER_TEXTS.chip.order;
  const state = decision.interim ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
  const ground = decision.legal ? CHIP_WORDS.illegal : decision.ruleId;
  const chip = ground ? `${state}: ${ground}` : state;
  // 3e (design, section 9.4): a removed post's chip names its strike while the strike stands and counts.
  return decision.strikeUntil ? STANDING_TEXTS.chip(chip, decision.strikeUntil) : chip;
}

/** A time as korbat's statements print it: the date and the minute in UTC. */
export function utcMinute(at: string): string {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
