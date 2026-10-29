import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CSAM_KEYWORDS, CSAM_NOTICE_MAX_ACCOUNTS, NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type HiddenMedia, type MediaView, type PostView } from "@korbat/contracts";
import { RULES } from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  return "contact@korbat.local";
});

import Report from "../src/app/report";
import Terms from "../src/app/terms";
import { ReportForm, ReportSent } from "../src/components/moderation/ReportForm";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard, QuoteEmbed } from "../src/components/social/PostCard";
import { ApiError, messageFor } from "../src/lib/api";
import {
  CONTACT_EMAIL,
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  draftTargets,
  givenTarget,
  noticeFrom,
  profileOnly,
  profilesNamed,
  reportFailure,
  reportHref,
  ruleLine,
  statusLink,
  tooManyProfiles,
  waitWords,
  type GivenTarget,
  type ReportDraft,
} from "../src/lib/moderation";
import { CATEGORY_LABELS, CONTACT_WORDS, REPORT_WORDS, numberWord } from "../src/lib/moderation-words";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The report form and what leads to it in the web app (3c design, section 9): "Report" on posts, images and profiles, the
 * form's three grounds with every word of it, what it sends, its success screen, the three failures it words itself, and
 * the terms page's Contact section. The helpers that decide are called; the form and the screens are server-rendered in
 * each state, as explore.test.tsx renders its screens; what a static render cannot show (a request, a press) is read from
 * the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/report",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.
// The human check's widget loads a script from Cloudflare; here it is a mark a test can find.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** The address of every link in the markup, in order. */
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
/** The accessible name of every field in the markup. */
const fields = (markup: string): string[] => [...markup.matchAll(/<(?:input|textarea)\b[^>]*\baria-label="([^"]*)"/g)].map((match) => match[1]!.replace(/&#x27;/g, "'"));
/** Every element with this role, as its opening tag. */
const withRole = (markup: string, role: string): string[] => (markup.match(/<[a-z]+\b[^>]*>/g) ?? []).filter((tag) => tag.includes(`role="${role}"`));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST: GivenTarget = { kind: "post", id: id(1) };
const PROFILE: GivenTarget = { kind: "account", handle: "ada" };
const draft = (extra: Partial<ReportDraft> = {}): ReportDraft => ({ ...EMPTY_DRAFT, ...extra });
const form = (options: { signedIn?: boolean; given?: GivenTarget | null; initial?: Partial<ReportDraft> } = {}) =>
  html(<ReportForm signedIn={options.signedIn ?? true} given={options.given === undefined ? POST : options.given} initial={options.initial} />);

describe("3d (design, section 9.1): the rules page", () => {
  test("the form links The rules beside its list of rules", () => {
    const out = form({ initial: { ground: "rule" } });
    expect(out).toContain('href="/rules"');
    expect(textOf(out)).toContain("The rules");
    expect(form({ initial: { ground: "illegal" } })).not.toContain('href="/rules"');
  });
});

describe("the words", () => {
  test("the form's sentences are the design's, with their numbers printed from the contracts", () => {
    expect(REPORT_WORDS.question).toBe("What is wrong with it?");
    expect(REPORT_WORDS.grounds).toEqual({
      rule: "It breaks a korbat rule",
      illegal: "It is illegal",
      csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
    });
    expect(REPORT_WORDS.r2Instead).toBe("Child sexual abuse material: choose the third answer, which is anonymous.");
    expect(REPORT_WORDS.csamInstead).toBe("For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.");
    expect(Object.keys(REPORT_WORDS.keywords)).toEqual(Object.keys(CSAM_KEYWORDS));
    expect(REPORT_WORDS.keywords).toEqual({
      csam: "Sexual images or videos of a child",
      deepfake: "Such images made or altered by software",
      grooming: "An adult seeking sexual contact with a child",
      abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
    });
    expect(REPORT_WORDS.anonymous).toBe("This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.");
    expect(REPORT_WORDS.profileOnly).toBe(
      "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
    );
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(REPORT_WORDS.oneProfile).toBe("On this path a report can name one profile. Send another report for the next one.");
    expect(REPORT_WORDS.bonaFide).toBe("I believe in good faith that the information in this report is accurate and complete.");
    expect(REPORT_WORDS.contactHint).toBe("Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.");
    expect(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`).toBe(
      "korbat uses what you send only to handle this report; how long it keeps it is in the terms. Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member. If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
    );
    expect(REPORT_WORDS.turnstile).toBe("Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.");
    expect(REPORT_WORDS.keepLink).toBe("Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.");
    expect(REPORT_WORDS.followInSettings).toBe("You can follow it under Settings, Cases, Your reports.");
    expect([REPORT_WORDS.control, REPORT_WORDS.imageControl, REPORT_WORDS.link, REPORT_WORDS.otherItems, REPORT_WORDS.explanation, REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]).toEqual([
      "Report",
      "Report this image",
      "Link to the post or profile on korbat",
      "Other items",
      "Anything the moderator should know",
      "Which law or country (optional)",
      "Why is it illegal?",
      "Your name (optional)",
      "Your email (optional)",
    ]);
    expect(numberWord(9)).toBe("nine");
    expect(REPORT_WORDS.otherItemsHint).toBe("You can add up to nine more korbat links.");
    expect(OTHER_LINKS_MAX).toBe(NOTICE_LIMITS.maxTargets - 1);
  });

  test("the three failures the form words itself name the contact address, the limits and the wait", () => {
    const mail = "email your report to contact@korbat.local with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.";
    expect(REPORT_WORDS.humanCheckFailed(CONTACT)).toBe(`The check that you are not a bot failed. Try again, or ${mail}`);
    expect(REPORT_WORDS.rateLimited("20 minutes", CONTACT)).toBe(
      `korbat cannot take another report from this network or account right now: it takes at most 5 reports an hour and 20 a day without an account, and 10 an hour and 50 a day with one. Try again in about 20 minutes, or ${mail}`,
    );
    expect([NOTICE_LIMITS.signedOut, NOTICE_LIMITS.signedIn]).toEqual([{ perHour: 5, perDay: 20 }, { perHour: 10, perDay: 50 }]);
    expect(REPORT_WORDS.unavailable(CONTACT)).toBe(`korbat cannot take reports right now. Try again in a few minutes, or ${mail}`);
    expect(REPORT_WORDS.mailShowsAddress).toBe("An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.");
  });

  test("every category the illegal ground offers has a name, and the app's table words the codes the form can meet", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...TDB_FORM_CATEGORIES].sort());
    expect(new Set(Object.values(CATEGORY_LABELS)).size).toBe(TDB_FORM_CATEGORIES.length);
    expect(messageFor("notice_link_invalid")).toBe("That link does not name a post or a profile on korbat.");
    expect(messageFor("notice_link_offsite")).toBe("Only links to this korbat can be reported.");
    expect(messageFor("already_reported")).toBe("You already reported this; it is being looked at.");
    expect(messageFor("staff_cannot_report")).toBe("A staff account does not send reports. Open a finding in the staff console instead.");
    expect(messageFor("notice_not_found")).toBe("We could not find a report with this link.");
    expect(messageFor("human_check_failed")).toBe("We could not verify that you are human. Try again.");
  });
});

describe("what leads to the form", () => {
  test("the form's address names the post, the image of a post, or the profile it is opened on, and reads it back", () => {
    expect(reportHref()).toBe("/report");
    expect(reportHref({ post: id(1) })).toBe(`/report?post=${id(1)}`);
    expect(reportHref({ post: id(1), media: id(2) })).toBe(`/report?post=${id(1)}&media=${id(2)}`);
    expect(reportHref({ account: "ada" })).toBe("/report?account=ada");
    expect(givenTarget({ post: id(1) })).toEqual({ kind: "post", id: id(1) });
    expect(givenTarget({ post: id(1), media: id(2) })).toEqual({ kind: "post", id: id(1), mediaId: id(2) });
    expect(givenTarget({ account: "@Ada" })).toEqual({ kind: "account", handle: "ada" });
    // Anything the API would refuse names nothing: the form then asks for a link.
    for (const params of [{}, { post: "nope" }, { account: "a b" }, { media: id(2) }, { post: ["x"] }]) expect(givenTarget(params), JSON.stringify(params)).toBeNull();
  });

  const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
  const post = (n: number, extra: Partial<PostView> = {}): PostView => ({
    id: id(n),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    mentions: [],
    countsHidden: false,
    ...extra,
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "me" } } });

  test("a post that is not the reader's own has Report in its More menu, drawn open, signed in or out; the reader's own has none", () => {
    for (const state of [{ status: "signed-out" }, me(id(901))]) {
      session.state = state;
      const out = html(<PostMenuPanel post={post(1)} onDelete={() => undefined} onWhoSees={() => undefined} />);
      expect(hrefs(out)).toContain(`/report?post=${id(1)}`);
      expect(textOf(out)).toContain("Report");
    }
    session.state = me(id(900));
    const own = html(<PostMenuPanel post={post(1)} onDelete={() => undefined} onWhoSees={() => undefined} />) + html(<PostCard post={post(1)} />);
    expect(hrefs(own).filter((href) => href.startsWith("/report"))).toEqual([]);
    session.state = { status: "signed-out" };
  });

  test("the viewer reports an image on the post that holds it: opened from a post it names that post, and nothing for a hidden image or the reader's own post", () => {
    const noop = () => undefined;
    const media = [image(11), hidden(12)];
    const shown = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} postId={id(2)} />);
    expect(hrefs(shown)).toEqual([`/report?post=${id(2)}&media=${id(11)}`]);
    expect(textOf(shown)).toContain("Report this image");
    // A hidden image has nothing to report by; the post's own Report still names the post.
    expect(hrefs(html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} postId={id(2)} />))).toEqual([]);
    // Without a post to report on (the reader's own post), the viewer offers nothing.
    expect(hrefs(html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />))).toEqual([]);
  });

  test("the grid hands the viewer its post, and a quoted post's images belong to the quoted post", () => {
    const grid = read("components", "social", "MediaGrid.tsx");
    // 3d Task 1: the viewer is also told whether the reader wrote the post, for an image that fails to load.
    expect(grid).toContain("<MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />");
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain("<MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />");
    expect(card).toContain("<MediaGrid media={quote.media} compact postId={quote.id} />");
    // The quote's author line: its name to the profile, then its time to the quoted post; its squares open nothing themselves.
    const quoted = { ...post(2, { media: [image(21)] }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(hrefs(out)).toEqual(["/u/ada", `/post/${id(2)}`]);
    expect(html(<MediaGrid media={[image(1)]} postId={id(5)} />)).not.toContain("/report");
  });

  test("UI Task 5: a profile has Report in its More menu, drawn open, after Mute and Block, and signed out too; never on the reader's own", () => {
    const grace = { id: id(902), handle: "grace", displayName: "Grace", bio: "", verified: false, createdAt: "2026-10-01T10:00:00.000Z", counts: { posts: 1, followers: 0, following: 0 }, hasImported: false };
    session.state = { status: "signed-out" };
    expect(hrefs(html(<ProfileMenuPanel profile={grace} />))).toEqual(["/report?account=grace"]);
    session.state = me(id(901));
    const menu = textOf(html(<ProfileMenuPanel profile={{ ...grace, viewer: { following: false, followedBy: false, blocked: false, muted: false } }} />));
    expect(menu.indexOf("Block")).toBeGreaterThan(menu.indexOf("Mute"));
    expect(menu.indexOf("Report")).toBeGreaterThan(menu.indexOf("Block"));
    session.state = me(id(902));
    expect(html(<ProfileMenuPanel profile={grace} />)).toBe("");
  });

  test("the terms page ends with a Contact section built from the build's address, and a link to the form, which needs no account", () => {
    expect(CONTACT_EMAIL).toBe(CONTACT);
    const out = html(<Terms />);
    const text = textOf(out);
    expect(CONTACT_WORDS.body(CONTACT)).toBe(
      "Write to korbat at contact@korbat.local when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.",
    );
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text).toContain("Report something on korbat");
    expect(hrefs(out)).toContain("/report");
    // After the terms' own sections, of which it is no part, and before the link to the form.
    expect(TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
    const last = TERMS_SECTIONS.at(-1)!.title;
    expect(text.indexOf(last)).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf("Report something on korbat"));
    // The form is no settings screen: the settings layout would send a signed-out reader to sign in.
    expect(read("app", "report.tsx")).not.toContain("SettingsNav");
  });
});

describe("the form", () => {
  test("asks what is wrong with three choices of equal weight, each a radio of one group, none chosen at first", () => {
    const out = form();
    const text = textOf(out);
    expect(text).toContain("What is wrong with it?");
    const at = Object.values(REPORT_WORDS.grounds).map((label) => text.indexOf(label));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(withRole(out, "radiogroup")).toHaveLength(1);
    const radios = withRole(out, "radio");
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).toContain('aria-checked="false"');
    // Nothing of a ground shows before one is chosen, and nothing can be sent.
    for (const words of [REPORT_WORDS.whichRule, REPORT_WORDS.whyIllegal, REPORT_WORDS.which, REPORT_WORDS.anonymous]) expect(text).not.toContain(words);
    expect(text).toContain(REPORT_WORDS.missing.ground);
  });

  test("the rule ground lists the rules that can be reported, each with its title and one line, R2 replaced by the pointer to the third answer, and an optional note", () => {
    const out = form({ initial: { ground: "rule" } });
    const text = textOf(out);
    for (const ruleId of REPORT_RULE_IDS) {
      const rule = RULES.find((entry) => entry.id === ruleId)!;
      expect(text, ruleId).toContain(`${rule.id}: ${rule.title}`);
      expect(text, ruleId).toContain(ruleLine(rule));
    }
    const r2 = RULES.find((entry) => entry.id === "R2")!;
    expect(text).not.toContain(r2.title);
    expect(text).toContain(REPORT_WORDS.r2Instead);
    // In R2's place: after R1 and before R3.
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeGreaterThan(text.indexOf("R1: "));
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeLessThan(text.indexOf("R3: "));
    expect(fields(out)).toEqual([REPORT_WORDS.explanation]);
    expect(out.toLowerCase()).toContain(`maxlength="${NOTICE_LIMITS.explanationMax}"`);
    expect(ruleLine({ text: "One sentence. And another." })).toBe("One sentence.");
    expect(ruleLine({ text: "Only one" })).toBe("Only one");
  });

  test("the illegal ground asks for the category, not sure by default, points to the third answer directly below it, and asks why, the law, a rule and good faith", () => {
    const out = form({ initial: { ground: "illegal" } });
    const text = textOf(out);
    const categories = [REPORT_WORDS.categoryNotSure, ...TDB_FORM_CATEGORIES.map((category) => CATEGORY_LABELS[category])];
    for (const label of categories) expect(text, label).toContain(label);
    const checked = withRole(out, "radio").filter((tag) => tag.includes('aria-checked="true"'));
    // The ground itself, "I am not sure", and no rule beside the law.
    expect(checked).toHaveLength(3);
    // The pointer stands directly below the categories: after the last of them and before the next field.
    const pointer = text.indexOf(REPORT_WORDS.csamInstead);
    expect(pointer).toBeGreaterThan(Math.max(...categories.map((label) => text.indexOf(label))));
    expect(pointer).toBeLessThan(text.indexOf(REPORT_WORDS.citedLaw));
    expect(fields(out)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal]);
    // A rule it also breaks: every rule but R2, and none.
    expect(text).toContain(REPORT_WORDS.alsoRule);
    for (const ruleId of REPORT_RULE_IDS) expect(text).toContain(`${ruleId}: `);
    expect(text).not.toContain("R2: ");
    const box = withRole(out, "checkbox");
    expect(box).toHaveLength(1);
    expect(box[0]).toContain('aria-checked="false"');
    expect(text).toContain(REPORT_WORDS.bonaFide);
  });

  test("the anonymous path asks which it is, says that nobody is recorded, and asks for neither a name nor an email, signed in or out", () => {
    for (const signedIn of [true, false]) {
      const out = form({ signedIn, initial: { ground: "csam" } });
      const text = textOf(out);
      for (const label of Object.values(REPORT_WORDS.keywords)) expect(text).toContain(label);
      expect(text).toContain(REPORT_WORDS.anonymous);
      expect(fields(out)).toEqual([REPORT_WORDS.csamExplanation]);
      expect(text).not.toContain(REPORT_WORDS.contactHint);
      // Good faith may be stated, and is not asked for.
      expect(withRole(out, "checkbox")).toHaveLength(1);
      // The privacy line leaves out who sees the sender: this path records none.
      expect(text).toContain(REPORT_WORDS.privacy.use);
      expect(text).toContain(REPORT_WORDS.privacy.access);
      expect(text).not.toContain(REPORT_WORDS.privacy.sender);
    }
    // On the other grounds the line is whole.
    expect(textOf(form({ initial: { ground: "rule" } }))).toContain(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`);
  });

  test("on the anonymous path, for images, a report that names only a profile is asked for the post or the image, and never refused", () => {
    const images = (keyword: ReportDraft["keyword"], extra: Partial<ReportDraft> = {}) => draft({ ground: "csam", keyword, ...extra });
    expect(profileOnly(images("csam"), PROFILE)).toBe(true);
    expect(profileOnly(images("deepfake"), PROFILE)).toBe(true);
    // Not for grooming or other abuse, which are not about an image; not on another ground; not with a post beside it.
    expect(profileOnly(images("grooming"), PROFILE)).toBe(false);
    expect(profileOnly(images("abuse"), PROFILE)).toBe(false);
    expect(profileOnly(draft({ ground: "illegal", keyword: "csam" }), PROFILE)).toBe(false);
    expect(profileOnly(images("csam"), POST)).toBe(false);
    expect(profileOnly(images("csam", { others: ["http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    // A typed link to a profile is a profile too.
    expect(profileOnly(images("csam", { link: "http://localhost:8081/u/ada" }), null)).toBe(true);
    expect(profileOnly(images("csam", { link: "http://localhost:8081/post/" + id(2) }), null)).toBe(false);

    const out = form({ given: PROFILE, initial: { ground: "csam", keyword: "csam" } });
    expect(textOf(out)).toContain(REPORT_WORDS.profileOnly);
    // It can still be sent: the sentence asks, it does not refuse.
    const sent = noticeFrom(draft({ ground: "csam", keyword: "csam" }), PROFILE, { signedIn: true, turnstileToken: null });
    expect(sent).toEqual({ request: { ground: "csam", targets: [PROFILE], keyword: "csam" } });
    expect(textOf(form({ given: PROFILE, initial: { ground: "csam", keyword: "grooming" } }))).not.toContain(REPORT_WORDS.profileOnly);
    expect(textOf(form({ given: PROFILE, initial: { ground: "rule" } }))).not.toContain(REPORT_WORDS.profileOnly);
  });

  test("on the anonymous path a report names one profile at most: with a second the form says so before anything is sent", () => {
    const second = draft({ ground: "csam", keyword: "grooming", others: ["http://localhost:8081/u/bob"] });
    expect(profilesNamed(draftTargets(second, PROFILE))).toBe(2);
    expect(tooManyProfiles(second, PROFILE)).toBe(true);
    expect(noticeFrom(second, PROFILE, { signedIn: true, turnstileToken: null })).toEqual({ problem: REPORT_WORDS.oneProfile });
    expect(textOf(form({ given: PROFILE, initial: second }))).toContain(REPORT_WORDS.oneProfile);
    // The same profile named twice is one profile, a post beside it is no profile, and other grounds have no such limit.
    expect(tooManyProfiles(draft({ ground: "csam", keyword: "csam", others: ["http://localhost:8081/u/ADA", "http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    expect(tooManyProfiles({ ...second, ground: "rule" }, PROFILE)).toBe(false);
    expect(textOf(form({ given: PROFILE, initial: { ...second, ground: "rule", ruleId: "R6" } }))).not.toContain(REPORT_WORDS.oneProfile);
  });

  test("signed out, the illegal ground asks for an optional name and email, and every ground shows the human check with its sentence; signed in, none of it", () => {
    for (const ground of ["rule", "illegal", "csam"] as const) {
      const out = form({ signedIn: false, initial: { ground } });
      expect(out, ground).toContain('data-turnstile="widget"');
      expect(textOf(out), ground).toContain(REPORT_WORDS.turnstile);
      const signedIn = form({ signedIn: true, initial: { ground } });
      expect(signedIn, ground).not.toContain("data-turnstile");
      expect(textOf(signedIn), ground).not.toContain(REPORT_WORDS.turnstile);
      expect(fields(signedIn), ground).not.toContain(REPORT_WORDS.email);
    }
    const illegal = form({ signedIn: false, initial: { ground: "illegal" } });
    expect(fields(illegal)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]);
    expect(textOf(illegal)).toContain(REPORT_WORDS.contactHint);
    expect(fields(form({ signedIn: false, initial: { ground: "rule" } }))).toEqual([REPORT_WORDS.explanation]);
    // Before a ground is chosen the check is there already: it takes a moment to pass.
    expect(form({ signedIn: false })).toContain('data-turnstile="widget"');
  });

  test("opened without an item, the form starts with one required field for the link; opened on one, it shows what is reported; other items take up to nine more links", () => {
    const bare = form({ given: null });
    expect(fields(bare)[0]).toBe(REPORT_WORDS.link);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItems);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItemsHint);
    const onPost = form({ given: { kind: "post", id: id(1), mediaId: id(2) } });
    expect(fields(onPost)).not.toContain(REPORT_WORDS.link);
    expect(hrefs(onPost)).toContain(`/post/${id(1)}`);
    expect(hrefs(form({ given: PROFILE }))).toContain("/u/ada");
    // Each added link is a field of its own; at nine there is no way to add a tenth.
    const nine = form({ initial: { others: Array.from({ length: OTHER_LINKS_MAX }, () => "") } });
    expect(fields(nine).filter((label) => label.startsWith("Link "))).toHaveLength(9);
    expect(textOf(nine)).not.toContain(REPORT_WORDS.addLink);
    expect(textOf(form({ initial: { others: [""] } }))).toContain(REPORT_WORDS.addLink);
  });

  test("the screen opens the form on what its address names, signed in or out, and without an item when it names none", () => {
    session.state = { status: "signed-out" };
    route.params = { post: id(1), media: id(2) };
    const onImage = html(<Report />);
    expect(hrefs(onImage)).toContain(`/post/${id(1)}`);
    expect(onImage).toContain('data-turnstile="widget"');
    route.params = { account: "ada" };
    expect(hrefs(html(<Report />))).toContain("/u/ada");
    route.params = {};
    expect(fields(html(<Report />))[0]).toBe(REPORT_WORDS.link);
    session.state = { status: "signed-in", me: { user: { id: id(901), onboarded: true }, profile: { handle: "me" } } };
    expect(html(<Report />)).not.toContain("data-turnstile");
    session.state = { status: "signed-out" };
  });
});

describe("what the form sends", () => {
  const signedIn = { signedIn: true, turnstileToken: null };
  const signedOut = { signedIn: false, turnstileToken: "token" };

  test("says what is missing, one thing at a time, and sends nothing until it is all there", () => {
    const missing = REPORT_WORDS.missing;
    expect(noticeFrom(draft(), POST, signedIn)).toEqual({ problem: missing.ground });
    expect(noticeFrom(draft({ ground: "rule" }), null, signedIn)).toEqual({ problem: missing.link });
    expect(noticeFrom(draft({ ground: "rule", link: "korbat.example/post/1" }), null, signedIn)).toEqual({ problem: missing.linkInvalid });
    expect(noticeFrom(draft({ ground: "rule" }), POST, signedIn)).toEqual({ problem: missing.rule });
    expect(noticeFrom(draft({ ground: "illegal" }), POST, signedIn)).toEqual({ problem: missing.whyIllegal });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "It is a threat." }), POST, signedIn)).toEqual({ problem: missing.bonaFide });
    expect(noticeFrom(draft({ ground: "csam" }), POST, signedIn)).toEqual({ problem: missing.keyword });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3" }), POST, { signedIn: false, turnstileToken: null })).toEqual({ problem: missing.human });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "x", bonaFide: true, email: "not an address" }), POST, signedOut)).toEqual({ problem: missing.details });
  });

  test("a rule report, a notice of illegality and an anonymous report, each in the contracts' shape for its sender", () => {
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3", explanation: "  look at the second line  " }), POST, signedIn)).toEqual({
      request: { ground: "rule", ruleId: "R3", targets: [POST], explanation: "look at the second line" },
    });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R1", link: " http://localhost:8081/post/x ", others: ["", "http://localhost:8081/u/bob"] }), null, signedOut)).toEqual({
      request: { ground: "rule", ruleId: "R1", targets: [{ kind: "link", url: "http://localhost:8081/post/x" }, { kind: "link", url: "http://localhost:8081/u/bob" }], turnstileToken: "token" },
    });
    const illegal = draft({ ground: "illegal", explanation: "It is a threat.", bonaFide: true, citedLaw: "Section 241", ruleId: "R5", name: "Ada", email: "ada@korbat.local", category: "STATEMENT_CATEGORY_VIOLENCE" });
    expect(noticeFrom(illegal, PROFILE, signedOut)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5", name: "Ada", email: "ada@korbat.local", turnstileToken: "token" },
    });
    // Signed in, the contact is the account: a name or an address typed earlier is never sent.
    expect(noticeFrom(illegal, PROFILE, signedIn)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5" },
    });
    // The anonymous path sends neither, whatever the draft holds, and good faith only when it was stated.
    expect(noticeFrom(draft({ ground: "csam", keyword: "deepfake", name: "Ada", email: "ada@korbat.local", ruleId: "R1" }), POST, signedOut)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "deepfake", turnstileToken: "token" },
    });
    expect(noticeFrom(draft({ ground: "csam", keyword: "abuse", bonaFide: true, explanation: "seen today" }), POST, signedIn)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "abuse", explanation: "seen today", bonaFide: true },
    });
  });

  test("the form posts the request once, resets the human check after a failure, and shows the answer's screen", () => {
    const source = read("components", "moderation", "ReportForm.tsx");
    expect(source).toContain("const answer = await moderation.send(built.request);");
    expect(source).toContain("turnstile.current?.reset();");
    expect(source).toContain('setError(reportFailure(err, draft.ground === "csam"));');
    expect(read("lib", "moderation.ts")).toContain('send: (request: NoticeRequest) => api("/api/notices", { json: request, schema: NoticeResponse })');
  });
});

describe("after sending", () => {
  const TOKEN = "t".repeat(43);

  test("signed out, the screen shows the reference and the link to keep, its token in the fragment, with a Copy button", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn={false} origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(statusLink("http://localhost:8081", "N-ABCDEFGH23", TOKEN)).toBe(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).toContain(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    // The token is never part of a query, which a server would be sent and would log.
    expect(out).not.toContain(`?t=${TOKEN}`);
    expect(withRole(out, "button").some((tag) => tag.includes(REPORT_WORDS.copy)) || text.includes(REPORT_WORDS.copy)).toBe(true);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
  });

  test("signed in, a report on a rule or on the law is followed under Settings, Cases, Your reports, and no link is shown", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23" }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out)).toContain("/settings/cases?tab=reports");
    expect(text).not.toContain(REPORT_WORDS.keepLink);
    expect(text).not.toContain("/notice/");
  });

  test("signed in, an anonymous report shows the link and not the Settings sentence: korbat recorded no account for it", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(text).toContain(`/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out).filter((href) => href.startsWith("/settings"))).toEqual([]);
  });
});

describe("a send that fails", () => {
  const failed = (code: string, retryAfter?: number) => new ApiError(code === "rate_limited" ? 429 : 403, code, "the server's own words", retryAfter);

  test("the human check, the limits and an API that cannot take reports each get the form's own sentence, naming the build's contact address", () => {
    expect(reportFailure(failed("human_check_failed"), false)).toBe(REPORT_WORDS.humanCheckFailed(CONTACT));
    expect(reportFailure(failed("rate_limited", 1200), false)).toBe(REPORT_WORDS.rateLimited("20 minutes", CONTACT));
    expect(reportFailure(failed("service_unavailable"), false)).toBe(REPORT_WORDS.unavailable(CONTACT));
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) expect(reportFailure(failed(code, 60), false), code).toContain("contact@korbat.local");
  });

  test("the wait is worded in minutes under an hour and in hours otherwise", () => {
    expect([waitWords(1), waitWords(60), waitWords(61), waitWords(3599), waitWords(3600), waitWords(3601), waitWords(20 * 3600), waitWords(undefined)]).toEqual([
      "1 minute",
      "1 minute",
      "2 minutes",
      "60 minutes",
      "1 hour",
      "2 hours",
      "20 hours",
      "1 hour",
    ]);
  });

  test("on the anonymous path each is followed by what an email gives away", () => {
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) {
      const words = reportFailure(failed(code, 60), true);
      expect(words.endsWith(` ${REPORT_WORDS.mailShowsAddress}`), code).toBe(true);
      expect(reportFailure(failed(code, 60), false), code).not.toContain(REPORT_WORDS.mailShowsAddress);
    }
  });

  test("any other failure shows the server's message, as everywhere in the app", () => {
    expect(reportFailure(failed("already_reported"), false)).toBe("the server's own words");
    expect(reportFailure(failed("already_reported"), true)).toBe("the server's own words");
    expect(reportFailure(new Error("boom"), false)).toBe("Something went wrong. Try again.");
  });
});

describe("the build's contact address", () => {
  const repo = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

  test("the app reads it from the build, and both example files carry the development value", () => {
    expect(read("lib", "moderation.ts")).toContain('export const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "";');
    expect(repo("infra", ".env.example")).toMatch(/^WEB_CONTACT_EMAIL=contact@korbat\.local$/m);
    expect(repo("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat\.local$/m);
  });

  test("the compose service requires it, and the web image takes it as a build argument, refuses what is no address, refuses a placeholder domain in production, and passes it to the export", () => {
    expect(repo("infra", "compose.yml")).toContain("EXPO_PUBLIC_CONTACT_EMAIL: ${WEB_CONTACT_EMAIL:?set WEB_CONTACT_EMAIL in infra/.env}");
    const dockerfile = repo("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_CONTACT_EMAIL");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac');
    expect(dockerfile).toContain(
      'RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi',
    );
    expect(dockerfile).toContain(
      'RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" EXPO_PUBLIC_CONTACT_POINT="$EXPO_PUBLIC_CONTACT_POINT" EXPO_PUBLIC_HOME_STATE="$EXPO_PUBLIC_HOME_STATE" npx expo export --platform web',
    );
    // The refusals come before the export, and the production one after KORBAT_ENV is declared.
    expect(dockerfile.indexOf("ARG KORBAT_ENV")).toBeLessThan(dockerfile.indexOf("is a placeholder address"));
    expect(dockerfile.indexOf("is a placeholder address")).toBeLessThan(dockerfile.indexOf("npx expo export"));
  });
});

// UI Task 4: Report moved into the post card's More menu (UI design, decision 12); imported here, below, so the lines above keep their numbers.
import { PostMenuPanel } from "../src/components/social/PostMenu";
// UI Task 5: the profile's More menu, imported here for the same reason.
import { ProfileMenuPanel } from "../src/components/social/ProfileMenu";
