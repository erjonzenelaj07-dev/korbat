import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { IMPORT_RULES, ImportView, type ImportLineView } from "@korbat/contracts";
import { ImportStart } from "../src/app/settings/import/index";
import { ImportStateView } from "../src/app/settings/import/[id]";
import { PostList } from "../src/components/import/PostList";
import { IMPORT_WORDS, ruleWords } from "../src/lib/import-words";
import { formatBytes } from "../src/lib/imports";
import { utcDay } from "../src/lib/time";
import { TITLE_WORDS, UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * The import's screens (3b design, sections 10.1 to 10.5 and 10.9; Task 7): the start, each state's view of one import,
 * and the list of posts, server-rendered with made-up imports in every state and read as HTML, which is what a screen
 * reader gets: each view's level-2 heading, its words, its controls' names and states, its links. What a static render
 * cannot show (the poll, the upload, a press, the focus moving to the heading) is held by lib/imports.ts's own test and by
 * the source; the browser check walks it.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

const session = vi.hoisted(() => ({
  state: {
    status: "signed-in",
    me: { user: { id: "00000000-0000-4000-8000-000000000001", onboarded: true }, profile: { handle: "ada", displayName: "Ada Lovelace" }, standing: null },
  } as unknown,
}));
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, back: () => undefined, canGoBack: () => false },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/import",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
vi.mock("@/components/toast", () => ({ toast: { show: vi.fn() }, Toaster: () => null }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const tags = (markup: string): string[] => markup.match(/<[a-z0-9]+\b[^>]*>/g) ?? [];
const withRole = (markup: string, role: string): string[] => tags(markup).filter((tag) => tag.includes(`role="${role}"`));
function attr(tag: string, name: string): string | null {
  const at = tag.indexOf(` ${name}="`);
  if (at < 0) return null;
  const from = at + name.length + 3;
  return tag.slice(from, tag.indexOf('"', from)).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
/** The text of every button, read up to the first closing div, as the other screen tests read it. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
/** Every heading's level and words, in order. */
const headings = (markup: string): [number, string][] => [...markup.matchAll(/<h([1-6])\b[^>]*>(.*?)<\/h\1>/g)].map((match) => [Number(match[1]), textOf(match[2]!)]);

const ID = "00000000-0000-4000-8000-000000000801";
const W = IMPORT_WORDS;

/** An import of `status`, in the view's shape, with what each test changes. */
function view(status: ImportView["status"], extra: Partial<ImportView> = {}): ImportView {
  return ImportView.parse({
    id: ID,
    source: "mastodon",
    status,
    createdAt: "2026-10-27T10:00:00.000Z",
    endedAt: null,
    declaredBytes: 840_000_000,
    receivedBytes: 0,
    chunkBytes: IMPORT_RULES.chunkBytes,
    failure: null,
    stopReason: null,
    endedByStaff: null,
    staffDecisionId: null,
    scan: null,
    samples: [],
    choice: null,
    picks: [],
    progress: { imagesTotal: 0, imagesSettled: 0, postsTotal: 0, postsPublished: 0, postsRemoved: 0, postsLeft: 0, imagesLeftOut: {} },
    paused: false,
    refusalId: null,
    refusedAt: null,
    refusedWords: null,
    undoable: false,
    ...extra,
  });
}

/** A scan with replies, long posts and warnings, posts and images left out, cleaned characters and replaced links. */
const SCAN = {
  posts: 1240,
  images: 300,
  skipped: { repost: 120, not_public: 40, poll: 3 },
  imagesSkipped: { video: 12 },
  cleaned: 4,
  warnings: 6,
  sourceLinks: 7,
  protectedPosts: 0,
  readInPart: false,
  months: [
    { month: "2019-03", groups: [[0, 900, 250, 50], [1, 200, 30, 0], [4, 6, 0, 0]] as [number, number, number, number][] },
    { month: "2021-05", groups: [[0, 132, 20, 0], [2, 2, 0, 0]] as [number, number, number, number][] },
  ],
  first: "2019-03",
  last: "2021-05",
  fromRef: 0,
};
const READY = view("ready", { declaredBytes: 840_000_000, receivedBytes: 840_000_000, scan: SCAN, samples: [{ at: "2019-03-03", text: "Morning, @ada: the ferries run late https://example.org/a" }] });
const ME = { displayName: "Ada Lovelace", handle: "ada" };

const state = (v: ImportView, extra: Partial<Parameters<typeof ImportStateView>[0]> = {}) => html(<ImportStateView view={v} author={ME} onView={() => undefined} {...extra} />);

describe("every key of 10.9 is in the words module, and the title in TITLE_WORDS", () => {
  const KEYS = `title nav intro found unchecked webOnly whereFrom source.x source.mastodon source.bluesky source.x.desc source.mastodon.desc source.bluesky.desc
    how.title how.x how.mastodon how.bluesky reads.title reads.body never.title never.x never.mastodon never.bluesky transit trim.x trim.mastodon
    trim.bluesky choose chosen start tooLarge notArchive tarGz yours uploading uploaded resume wrongFile reading settings.ready now.ready now.failed
    now.done cancel cancel.ask cancel.keep found.posts found.images found.imagesOff samples seeAll list.leaveOut list.describe list.dimmed left.title
    skip.repost skip.reply skip.not_public skip.older_version skip.poll skip.adult_label skip.too_long_to_read skip.too_long skip.date_out_of_range
    skip.item_too_large skip.unreadable skip.empty skip.already_imported skip.over_post_cap skip.over_item_cap skip.new_account_cap skip.warning
    skip.protected skip.left_out image.video image.sensitive image.unsupported image.too_large image.missing_file image.bluesky_no_files image.images_off
    image.over_image_cap image.failed image.not_checked image.not_chosen image.no_description image.flagged cleaned sourceLinks warnings choose.title
    choose.all choose.range choose.from choose.to choose.replies choose.replies.desc choose.long choose.long.leave choose.long.shorten choose.warnings
    choose.protected choose.protected.desc choose.images choose.images.desc choose.images.noAlt choose.result rules rules.link statement statement.after
    publish publish.needStatement publish.nothing keptUntil started preparing publishing leave paused stop stop.ask stop.keep done done.view
    stopped.refused_image stopped.notice stopped.textOnly stopped.by_staff endedByStaff stopped.by_author stopped.time_ran_out remove remove.ask
    remove.confirm remove.keep removing removed cancelled expired again failure.not_this_source failure.not_an_archive failure.tar_gz
    failure.partial_archive failure.encrypted failure.too_many_entries failure.too_large_uncompressed failure.bad_entry_name failure.unreadable
    failure.nothing_to_import failure.scan_timed_out failure.interrupted active unavailable limit limit.network tooSoon label label.shortened label.short
    label.a11y reach provenance tab tab.empty explore`
    .split(/\s+/)
    .filter((key) => key !== "")
    .map((key) => `import.${key}`);

  test("the table's 167 keys, each a sentence, every closed reason worded, and title.import", () => {
    expect(KEYS).toHaveLength(167);
    for (const key of KEYS) expect(typeof (W as Record<string, string>)[key], key).toBe("string");
    expect(TITLE_WORDS["title.import"]).toBe("Import - Settings - korbat");
    // Word for word where a test elsewhere does not already hold them.
    expect(W["import.statement"]).toBe("These are my own posts, and they were public where I posted them.");
    expect(W["import.label.a11y"]).toBe("Imported from {source}, dated {date}. About imported posts");
    expect(W["import.choose.result"]).toBe("This publishes {posts} posts and {images} images to your Imported tab.");
  });
});

describe("the start (10.2)", () => {
  const LIST = [view("ready", { scan: SCAN }), view("undone", { id: "00000000-0000-4000-8000-000000000802", source: "x", createdAt: "2026-10-20T10:00:00.000Z" })];

  test("the two sentences of decision 28, then Where from? as a radio group of the sources the site has on, each with its line", () => {
    const out = html(<ImportStart sources={["x", "mastodon"]} imports={[]} />);
    const text = textOf(out);
    for (const key of ["import.intro", "import.found", "import.unchecked"] as const) expect(text).toContain(W[key]);
    expect(headings(out)).toContainEqual([2, W["import.whereFrom"]]);
    const group = withRole(out, "radiogroup");
    expect(group).toHaveLength(1);
    const labelled = attr(group[0]!, "aria-labelledby")!;
    expect(out).toMatch(new RegExp(`<h2[^>]*id="${labelled}"[^>]*>${W["import.whereFrom"]}`));
    const radios = withRole(out, "radio");
    expect(radios).toHaveLength(2);
    expect(text).toContain(W["import.source.x"]);
    expect(text).toContain(W["import.source.x.desc"]);
    expect(text).toContain(W["import.source.mastodon.desc"]);
    // Bluesky only when the owner turned it on.
    expect(text).not.toContain(W["import.source.bluesky"]);
    expect(textOf(html(<ImportStart sources={["x", "mastodon", "bluesky"]} imports={[]} />))).toContain(W["import.source.bluesky.desc"]);
    // Before a source is chosen, nothing about one source and no archive to choose.
    expect(text).not.toContain(W["import.how.title"]);
    expect(buttons(out)).not.toContain(W["import.choose"]);
  });

  test("a chosen source says how to get its archive in numbered steps, what korbat reads and never reads, the transit and what may be trimmed", () => {
    const out = html(<ImportStart sources={["x", "mastodon"]} imports={[]} initialSource="x" />);
    const text = textOf(out);
    expect(withRole(out, "radio").map((tag) => attr(tag, "aria-checked"))).toEqual(["true", "false"]);
    expect(headings(out).map(([, words]) => words)).toEqual(expect.arrayContaining([W["import.how.title"], W["import.reads.title"], W["import.never.title"]]));
    // The steps are a list, one item a step, each with its number drawn beside it.
    const items = [...out.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textOf(match[1]!));
    expect(items).toEqual(["1. On X, open Settings, Your account, Download an archive of your data.", "2. Confirm your password there, on X.", "3. X emails you when the archive is ready, which can take a few days.", "4. Download the .zip file."]);
    for (const key of ["import.reads.body", "import.never.x", "import.transit", "import.trim.x"] as const) expect(text).toContain(W[key]);
    expect(text).not.toContain(W["import.never.mastodon"]);
    expect(buttons(out)).toContain(W["import.choose"]);
  });

  test("Your imports lists the account's imports as links to their screens, by source, state in words and day; none, no list", () => {
    const out = html(<ImportStart sources={["x", "mastodon"]} imports={LIST} />);
    expect(headings(out)).toContainEqual([2, W["import.yours"]]);
    expect(hrefs(out)).toEqual(expect.arrayContaining([`/settings/import/${ID}`, "/settings/import/00000000-0000-4000-8000-000000000802"]));
    const text = textOf(out);
    expect(text).toContain(fill(W["import.row"], { state: W["import.state.ready"], date: "27 Oct 2026" }));
    expect(text).toContain(fill(W["import.row"], { state: W["import.state.undone"], date: "20 Oct 2026" }));
    expect(textOf(html(<ImportStart sources={["x"]} imports={[]} />))).not.toContain(W["import.yours"]);
  });

  test("with no source on, it says imports are paused and offers none", () => {
    const out = html(<ImportStart sources={[]} imports={[]} />);
    expect(textOf(out)).toContain(W["import.unavailable"]);
    expect(withRole(out, "radio")).toEqual([]);
  });
});

describe("one import, drawn by its state (10.3 to 10.5)", () => {
  test("each state's view starts with a level-2 heading the screen can move the focus to", () => {
    const shown: [ImportView, string][] = [
      [view("uploading"), W["import.state.uploading"]],
      [view("scanning"), W["import.state.scanning"]],
      [READY, W["import.found.title"]],
      [view("preparing"), W["import.state.preparing"]],
      [view("publishing"), W["import.state.publishing"]],
      [view("done"), W["import.state.done"]],
      [view("stopped", { stopReason: "by_author" }), W["import.state.stopped"]],
      [view("undoing"), W["import.state.undoing"]],
      [view("undone"), W["import.state.undone"]],
      [view("failed", { failure: "encrypted" }), W["import.state.failed"]],
      [view("cancelled"), W["import.state.cancelled"]],
      [view("expired"), W["import.state.expired"]],
    ];
    for (const [v, words] of shown) {
      const out = state(v);
      expect(headings(out)[0], v.status).toEqual([2, words]);
      const tag = tags(out).find((t) => t.startsWith("<h2"))!;
      expect(attr(tag, "tabindex"), v.status).toBe("-1");
    }
  });

  test("uploading: a progress bar with the four values and its value text, the sentence, and Cancel import", () => {
    const out = state(view("uploading", { receivedBytes: 120_000_000 }), { run: { receivedBytes: 120_000_000, error: null, running: true } });
    const bar = withRole(out, "progressbar")[0]!;
    expect(attr(bar, "aria-valuemin")).toBe("0");
    expect(attr(bar, "aria-valuemax")).toBe("100");
    expect(attr(bar, "aria-valuenow")).toBe("14");
    expect(attr(bar, "aria-valuetext")).toBe("120 MB of 840 MB");
    expect(attr(bar, "aria-label")).toBe(W["import.bar.upload"]);
    expect(textOf(out)).toContain(W["import.uploading"]);
    expect(buttons(out)).toContain(W["import.cancel"]);
  });

  test("uploading with no file in hand (a reload, another tab): where it stopped, and the file button to go on", () => {
    const out = state(view("uploading", { receivedBytes: 120_000_000 }));
    expect(textOf(out)).toContain(fill(W["import.resume"], { done: formatBytes(120_000_000), total: formatBytes(840_000_000) }));
    expect(buttons(out)).toEqual(expect.arrayContaining([W["import.choose"], W["import.cancel"]]));
  });

  test("reading: an indeterminate spinner named by the sentence, the sentence, and Cancel import", () => {
    const out = state(view("scanning"));
    expect(textOf(out)).toContain(W["import.reading"]);
    const spinner = withRole(out, "progressbar")[0]!;
    expect(attr(spinner, "aria-valuenow")).toBeNull();
    expect(buttons(out)).toContain(W["import.cancel"]);
  });

  test("failed: the failure's sentence as an alert and the link Start again", () => {
    const out = state(view("failed", { failure: "not_this_source", source: "x" }));
    expect(withRole(out, "alert").length).toBeGreaterThan(0);
    expect(textOf(out)).toContain(fill(W["import.failure.not_this_source"], { source: "X" }));
    expect(hrefs(out)).toContain("/settings/import");
    expect(textOf(out)).toContain(W["import.startAgain"]);
  });

  test("preparing and publishing: a bar per phase in its words, You can leave this page, and Stop import; paused, the notice", () => {
    const preparing = state(view("preparing", { progress: { imagesTotal: 1200, imagesSettled: 340, postsTotal: 1240, postsPublished: 0, postsRemoved: 0, postsLeft: 0, imagesLeftOut: {} } }));
    expect(textOf(preparing)).toContain(fill(W["import.preparing"], { done: "340", total: "1,200" }));
    expect(textOf(preparing)).toContain(W["import.leave"]);
    expect(buttons(preparing)).toContain(W["import.stop"]);
    const bar = withRole(preparing, "progressbar")[0]!;
    expect(attr(bar, "aria-valuetext")).toBe(fill(W["import.preparing"], { done: "340", total: "1,200" }));
    const publishing = state(view("publishing", { paused: true, progress: { imagesTotal: 0, imagesSettled: 0, postsTotal: 1240, postsPublished: 800, postsRemoved: 0, postsLeft: 440, imagesLeftOut: {} } }));
    expect(textOf(publishing)).toContain(fill(W["import.publishing"], { done: "800", total: "1,240" }));
    expect(textOf(publishing)).toContain(W["import.paused"]);
  });

  test("done: the success notice with what was left out, the link to the Imported tab, and Remove imported posts", () => {
    const out = state(view("done", { undoable: true, progress: { imagesTotal: 10, imagesSettled: 10, postsTotal: 1240, postsPublished: 1240, postsRemoved: 0, postsLeft: 0, imagesLeftOut: { not_checked: 2 } } }));
    const text = textOf(out);
    expect(text).toContain(fill(W["import.done"], { n: "1,240" }));
    expect(text).toContain(W["import.image.not_checked"]);
    expect(hrefs(out)).toContain("/u/ada?tab=imported");
    expect(text).toContain(W["import.done.view"]);
    expect(buttons(out)).toContain(W["import.remove"]);
  });

  test("stopped by a refused image: the post's day and first words, the notice and the text only; nothing published, nothing to remove", () => {
    const refusal = "00000000-0000-4000-8000-000000000901";
    const out = state(view("stopped", { stopReason: "refused_image", refusalId: refusal, refusedAt: "2019-03-03", refusedWords: "Morning at the harbour" }));
    expect(textOf(out)).toContain(fill(W["import.stopped.refused_image"], { date: utcDay("2019-03-03"), words: "Morning at the harbour" }));
    expect(hrefs(out)).toEqual(expect.arrayContaining([`/settings/cases/uploads/${refusal}`, "/settings/import?source=mastodon"]));
    expect(textOf(out)).toContain(W["import.stopped.notice"]);
    expect(textOf(out)).toContain(W["import.stopped.textOnly"]);
    expect(buttons(out)).not.toContain(W["import.remove"]);
  });

  test("stopped by the author or by time: the published count and Remove imported posts; by staff: the rule, and no Remove", () => {
    const progress = { imagesTotal: 0, imagesSettled: 0, postsTotal: 1240, postsPublished: 300, postsRemoved: 0, postsLeft: 0, imagesLeftOut: {} };
    const author = state(view("stopped", { stopReason: "by_author", undoable: true, progress }));
    expect(textOf(author)).toContain(fill(W["import.stopped.by_author"], { n: "300" }));
    expect(buttons(author)).toContain(W["import.remove"]);
    expect(textOf(state(view("stopped", { stopReason: "time_ran_out", undoable: true, progress })))).toContain(fill(W["import.stopped.time_ran_out"], { n: "300" }));
    const staff = state(view("stopped", { stopReason: "by_staff", endedByStaff: "R6", staffDecisionId: "00000000-0000-4000-8000-000000000902", undoable: true, progress }));
    expect(textOf(staff)).toContain(fill(W["import.stopped.by_staff"], { rule: ruleWords("R6"), n: "300" }));
    expect(buttons(staff)).not.toContain(W["import.remove"]);
  });

  test("removing: its bar; ended by staff, the undoing and undone screens say so with the link to the decision", () => {
    const progress = { imagesTotal: 0, imagesSettled: 0, postsTotal: 1240, postsPublished: 1240, postsRemoved: 400, postsLeft: 0, imagesLeftOut: {} };
    const undoing = state(view("undoing", { progress }));
    expect(textOf(undoing)).toContain(fill(W["import.removing"], { done: "400", total: "1,240" }));
    const decision = "00000000-0000-4000-8000-000000000902";
    for (const status of ["undoing", "undone"] as const) {
      const out = state(view(status, { progress, endedByStaff: "R6", staffDecisionId: decision }));
      expect(textOf(out), status).toContain(fill(W["import.endedByStaff"], { rule: ruleWords("R6") }));
      expect(hrefs(out), status).toContain(`/settings/cases/${decision}`);
    }
  });

  test("removed, cancelled and expired: one sentence each and the link Start a new import", () => {
    for (const [status, key] of [
      ["undone", "import.removed"],
      ["cancelled", "import.cancelled"],
      ["expired", "import.expired"],
    ] as const) {
      const out = state(view(status));
      expect(textOf(out), status).toContain(W[key]);
      expect(textOf(out), status).toContain(W["import.again"]);
      expect(hrefs(out), status).toContain("/settings/import");
    }
  });
});

describe("the preview and the choice (10.4)", () => {
  test("four Sections in one column, each a level-2 heading: What we found, What will be left out, Choose, Confirm", () => {
    expect(headings(state(READY)).filter(([level]) => level === 2).map(([, words]) => words)).toEqual([W["import.found.title"], W["import.left.title"], W["import.choose.title"], W["import.confirm.title"]]);
  });

  test("what was found, with the newest posts as static cards: the label, no link and no control, @ada no link", () => {
    const out = state(READY);
    const text = textOf(out);
    expect(text).toContain(fill(W["import.found.posts"], { n: "1,240", first: "March 2019", last: "May 2021" }));
    expect(text).toContain(fill(W["import.found.images"], { n: "312", kept: "300" }));
    expect(text).toContain(W["import.samples"]);
    expect(text).toContain("Imported from Mastodon, dated 3 Mar 2019");
    expect(text).toContain("Morning, @ada: the ferries run late");
    const samples = /data-samples[^>]*>([\s\S]*?)data-samples-end/.exec(out)?.[1] ?? "";
    expect(samples).not.toBe("");
    expect(hrefs(samples)).toEqual([]);
    expect(buttons(samples)).toEqual([]);
    expect(buttons(out)).toContain(W["import.seeAll"]);
  });

  test("what will be left out: one row a non-zero reason with its count, posts first, then images; the cleaned and the links sentences", () => {
    const text = textOf(state(READY));
    for (const key of ["import.skip.repost", "import.skip.not_public", "import.skip.poll", "import.skip.reply", "import.skip.warning", "import.skip.too_long", "import.image.video"] as const) expect(text, key).toContain(W[key]);
    expect(text).not.toContain(W["import.skip.empty"]);
    expect(text.indexOf(W["import.skip.repost"])).toBeLessThan(text.indexOf(W["import.image.video"]));
    expect(text).toContain(fill(W["import.cleaned"], { n: "4" }));
    expect(text).toContain(fill(W["import.sourceLinks"], { source: "Mastodon" }));
  });

  test("the choice: Everything or a range, replies, long posts, the warnings' switch when there are some, and the live result", () => {
    const out = state(READY);
    const text = textOf(out);
    const radios = withRole(out, "radio");
    expect(radios.map((tag) => attr(tag, "aria-checked"))).toEqual(["true", "false", "true", "false"]);
    for (const key of ["import.choose.all", "import.choose.range", "import.choose.long.leave", "import.choose.long.shorten", "import.choose.replies.desc", "import.warnings"] as const) expect(text, key).toContain(fill(W[key], { n: "6" }));
    const switches = (out.match(/<input[^>]*role="switch"[^>]*>/g) ?? []).map((tag) => attr(tag, "aria-label"));
    // This site imports images: Bring images is offered, off; no protected period in the archive, so no switch for one.
    expect(switches).toEqual([W["import.choose.replies"], W["import.choose.warnings"], W["import.choose.images"]]);
    expect((out.match(/<input[^>]*role="switch"[^>]*>/g) ?? []).every((tag) => !tag.includes("checked="))).toBe(true);
    expect(text).not.toContain(W["import.choose.protected"]);
    // Everything, without replies, warnings or long posts, and no images: 900 and 132 posts.
    expect(text).toContain(fill(W["import.choose.result"], { posts: "1,032", images: "0" }));
    // The result is said politely, once the person stops changing the choice.
    expect(tags(out).some((tag) => tag.includes('role="status"') && tag.includes('aria-live="polite"'))).toBe(true);
  });

  test("Confirm: the rules with their link, decision 28's sentences again, the statement as a checkbox, and Publish, focusable while it cannot be used", () => {
    const out = state(READY);
    const text = textOf(out);
    expect(text).toContain(W["import.rules"]);
    expect(hrefs(out)).toContain("/rules");
    expect(text.split(W["import.found"]).length - 1).toBe(1);
    expect(text).toContain(W["import.unchecked"]);
    const box = withRole(out, "checkbox");
    expect(box).toHaveLength(1);
    expect(attr(box[0]!, "aria-checked")).toBe("false");
    expect(text).toContain(W["import.statement"]);
    expect(text).toContain(W["import.statement.after"]);
    // Publish stays a tab stop with its reason tied to it; its aria-disabled is written on the element once it is drawn,
    // since react-native-web turns any disabled state of a button into the native attribute, which leaves the tab order.
    const publish = tags(out).find((tag) => tag.includes('role="button"') && tag.includes("aria-describedby"))!;
    expect(attr(publish, "disabled")).toBeNull();
    expect(attr(publish, "tabindex")).toBe("0");
    expect(read("components", "import", "Preview.tsx")).toContain('node?.setAttribute?.("aria-disabled", "true")');
    const reason = attr(publish, "aria-describedby")!;
    expect(out).toMatch(new RegExp(`id="${reason}"[^>]*>${W["import.publish.needStatement"]}<`));
    expect(buttons(out)).toContain(fill(W["import.publish"], { n: "1,032" }));
    expect(buttons(out)).toContain(W["import.cancel"]);
    // Kept until the import's day plus 24 hours at the latest (ImportView carries no scan time: see the amendment).
    expect(text).toContain(fill(W["import.keptUntil"], { time: "28 Oct 2026, 10:00" }).slice(0, 30));
  });

  test("with images brought on this site, Bring images and its line, and the descriptions still to write once it is on", () => {
    const text = textOf(state(READY));
    expect(text).toContain(W["import.choose.images"]);
    expect(text).toContain(W["import.choose.images.desc"]);
    expect(text).not.toContain(W["import.found.imagesOff"]);
    const brought = textOf(state(view("ready", { scan: SCAN, choice: { from: null, to: null, replies: false, warnings: false, protected: false, images: true, long: "leave" } })));
    // 50 of March's posts without marks lack a description; the rest of the chosen images have one.
    expect(brought).toContain(fill(W["import.choose.images.noAlt"], { n: "50" }));
    expect(brought).toContain(fill(W["import.choose.result"], { posts: "1,032", images: "220" }));
  });

  test("images off on this site: the sentence says so and no switch offers them", () => {
    const scan = { ...SCAN, imagesSkipped: { images_off: 300 }, images: 0 };
    const text = textOf(state(view("ready", { scan })));
    expect(text).toContain(W["import.found.imagesOff"]);
    expect(text).not.toContain(W["import.choose.images"]);
  });
});

describe("the list of posts (10.4)", () => {
  const LINES: ImportLineView[] = [
    { ref: 4, at: "2019-03-03", kind: "post", marks: 0, text: "Morning, @ada.", media: [{ file: "4-0.jpg", alt: null }], leftOut: false, alts: [] },
    { ref: 5, at: "2019-03-04", kind: "reply", marks: 1, text: "A reply to someone.", media: [], leftOut: false, alts: [] },
    { ref: 6, at: "2019-03-05", kind: "post", marks: 0, text: "Left out by hand.", media: [], leftOut: true, alts: [] },
  ];
  const choice = { from: null, to: null, replies: false, warnings: false, protected: false, images: true, long: "leave" as const };

  test("each line a static card with its Leave this one out checkbox; a line the choice leaves out is dimmed with its reason", () => {
    const out = html(<PostList importId={ID} source="mastodon" lines={LINES} pages={1} page={0} choice={choice} images author={ME} onPick={() => undefined} onPage={() => undefined} />);
    const boxes = withRole(out, "checkbox");
    expect(boxes.map((tag) => attr(tag, "aria-checked"))).toEqual(["false", "false", "true"]);
    expect(textOf(out)).toContain(W["import.list.leaveOut"]);
    expect(textOf(out)).toContain(fill(W["import.list.dimmed"], { reason: W["import.dimmed.reply"] }));
    expect(hrefs(out)).toEqual([]);
  });

  test("while images are brought, each image is shown, and one without its source's description has a field to describe it", () => {
    const out = html(<PostList importId={ID} source="mastodon" lines={LINES} pages={1} page={0} choice={choice} images author={ME} onPick={() => undefined} onPage={() => undefined} />);
    expect(out).toContain(`data-uri="/api/imports/${ID}/media/4-0.jpg"`);
    expect(out).toMatch(new RegExp(`<(?:input|textarea)[^>]*aria-label="${W["import.list.describe"].replace(/[()]/g, ".")}"`));
    const off = html(<PostList importId={ID} source="mastodon" lines={LINES} pages={1} page={0} choice={{ ...choice, images: false }} images={false} author={ME} onPick={() => undefined} onPage={() => undefined} />);
    expect(off).not.toContain("data-uri=");
  });
});

describe("what the source holds that a static render cannot show", () => {
  test("the screens keep nothing on the device: no storage in the import's files", () => {
    const files = [
      read("lib", "imports.ts"),
      read("app", "settings", "import", "index.tsx"),
      read("app", "settings", "import", "[id].tsx"),
      ...readdirSync(path.join(SRC, "components", "import")).map((file) => read("components", "import", file)),
    ];
    for (const source of files) expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  test("the import's screen polls every 3 s while the page is visible, announces a change politely and moves the focus to the heading only when the focused element is gone", () => {
    const screen = read("app", "settings", "import", "[id].tsx");
    const lib = read("lib", "imports.ts");
    expect(lib).toContain("export const IMPORT_POLL_MS = 3_000;");
    expect(screen).toContain("IMPORT_POLL_MS");
    expect(screen).toContain("visibilityState");
    expect(screen).toContain("announcement(");
    expect(screen).toContain('role="status"');
    expect(screen).toMatch(/isConnected/);
    expect(screen).toContain('<SettingsNav current="import" />');
    expect(read("app", "settings", "import", "index.tsx")).toContain('<SettingsNav current="import" />');
    for (const file of ["index.tsx", "[id].tsx"]) expect(read("app", "settings", "import", file), file).toContain('usePageTitle("title.import")');
  });

  test("the uploader hashes each chunk with crypto.subtle.digest and sends it with Import-Offset and Import-Chunk-Sha256", () => {
    const lib = read("lib", "imports.ts");
    expect(lib).toContain('crypto.subtle.digest("SHA-256"');
    expect(lib).toContain('"import-offset"');
    expect(lib).toContain('"import-chunk-sha256"');
  });

  test("the result's toast says Import started, with no action", () => {
    expect(read("components", "import", "Preview.tsx")).toContain('toast.show({ message: IMPORT_WORDS["import.started"] })');
  });

  test("the Remove sheet asks once with its two answers, the warning haptic on it and success at the end", () => {
    const result = read("components", "import", "ImportResult.tsx");
    expect(result).toContain('IMPORT_WORDS["import.remove.ask"]');
    expect(result).toContain('IMPORT_WORDS["import.remove.confirm"]');
    expect(result).toContain('IMPORT_WORDS["import.remove.keep"]');
    expect(result).toContain('haptic("warning")');
    expect(read("app", "settings", "import", "[id].tsx")).toContain('haptic("success")');
  });

  test("the web is the only platform: elsewhere the start says import.webOnly", () => {
    expect(read("app", "settings", "import", "index.tsx")).toContain('IMPORT_WORDS["import.webOnly"]');
    expect(UI_WORDS["error.retry"]).toBe("Try again");
  });
});
