import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildConsole } from "../../build.mjs";
import { CONSOLE_CSP } from "../../site-headers.mjs";
import { FINDING_WORDS, messageFor, STAFF_MESSAGES } from "../../src/messages";
import { ART_18_BANNER, IMAGES_NOT_SHOWN, SUSPECT_BANNER } from "../../src/screens/Case";
import { UNAVAILABLE_TEXT } from "../../src/screens/Unavailable";
import { SIGN_IN_WINDOW_MS } from "../../src/signins";
import { clockTime } from "../../src/ui";
import { consoleSiteHeadersFromCaddyfile } from "../caddyfile";
import { CASE_ACCOUNT, CASE_FROZEN, CASE_POST, CASE_QUOTED, IMAGE_ONE, IMAGE_TWO, ITEM_REPORTER, LONGEST_EXPLANATION, LONGEST_NOTE, LOOKALIKE, POST_ID } from "../case-fixtures";
import { HOSTILE } from "../fixtures";
import {
  createFixtureApi,
  CURRENT_BROWSER,
  DEAD_LINK,
  EXISTING_KEY_NAMES,
  FORGED_REASON,
  HOSTILE_TEXTS,
  IMAGE_PATH,
  OTHER_BROWSERS,
  PERSON_HANDLE,
  REVEALED_HANDLE,
  TYPED_KEY_NAME,
  TYPED_NOTE,
  type FixtureApi,
} from "./fixture-api";
import { startConsoleSite, type ConsoleSiteServer } from "./server";
import { inspect, userTexts, watch, type Watcher } from "./watch";

/**
 * The console's browser check (3a design, section 12). It builds the console, serves the build with the routes and headers
 * of Caddy's console site read from infra/caddy/Caddyfile, answers /api/staff/* from fixtures whose user-written strings
 * are hostile (markup, javascript: URLs, a direction override, the longest names allowed), and drives Chromium through
 * playwright-core with a CDP virtual authenticator over every screen: the console switched off, enrolment (a synced
 * passkey refused, then a device-bound key that verifies its user, whose success page signs in with that key), home, a
 * session revoked with the key, step-up options that bind another action refused before the key is asked, the audit log,
 * an address the console does not have, the ended session, a second key enrolled while signed in, whose success page
 * asks that key and no other, sign-out, and sign-in options that carry a step-up challenge refused before the key is
 * asked. For moderation cases (3c design, section 8) it walks the home screen's overview, the queue with a finding, a
 * case with its images shown on request, an image the API refuses, a case whose images cannot be opened, an account's
 * case with a fresh snapshot, a reveal, and a save that the API answers with the digest of another text. Each step fails
 * on any policy report through any channel console-lab.md names, any page error and any dialog. It needs no database and
 * writes nothing but a temporary build.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome instead,
 * as CI does with the runner's.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";

let out = "";
let site: ConsoleSiteServer | undefined;
let browser: Browser | undefined;
let context: BrowserContext;
let page: Page;
let watcher: Watcher;
let fixtures: FixtureApi;
let origin = "";
/** The device-bound authenticator that holds the first staff key enrolled. */
let staffAuthenticator = "";
/** Every device-bound authenticator the walk enrolled a staff key on. */
const staffAuthenticators: string[] = [];
/** Every person-written string the walk has found shown as text. */
const seen = new Set<string>();
/** The headers each static file was served with, by path. */
const served = new Map<string, Record<string, string>>();

/** The text of every element holding a person-written string or an action, kept in `seen`. */
async function texts(): Promise<string[]> {
  const found = await userTexts(page);
  for (const text of found) seen.add(text);
  return found;
}

/** Waits for a locator to show, failing with what it looked for. */
async function shown(locator: Locator, timeout = 15_000): Promise<void> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(`not shown within ${timeout} ms: ${locator.toString()}`);
  }
}

/** A virtual CTAP2 authenticator that verifies its user: a security key on USB, or a platform one whose passkeys sync. */
async function addAuthenticator(kind: "device-bound security key" | "synced platform passkey"): Promise<string> {
  const synced = kind === "synced platform passkey";
  const { authenticatorId } = await watcher.cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: synced ? "internal" : "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      // The flags a password manager's passkey reports, and a security key never does.
      defaultBackupEligibility: synced,
      defaultBackupState: synced,
    },
  });
  return authenticatorId;
}

/** How many times an authenticator's keys have signed: the virtual authenticator counts every signature. */
async function signaturesOf(authenticatorId: string): Promise<number> {
  const { credentials } = await watcher.cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials.reduce((sum, credential) => sum + credential.signCount, 0);
}

/** How many times every staff key of the walk has signed. */
async function signatures(): Promise<number> {
  let sum = 0;
  for (const id of staffAuthenticators) sum += await signaturesOf(id);
  return sum;
}

/**
 * Waits until an expression is true in the page. The expression is plain text, sent as page.evaluate sends it: nothing
 * of the test runner's is put into the page, and nothing in the page evaluates it under the page's policy.
 */
async function until(expression: string, what: string): Promise<void> {
  for (let tries = 0; tries < 150; tries++) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`not within 15 s: ${what}`);
}

/** The one image of the page: whether it is there, loaded as a real image of 2 by 2 pixels, from this address, drawn with this class. */
const imageIs = (src: string, className: string) =>
  `(() => { const all = document.querySelectorAll("img"); const i = all[0]; return all.length === 1 && i.getAttribute("src") === ${JSON.stringify(src)} && i.className === ${JSON.stringify(className)} && i.complete && i.naturalWidth === 2 && i.naturalHeight === 2; })()`;

/** The end of every step: no report, error or dialog on any channel, nothing in the page the console never writes, and no request the fixtures refused for the page's fault. */
async function clean(): Promise<void> {
  expect(watcher.take()).toEqual([]);
  expect(await inspect(page)).toEqual([]);
  expect(fixtures.state.problems).toEqual([]);
}

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "korbat-admin-browser-"));
  await buildConsole({ outdir: out });
  fixtures = createFixtureApi();
  site = await startConsoleSite({ dist: out, api: fixtures.handle });
  origin = site.origin;
  fixtures.state.origin = origin;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
  context = await browser.newContext({ timezoneId: "UTC", locale: "en-GB", viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  watcher = await watch(context, page, origin);
  await watcher.cdp.send("WebAuthn.enable", { enableUI: false });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) served.set(url.pathname, response.headers());
  });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("the staff console in Chromium, under the console site's policy", () => {
  test("the page, its script and its stylesheet come with the Caddyfile's console headers, the policy of section 3 among them", async () => {
    fixtures.state.off = true;
    await page.goto(`${origin}/`);
    await shown(page.getByText(UNAVAILABLE_TEXT));
    const headersFor = consoleSiteHeadersFromCaddyfile();
    expect(headersFor("/", false)["Content-Security-Policy"]).toBe(CONSOLE_CSP);
    const assets = [...served.keys()].filter((p) => p.startsWith("/assets/"));
    expect(assets.map((p) => path.extname(p)).sort()).toEqual([".css", ".js"]);
    // The page is index.html answered for "/", which names no file; the script and the stylesheet are files of the build.
    for (const p of ["/", ...assets]) {
      const sent = served.get(p)!;
      for (const [name, value] of Object.entries(headersFor(p, p !== "/"))) expect(sent[name.toLowerCase()], `${p} ${name}`).toBe(value);
    }
    expect(served.get("/")!["cache-control"]).toBe("no-store, no-transform");
    for (const p of assets) expect(served.get(p)!["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("a console that is off shows only that it is not available at this address", async () => {
    expect(await page.locator("#root").innerText()).toBe(UNAVAILABLE_TEXT);
    expect(await page.getByRole("button").count()).toBe(0);
    fixtures.state.off = false;
    await clean();
  });

  test("enrolment: a synced passkey is refused and explained while the link still works, then a device-bound key registers", async () => {
    const synced = await addAuthenticator("synced platform passkey");
    await page.goto(`${origin}/enroll/${fixtures.state.enrolmentToken}`);
    await shown(page.getByRole("heading", { name: "Register a staff key" }));
    await page.getByLabel("Name of this key").fill(TYPED_KEY_NAME);
    await page.getByRole("button", { name: "Use Windows Hello on this computer" }).click();
    await shown(page.getByText(STAFF_MESSAGES.staff_key_not_device_bound));
    await shown(page.getByText("This link still works", { exact: false }));
    // The console's relying party ID is not the app's here, so the page asked the browser to drop the refused passkey, or
    // says to delete it by hand where the browser could not.
    await shown(page.getByText(/asked to remove the refused passkey|Delete the refused entry/));
    expect(fixtures.state.enrolmentUsed).toBe(false);
    await clean();

    await watcher.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: synced });
    staffAuthenticator = await addAuthenticator("device-bound security key");
    staffAuthenticators.push(staffAuthenticator);
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    expect(await texts()).toContain(TYPED_KEY_NAME);
    expect(fixtures.state.enrolmentUsed).toBe(true);
    await clean();
  });

  test("the success page signs in with the new key, which opens the console, and home follows", async () => {
    // The registration counted as one use of the key; the sign-in is the next.
    const before = await signatures();
    await page.getByRole("button", { name: "Sign in with this key" }).click();
    await shown(page.getByText("opened the console", { exact: false }));
    expect(await signatures()).toBe(before + 1);
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    expect(page.url()).toBe(`${origin}/`);
    await clean();
  });

  test("home: who is signed in, the sign-ins of 7 days, the sessions and the keys, every written string as text", async () => {
    const current = [...fixtures.state.sessions.values()].find((s) => s.browser === CURRENT_BROWSER)!;
    await shown(page.getByText(`Signed in until ${clockTime(new Date(current.createdAt + 12 * 60 * 60_000).toISOString())}.`));
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    // Every sign-in of the last 7 days, read page by page, and none older.
    const since = Date.now() - SIGN_IN_WINDOW_MS;
    const recent = fixtures.state.audit.filter((row) => row.action === "staff_sign_in" && Date.parse(row.createdAt) >= since);
    expect(recent.length).toBeGreaterThan(50);
    expect(await page.locator("ul.signins li").count()).toBe(recent.length);
    expect(fixtures.state.requests.filter((r) => r.path.startsWith("/api/staff/audit?action=staff_sign_in")).length).toBe(2);
    // The sessions: this one and the two others; the keys: the two the person held and the new one.
    expect(await page.locator("table tbody tr").count()).toBe(3);
    expect(await page.locator("ul.keys li").count()).toBe(EXISTING_KEY_NAMES.length + 1);
    const shownTexts = await texts();
    for (const text of [PERSON_HANDLE, CURRENT_BROWSER, ...OTHER_BROWSERS, ...EXISTING_KEY_NAMES, TYPED_KEY_NAME]) expect(shownTexts, text).toContain(text);
    await clean();
  });

  test("a session revoked with the key: the step-up's options check out, the key signs once, and the session goes", async () => {
    const before = await signatures();
    const target = [...fixtures.state.sessions.values()].find((s) => s.browser === OTHER_BROWSERS[0])!;
    const row = page.locator("table tbody tr").filter({ hasText: OTHER_BROWSERS[0] });
    await row.getByRole("button", { name: "Sign out that session" }).click();
    await shown(page.getByText("That session is signed out."));
    await row.waitFor({ state: "detached" });
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.revoked).toEqual([target.handle]);
    expect(await page.locator("table tbody tr").count()).toBe(2);
    await clean();
  });

  test("step-up options that bind another action are refused before the key is asked", async () => {
    const before = await signatures();
    const optionsBefore = fixtures.state.stepUpOptionsServed;
    const deletes = fixtures.state.requests.filter((r) => r.method === "DELETE").length;
    fixtures.state.mismatchNextStepUp = true;
    const row = page.locator("table tbody tr").filter({ hasText: OTHER_BROWSERS[1] });
    await row.getByRole("button", { name: "Sign out that session" }).click();
    await shown(page.getByText(messageFor("step_up_mismatch")));
    expect(fixtures.state.stepUpOptionsServed).toBe(optionsBefore + 1);
    // The key signed nothing, no revocation was sent, and the session is still listed.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.method === "DELETE").length).toBe(deletes);
    expect(await row.count()).toBe(1);
    await clean();
  });

  test("the audit log: the newest page, Load older, Go to place and back to the newest", async () => {
    await page.getByRole("link", { name: "Audit log" }).click();
    await page.waitForURL(`${origin}/audit`);
    const rows = page.locator("table.audit tbody tr");
    await shown(rows);
    const newest = fixtures.state.audit[0]!.seq;
    expect(await rows.count()).toBe(50);
    expect(await rows.first().locator("td").first().textContent()).toBe(String(newest));
    await page.getByRole("button", { name: "Load older" }).click();
    await rows.nth(50).waitFor();
    expect(await rows.count()).toBe(100);
    await page.getByLabel("Place").fill("75");
    await page.getByRole("button", { name: "Go to place" }).click();
    await shown(page.getByText("From place 75, newest first."));
    expect(await rows.first().locator("td").first().textContent()).toBe("75");
    const shownTexts = await texts();
    for (const row of fixtures.state.audit.filter((r) => r.seq <= 75 && r.seq > 25)) {
      for (const text of [row.actorHandle, row.action, row.targetType, row.targetId, row.hash]) if (text !== null) expect(shownTexts, text).toContain(text);
    }
    await page.getByRole("button", { name: "Newest" }).click();
    await page.getByText("From place 75, newest first.").waitFor({ state: "detached" });
    expect(await rows.first().locator("td").first().textContent()).toBe(String(newest));
    await clean();
  });

  test("home shows the cases' overview: the lanes, the appeals waiting and every reveal with its staff handle and its case", async () => {
    await page.getByRole("link", { name: "Home" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    await shown(page.getByText("Urgent: 2 cases, oldest", { exact: false }));
    await shown(page.getByText("Lane 1: no open case"));
    await shown(page.getByText("3 appeals wait."));
    expect(await page.locator("ul.reveals li").count()).toBe(1);
    expect(await page.locator("ul.reveals a").getAttribute("href")).toBe(`/cases/${CASE_POST}`);
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await texts();
    await clean();
  });

  test("the queue: open cases by lane and age with their marks, Load more, and Open a case on a finding", async () => {
    await page.getByRole("link", { name: "Queue" }).click();
    await page.waitForURL(`${origin}/queue`);
    const rows = page.locator("table.queue tbody tr");
    await shown(rows);
    expect(await rows.count()).toBe(2);
    expect(await rows.first().innerText()).toContain("CSAM: no images");
    expect(await rows.first().innerText()).toContain("re-examination");
    await page.getByRole("button", { name: "Load more" }).click();
    await rows.nth(2).waitFor();
    expect(await rows.count()).toBe(3);
    expect(await rows.nth(2).innerText()).toContain("deferred");
    await page.getByRole("button", { name: "Load more" }).waitFor({ state: "detached" });
    expect(await page.evaluate(`[...document.querySelectorAll("table.queue a")].map((link) => link.getAttribute("href"))`)).toEqual([`/cases/${CASE_FROZEN}`, `/cases/${CASE_ACCOUNT}`, `/cases/${CASE_POST}`]);

    // A link that is no web address is never sent; a link that names nothing is worded in the form's own words.
    const sent = () => fixtures.state.requests.filter((r) => r.path === "/api/staff/findings").length;
    await page.getByLabel("Link on korbat").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Open a case" }).click();
    await shown(page.getByText(FINDING_WORDS.invalid_request));
    expect(sent()).toBe(0);
    await page.getByLabel("Link on korbat").fill(DEAD_LINK);
    await page.getByRole("button", { name: "Open a case" }).click();
    await shown(page.getByText(FINDING_WORDS.not_found));
    expect(sent()).toBe(1);
    expect(fixtures.state.findings).toEqual([]);
    await clean();

    // A finding under R6 with its preset category opens the case it joined.
    const link = `http://localhost:8081/post/${POST_ID}`;
    await page.getByLabel("Link on korbat").fill(link);
    await page.getByLabel("Rule", { exact: true }).selectOption("R6");
    await page.getByRole("button", { name: "Open a case" }).click();
    await page.waitForURL(`${origin}/cases/${CASE_POST}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.findings).toEqual([{ target: { kind: "link", url: link }, ground: "rule", ruleId: "R6", category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" }]);
    await clean();
  });

  test("a case: every written string as text in its frame, an image only when asked for, first small and blurred, then large and clear, one at a time; a note saved with its digest", async () => {
    // Nothing was asked of the image route by opening the case.
    expect(fixtures.state.imageRequests).toEqual([]);
    expect(await page.locator(".placeholder").count()).toBe(2);
    expect(await page.locator("img").count()).toBe(0);
    const small = `/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/small`;
    const large = `/api/staff/cases/${CASE_POST}/media/${IMAGE_ONE}/large`;
    await page.getByRole("button", { name: "Show image" }).first().click();
    await until(imageIs(small, "evidence blurred"), "the small image, blurred");
    expect(fixtures.state.imageRequests).toEqual([small]);
    // The image is the console's own, drawn by its one image site: the page holds nothing else it does not write.
    expect(await inspect(page)).toEqual([]);
    expect(await page.evaluate(`getComputedStyle(document.querySelector("img.evidence")).filter`)).toContain("blur");
    await page.getByRole("button", { name: "Show clearly" }).click();
    await until(imageIs(large, "evidence"), "the large image, clear");
    expect(await page.evaluate(`getComputedStyle(document.querySelector("img.evidence")).filter`)).toBe("none");
    expect(fixtures.state.imageRequests).toEqual([small, large]);
    // The second image takes the first one's place.
    await page.getByRole("button", { name: "Show image" }).click();
    await until(imageIs(`/api/staff/cases/${CASE_POST}/media/${IMAGE_TWO}/small`, "evidence blurred"), "the second image alone");
    await page.getByRole("button", { name: "Hide image" }).click();
    await page.locator("img").waitFor({ state: "detached" });
    expect(fixtures.state.imageRequests).toHaveLength(3);
    // No image request carried anything but the session's cookie: the route's answer came from this origin alone.
    expect(fixtures.state.requests.filter((r) => IMAGE_PATH.test(r.path)).map((r) => r.status)).toEqual([200, 200, 200]);

    await page.getByRole("button", { name: "Show hidden characters" }).first().click();
    await shown(page.getByRole("button", { name: "Show the text as written" }));
    await page.getByRole("button", { name: "Show the text as written" }).click();

    await page.getByLabel("Add a note").fill(TYPED_NOTE);
    await page.getByRole("button", { name: "Save the note" }).click();
    await shown(page.getByText("The note is saved."));
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_POST, kind: "note", text: TYPED_NOTE });
    const shownTexts = await texts();
    for (const text of [TYPED_NOTE, LOOKALIKE.label, LONGEST_EXPLANATION, LONGEST_NOTE]) expect(shownTexts, text.slice(0, 40)).toContain(text);
    // The post's text names two hosts and one address whose host no browser reads (a direction override ends it): the
    // frame lists the two, and says that the third is there.
    expect(await page.locator("p.hint", { hasText: "Mentions addresses at:" }).first().innerText()).toBe("Mentions addresses at: korbat.example.evil.test, evil.test and an address this console cannot read");
    // The page holds no link but the console's own navigation.
    expect(await page.locator("main a").count()).toBe(0);
    await clean();
  });

  test("an image the API refuses says so in its place, in the console's words, and the case is read again", async () => {
    const reads = () => fixtures.state.requests.filter((r) => r.method === "GET" && r.path === `/api/staff/cases/${CASE_POST}`).length;
    const [asked, read] = [fixtures.state.imageRequests.length, reads()];
    // The post was frozen between the page's read of the case and the browser's request, as far as the page can tell.
    fixtures.state.refuseNextImage = true;
    await page.getByRole("button", { name: "Show image" }).first().click();
    await shown(page.locator(".placeholder").first().getByText(messageFor("image_refused"), { exact: true }));
    expect(await page.locator("img").count()).toBe(0);
    expect(fixtures.state.imageRequests).toHaveLength(asked + 1);
    expect(fixtures.state.requests.filter((r) => IMAGE_PATH.test(r.path)).at(-1)!.status).toBe(404);
    // What may be opened may have changed, so the page read the case again, once.
    for (let tries = 0; tries < 150 && reads() === read; tries++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reads()).toBe(read + 1);
    // Nothing offers to show the refused image more clearly; its person puts it away, and it is asked for only on a new click.
    expect(await page.getByRole("button", { name: "Show clearly" }).count()).toBe(0);
    await page.getByRole("button", { name: "Hide image" }).click();
    await shown(page.getByText("Image 1, not shown"));
    expect(fixtures.state.imageRequests).toHaveLength(asked + 1);
    await clean();
  });

  test("a case whose images cannot be opened: the banners, the sentence above the images' entries, each entry without its image, a re-examination item, the quoted post's case as the only link, and no image request", async () => {
    const asked = fixtures.state.imageRequests.length;
    await page.getByRole("link", { name: "Queue" }).click();
    await page.waitForURL(`${origin}/queue`);
    await page.locator("table.queue tbody tr").first().getByRole("link", { name: "Open the case" }).click();
    await page.waitForURL(`${origin}/cases/${CASE_FROZEN}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    await shown(page.getByText(ART_18_BANNER));
    await shown(page.getByText(SUSPECT_BANNER.nobody));
    await shown(page.getByText(SUSPECT_BANNER.post));
    await shown(page.getByText(IMAGES_NOT_SHOWN));
    await shown(page.getByText("Re-examination of item 1 of its notice"));
    await shown(page.getByText("You decided the item this re-examines. Leave it to another staff member when there is one."));
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.locator(".placeholder").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Show image" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Reveal who sent this" }).count()).toBe(0);
    // Each image still has its entry: its number, its size as text, and its alt text in an author frame. The case cites
    // R5, so the frame opens on request; then the alt text is there as its author wrote it.
    expect(await page.locator("ul.images li").count()).toBe(2);
    await shown(page.locator("ul.images li").first().getByText("Image 1", { exact: true }));
    await shown(page.locator("ul.images li").first().getByText("2048 by 1536 pixels", { exact: true }));
    const altFrames = page.locator("ul.images .frame");
    expect(await altFrames.count()).toBe(2);
    expect(await altFrames.locator(".frame-label").allInnerTexts()).toEqual(["Alt text. Written by the author", "Alt text. Written by the author"]);
    await altFrames.first().getByRole("button", { name: "Show text (R5: direct threats)" }).click();
    expect(await altFrames.first().locator("p.frame-text").textContent()).toBe(HOSTILE.quote);
    await page.getByRole("button", { name: "Show the list of posts" }).click();
    await shown(page.getByText("and 500 more: use the runbook's query for a seal's posts"));
    // The one link of the page leads to the quoted post's case, in the console.
    expect(await page.evaluate(`[...document.querySelectorAll("main a")].map((link) => link.getAttribute("href"))`)).toEqual([`/cases/${CASE_QUOTED}`]);
    await texts();
    await clean();
    await page.locator("main a").click();
    await page.waitForURL(`${origin}/cases/${CASE_QUOTED}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    await clean();
  });

  test("an account's case with an unanswered suspect item: the account's sentences, a fresh snapshot, no image request and no link into the app", async () => {
    const asked = fixtures.state.imageRequests.length;
    await page.getByRole("link", { name: "Queue" }).click();
    await page.waitForURL(`${origin}/queue`);
    await page.locator("table.queue tbody tr").nth(1).getByRole("link", { name: "Open the case" }).click();
    await page.waitForURL(`${origin}/cases/${CASE_ACCOUNT}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    await shown(page.getByText(SUSPECT_BANNER.noImage));
    await shown(page.getByText(SUSPECT_BANNER.account));
    expect(await page.getByText(SUSPECT_BANNER.post).count()).toBe(0);
    expect(await page.locator("main a").count()).toBe(0);
    expect(await page.locator("img").count()).toBe(0);
    // The display name and the bio, as they read now and as the snapshot copied them, each in a frame that says what it is.
    expect(await page.getByText("Display name. Written by the author", { exact: true }).count()).toBe(2);
    expect(await page.getByText("Bio. Written by the author", { exact: true }).count()).toBe(2);
    // The account's fields changed since the report: a fresh snapshot is offered, and taken.
    await page.getByRole("button", { name: "Take a fresh snapshot" }).click();
    await shown(page.getByText("A fresh snapshot is the case's newest now."));
    expect(fixtures.state.snapshotsTaken).toBe(1);
    await page.getByRole("button", { name: "Take a fresh snapshot" }).waitFor({ state: "detached" });
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    await texts();
    await clean();
  });

  test("a reveal: nothing to confirm until a reason is chosen and written; the reason saved first, the key confirming its digest; the name in a frame of its own, kept when the case cannot be read again and gone once the dialog is closed; options that bind another item are refused before the key is asked", async () => {
    await page.goto(`${origin}/cases/${CASE_POST}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    const before = await signatures();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Confirm with your staff key" });
    const why = dialog.getByLabel("Why");
    const written = dialog.getByLabel("Reason", { exact: true });
    await page.getByRole("button", { name: "Reveal who sent this" }).first().click();
    await shown(dialog);
    // No reason is chosen for the person and none is written: there is nothing to confirm yet.
    expect(await why.inputValue()).toBe("");
    expect(await confirm.isDisabled()).toBe(true);
    await why.selectOption("abuse_of_reporting");
    expect(await confirm.isDisabled()).toBe(true);
    await written.fill("   ");
    expect(await confirm.isDisabled()).toBe(true);
    await written.fill("The same account reported forty posts of one author in an hour.");
    expect(await confirm.isDisabled()).toBe(false);
    // The read of the case that follows the reveal will be refused: the page, and the name it has just shown, must stay.
    fixtures.state.recuseNextCaseRead = true;
    await confirm.click();
    await shown(dialog.getByText("Revealed to you; recorded and shown to every staff member"));
    expect(await signatures()).toBe(before + 1);
    const reason = fixtures.state.texts.find((text) => text.kind === "reveal_reason")!;
    expect(reason).toMatchObject({ caseId: CASE_POST, text: "The same account reported forty posts of one author in an hour." });
    expect(fixtures.state.reveals).toEqual([{ itemId: ITEM_REPORTER, reasonDigest: reason.digest }]);
    // The name alone in its frame, under the console's own line that says what it is, with its hidden characters to show.
    await shown(dialog.getByText("The reporter's handle:", { exact: true }));
    expect(await dialog.locator(".frame p.frame-text").textContent()).toBe(REVEALED_HANDLE);
    await shown(dialog.getByRole("button", { name: "Show hidden characters" }));
    // The refused read left the case on the page and says why on the page's error line; the name is still there.
    await shown(page.getByRole("alert").filter({ hasText: messageFor("staff_recused") }));
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.requests.filter((r) => r.path === `/api/staff/cases/${CASE_POST}`).at(-1)!.status).toBe(403);
    expect(await dialog.locator(".frame p.frame-text").textContent()).toBe(REVEALED_HANDLE);
    expect(await texts()).toContain(REVEALED_HANDLE);
    // Shown once: with the dialog closed the page holds the name nowhere.
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "detached" });
    expect(await userTexts(page)).not.toContain(REVEALED_HANDLE);
    expect(await page.locator("#root").innerText()).not.toContain("a_reporter");
    await clean();

    // The server asks the key to confirm the reveal of another item: the key is never asked, and nothing is revealed.
    const reveals = fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length;
    fixtures.state.mismatchNextStepUp = true;
    await page.getByRole("button", { name: "Reveal who sent this" }).nth(1).click();
    await why.selectOption("impersonation_claim");
    await written.fill("The notifier claims to be impersonated.");
    await confirm.click();
    await shown(page.getByText(messageFor("step_up_mismatch")));
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length).toBe(reveals);
    expect(fixtures.state.reveals).toHaveLength(1);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await clean();
  });

  test("a save answered with the digest of another text is refused by the page: no options are asked, the key signs nothing, and nothing is revealed", async () => {
    const before = await signatures();
    const options = fixtures.state.stepUpOptionsServed;
    const reveals = fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length;
    const dialog = page.getByRole("dialog");
    // The API stores a reason of its own in the person's name and answers its digest: a reveal confirmed under that
    // digest would go through, so only the page's own check stands between the key and a reason nobody wrote.
    fixtures.state.hostileNextSave = true;
    await page.getByRole("button", { name: "Reveal who sent this" }).nth(1).click();
    await dialog.getByLabel("Why").selectOption("legal_requirement");
    await dialog.getByLabel("Reason", { exact: true }).fill("A court asked who sent this notice.");
    await dialog.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(dialog.getByText(messageFor("invalid_answer")));
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_POST, kind: "reveal_reason", text: FORGED_REASON });
    expect(fixtures.state.forgedDigests).toHaveLength(1);
    expect(fixtures.state.stepUpOptionsServed).toBe(options);
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.path.endsWith("/reveal")).length).toBe(reveals);
    expect(fixtures.state.reveals).toHaveLength(1);
    // What the person wrote is still in the dialog, to be confirmed again or put away.
    expect(await dialog.getByLabel("Reason", { exact: true }).inputValue()).toBe("A court asked who sent this notice.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached" });
    await clean();
  });

  test("an address the console does not have says so, inside the console", async () => {
    await page.goto(`${origin}/no/such/page`);
    await shown(page.getByRole("heading", { name: "No such page" }));
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    // Every read the home screen started has finished before the walk moves on, so none is in flight when the session ends.
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await page.getByRole("link", { name: "Audit log" }).click();
    await shown(page.locator("table.audit tbody tr"));
    await clean();
  });

  test("the ended session: sign-in in place at the same address, both staff cookies gone, and the same page after", async () => {
    fixtures.endEverySession();
    await page.getByRole("button", { name: "Load older" }).click();
    await shown(page.getByText("Your staff session ended."));
    expect(page.url()).toBe(`${origin}/audit`);
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("__Host-korbat_staff"))).toEqual([]);
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByRole("heading", { name: "Audit log" }));
    await shown(page.locator("table.audit tbody tr"));
    expect(page.url()).toBe(`${origin}/audit`);
    await clean();
  });

  test("a second key enrolled while signed in: its success page asks that key, never the session's, and signs in with it", async () => {
    const first = staffAuthenticator;
    const token = fixtures.issueEnrolment();
    // The first key holds the live session; it could answer nothing here unless the page asked it, which this would show.
    await watcher.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: false });
    const second = await addAuthenticator("device-bound security key");
    staffAuthenticators.push(second);
    await page.goto(`${origin}/enroll/${token}`);
    await shown(page.getByRole("heading", { name: "Register a staff key" }));
    await page.getByLabel("Name of this key").fill("Backup key");
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    const newKey = fixtures.state.keys[fixtures.state.keys.length - 1]!;
    expect(newKey.name).toBe("Backup key");
    const [firstBefore, secondBefore] = [await signaturesOf(first), await signaturesOf(second)];
    // The browser still holds the first key's session: the sign-in page would show home and ask no key.
    expect((await context.cookies()).some((cookie) => cookie.name === "__Host-korbat_staff")).toBe(true);
    await page.getByRole("button", { name: "Sign in with this key" }).click();
    await shown(page.getByText("opened the console", { exact: false }));
    expect(await signaturesOf(second)).toBe(secondBefore + 1);
    expect(await signaturesOf(first)).toBe(firstBefore);
    // The session it opened is the new key's.
    expect([...fixtures.state.sessions.values()].filter((s) => s.credentialId === newKey.credentialId)).toHaveLength(1);
    await watcher.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: true });
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await clean();
  });

  test("sign-out ends the session and shows sign-in at its own address", async () => {
    const before = fixtures.state.sessions.size;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${origin}/signin`);
    await shown(page.getByRole("button", { name: "Sign in with your staff key" }));
    expect(await page.getByText("Your staff session ended.").count()).toBe(0);
    // The session the page held, the second key's, is gone; the first key's, which this browser no longer names, stays.
    expect(fixtures.state.sessions.size).toBe(before - 1);
    expect([...fixtures.state.sessions.values()].some((s) => s.credentialId === fixtures.state.keys[fixtures.state.keys.length - 1]!.credentialId)).toBe(false);
    await clean();
  });

  test("sign-in options that carry a step-up challenge are refused before the key is asked", async () => {
    const before = await signatures();
    const served = fixtures.state.signInOptionsServed;
    const verifies = fixtures.state.requests.filter((r) => r.path === "/api/staff/signin/verify").length;
    fixtures.state.stepUpChallengeAtNextSignIn = true;
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByText(messageFor("signin_mismatch")));
    expect(fixtures.state.signInOptionsServed).toBe(served + 1);
    // No key signed anything and nothing was sent after the options: the forged confirmation was never made.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.path === "/api/staff/signin/verify").length).toBe(verifies);
    expect(page.url()).toBe(`${origin}/signin`);
    await clean();
  });

  test("every request the walk sent was its person's own, marked, and every string the fixtures wrote was shown as text", () => {
    expect(watcher.take()).toEqual([]);
    expect(fixtures.state.requests.length).toBeGreaterThan(20);
    // An image is asked for by the browser itself, which sends no mark, and the queue reads itself again every 60 seconds
    // while it is open, unmarked so that it never keeps a session alive (should a step of the walk ever last that long).
    // Every other request was the person's own.
    const pagesOwn = (r: { method: string; path: string }) => IMAGE_PATH.test(r.path) || (r.method === "GET" && (r.path === "/api/staff/queue" || r.path.startsWith("/api/staff/queue?")));
    expect(fixtures.state.requests.filter((r) => !r.activity && !pagesOwn(r))).toEqual([]);
    expect(fixtures.state.problems).toEqual([]);
    expect(HOSTILE_TEXTS.filter((text) => !seen.has(text))).toEqual([]);
  });
});
