import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MEASURES, SEAL_DRAFTS } from "@korbat/contracts";
import { STATEMENT_WORDS } from "@korbat/rules";
import { buildConsole } from "../../build.mjs";
import { CONSOLE_CSP } from "../../site-headers.mjs";
import { COMPOSER } from "../../src/compose";
import { APPEAL_WORDS, COMPOSER_KINDS, COMPOSER_OUTCOMES, COMPOSER_WORDS, FINDING_WORDS, messageFor, NOTE_WORDS, PROTECTION_LIFTED_WORDS, REVIEW_OUTCOMES, STAFF_MESSAGES, STANDING_WORDS } from "../../src/messages";
import { ERASURE_OVERDUE_RUNBOOK } from "../../src/screens/Home";
import { ART_18_BANNER, IMAGES_NOT_SHOWN, SUSPECT_BANNER } from "../../src/screens/Case";
import { UNAVAILABLE_TEXT } from "../../src/screens/Unavailable";
import { SIGN_IN_WINDOW_MS } from "../../src/signins";
import { clockTime } from "../../src/ui";
import { consoleSiteHeadersFromCaddyfile } from "../caddyfile";
import {
  APPEAL_ONE,
  APPEAL_STRUCK,
  CASE_ACCOUNT,
  CASE_ADMIN,
  CASE_APPEALED,
  CASE_CHANGED,
  CASE_DECLINE,
  CASE_DRAFTS,
  CASE_FROZEN,
  CASE_POST,
  CASE_QUOTED,
  CASE_SEALABLE,
  CASE_STRIKE,
  CASE_AT_ONCE,
  CASE_LADDER,
  CASE_REPLIED,
  CASE_STRUCK,
  CASE_WITHDRAW,
  DECISION_APPEALED,
  DECISION_ONE,
  DECISION_REPLIED,
  DECISION_STRUCK,
  DECISION_WITHDRAW,
  IMAGE_ONE,
  IMAGE_TWO,
  ITEM_REPORTER,
  LONGEST_EXPLANATION,
  LONGEST_NOTE,
  LOOKALIKE,
  POST_ID,
  REPLY_TEXT,
  atOnceCase,
  ladderCase,
  repliedCase,
  struckCase,
  withdrawCase,
} from "../case-fixtures";
import { HOSTILE } from "../fixtures";
import {
  createFixtureApi,
  CURRENT_BROWSER,
  DEAD_LINK,
  EXISTING_KEY_NAMES,
  FORGED_DRAFT,
  FORGED_REASON,
  HOSTILE_TEXTS,
  IMAGE_PATH,
  OTHER_BROWSERS,
  OTHER_STAFF,
  PERSON_HANDLE,
  REVEALED_HANDLE,
  STANDING_HANDLE,
  TYPED_ADMIN_FACTS,
  TYPED_CHANGED_FACTS,
  TYPED_DECLINE,
  TYPED_DRAFT_FACTS,
  TYPED_FACTS,
  TYPED_KEY_NAME,
  TYPED_NOTE,
  TYPED_REASON,
  TYPED_REVIEW_REASON,
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
 * case with a fresh snapshot, a reveal, and a save that the API answers with the digest of another text. For deciding
 * (sections 7.5 and 8) it lifts a measure taken while deciding, meets step-up options that bind another decision before
 * the key is asked, confirms a final decision whose texts were saved when their fields lost focus, seals an account's
 * images with the fixed drafts through a session that ended and a sign-in, records a choice not to seal, answers a report
 * of child sexual abuse material without a measure as an admin, meets a case that another staff member decided meanwhile,
 * brings a draft's saved texts back after a reload (one of them answered with other words under its digest, and dropped),
 * and reads the home screen's three lists of the path. Each step fails on any policy report through any channel
 * console-lab.md names, any page error and any dialog. It needs no database and writes nothing but a temporary build.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome instead,
 * as CI does with the runner's.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";

/** 3e: what the two runs of Task 1 type: the facts of a removal that gives a strike, and the reason of a review that overrules one. */
const STRIKE_FACTS = `The post sells followers again ${HOSTILE.img}`;
const OVERRULE_REASON = `The post quotes the offer to report it ${HOSTILE.quote}`;

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

/**
 * Waits until the fixtures have seen something. A text is saved when its field loses focus, and the request arrives a
 * moment after the key press that moved the focus.
 */
async function arrived(check: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 150 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!check()) throw new Error(`not within 15 s: ${what}`);
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
    // The appeal the fixtures' appealed case holds, which this person may review, and one nobody at korbat can review now.
    await shown(page.getByText("2 appeals wait; you may review 1; 1 has no possible reviewer now."));
    await shown(page.getByText(APPEAL_WORDS.reviewerRule));
    // The first list of the kind is the reveals'; the three lists of the path for child sexual abuse material follow it.
    const reveals = page.locator("ul.reveals").first();
    expect(await reveals.locator("li").count()).toBe(1);
    expect(await reveals.locator("a").getAttribute("href")).toBe(`/cases/${CASE_POST}`);
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await texts();
    await clean();
  });

  test("home says which erasures are more than a day late, with the runbook's sentence, as an alert", async () => {
    await page.getByRole("link", { name: "Home" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    const late = page.getByRole("alert").filter({ hasText: "Erasures more than a day late" });
    await shown(late);
    expect(await late.innerText()).toBe(`Erasures more than a day late: image rows nothing retains: 60; notifiers' contacts and confirmations: 2. ${ERASURE_OVERDUE_RUNBOOK}`);
    // A count of zero is not on the screen at all.
    expect(await page.getByText("unconfirmed drafts").count()).toBe(0);
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

  test("a measure taken while deciding lifted with the key: the correction names what it lifts and its reason, the preview is the statement, the key confirms exactly that, and the page shows what the answer says now stands", async () => {
    // The page still shows the post's case, whose decision taken while deciding holds a withhold in force.
    const before = await signatures();
    await page.getByRole("button", { name: COMPOSER.liftLabel }).click();
    const correction = page.getByRole("region", { name: COMPOSER.liftLabel });
    await shown(correction);
    const confirm = correction.getByRole("button", { name: "Confirm with your staff key" });
    // Nothing to confirm until something is chosen to lift and a reason is written.
    expect(await confirm.isDisabled()).toBe(true);
    await correction.getByLabel(MEASURES.restore.label).check();
    expect(await confirm.isDisabled()).toBe(true);
    await correction.getByLabel("Reason of the correction").fill(TYPED_REASON);
    expect(await confirm.isDisabled()).toBe(false);
    // The preview is the statement its author will receive, each paragraph as text, what was typed among them.
    const preview = correction.locator(".frame.preview p.frame-text");
    expect(await preview.first().textContent()).toBe(STATEMENT_WORDS.interimLifted("2026-10-01 09:00 UTC"));
    expect(await preview.allTextContents()).toContain(`Why korbat changed it: ${TYPED_REASON}`);
    expect(await inspect(page)).toEqual([]);
    await confirm.click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 1);
    const reason = fixtures.state.texts.at(-1)!;
    expect(reason).toMatchObject({ caseId: CASE_POST, kind: "review_reason", text: TYPED_REASON });
    // What the key confirmed is what the page showed: the decision it lifts, the reversal, and the digest of the saved reason.
    expect(fixtures.state.decisions).toHaveLength(1);
    expect(fixtures.state.decisions[0]).toMatchObject({
      caseId: CASE_POST,
      params: { kind: "correction", stateVersion: 3, throughSeq: 0, reviewsDecisionId: DECISION_ONE, outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, actions: [{ kind: "restore", mediaId: null }], factsDigest: null, reasonDigest: reason.digest, legalReferenceDigest: null },
    });
    // The case as the answer gave it: the next version, the withhold lifted, and nothing left to lift.
    await shown(page.getByText("version 4", { exact: false }));
    await shown(page.getByText(`${MEASURES.withhold.label}: lifted by the decision of`, { exact: false }));
    expect(await page.getByRole("button", { name: COMPOSER.liftLabel }).count()).toBe(0);
    await texts();
    await clean();
  });

  test("a decision whose step-up options bind other params is refused before the key is asked; the draft stays, and confirmed again it is recorded without its texts being saved twice", async () => {
    const before = await signatures();
    const sent = () => fixtures.state.requests.filter((r) => r.method === "POST" && r.path.endsWith("/decisions")).length;
    const composer = page.getByRole("region", { name: "Decide" });
    const confirm = composer.getByRole("button", { name: "Confirm with your staff key" });
    // The outcome comes first, with every outcome this person may decide on the case; the page opens on a restriction.
    expect(await composer.locator("fieldset legend").first().textContent()).toBe("Outcome");
    for (const outcome of Object.values(COMPOSER_OUTCOMES)) expect(await composer.getByLabel(outcome, { exact: true }).count(), outcome).toBe(1);
    expect(await composer.getByLabel(COMPOSER_OUTCOMES.restricted, { exact: true }).isChecked()).toBe(true);
    await composer.getByLabel(COMPOSER_KINDS.final).check();
    // A restriction needs a measure, its facts and its reason before anything can be confirmed.
    expect(await confirm.isDisabled()).toBe(true);
    await shown(composer.getByText(COMPOSER.previewNeedsMeasure));
    await composer.getByLabel(MEASURES.remove.label, { exact: true }).check();
    const saved = fixtures.state.texts.length;
    await composer.getByLabel("Facts").fill(TYPED_FACTS);
    await composer.getByLabel("Reason", { exact: true }).fill("It sells followers, which the rule names.");
    expect(await confirm.isDisabled()).toBe(false);
    // Each text is saved, without the key, when its field loses focus: the facts when the reason was begun, the reason now.
    await arrived(() => fixtures.state.texts.length === saved + 1, "the facts saved when their field lost focus");
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_POST, kind: "facts", text: TYPED_FACTS });
    await composer.getByLabel("Reason", { exact: true }).press("Tab");
    await arrived(() => fixtures.state.texts.length === saved + 2, "the reason saved when its field lost focus");
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_POST, kind: "reason", text: "It sells followers, which the rule names." });
    expect(await signatures()).toBe(before);
    // Under both fields of a restriction: the rule on personal data, and that the author receives the text.
    expect(await composer.getByText(COMPOSER.personalData, { exact: true }).count()).toBe(2);
    const preview = composer.locator(".frame.preview p.frame-text");
    expect(await preview.first().textContent()).toBe(STATEMENT_WORDS.done.remove("2026-09-30 12:00 UTC"));
    expect(await preview.allTextContents()).toContain(`The facts: ${TYPED_FACTS}`);
    expect(await preview.last().textContent()).toMatch(/^You can appeal this decision once, free of charge, within six months of being told, until /);
    expect(await inspect(page)).toEqual([]);

    // The API asks the key to confirm another decision than the one the page built: the key is never asked.
    const [options, posted] = [fixtures.state.stepUpOptionsServed, sent()];
    fixtures.state.mismatchNextStepUp = true;
    await confirm.click();
    await shown(composer.getByRole("alert").filter({ hasText: messageFor("step_up_mismatch") }));
    expect(fixtures.state.stepUpOptionsServed).toBe(options + 1);
    expect(await signatures()).toBe(before);
    expect(sent()).toBe(posted);
    expect(fixtures.state.decisions).toHaveLength(1);
    // The confirmation saved nothing more: both texts were on the server before it. What was chosen and written is still there.
    expect(fixtures.state.texts).toHaveLength(saved + 2);
    expect(await composer.getByLabel("Facts").inputValue()).toBe(TYPED_FACTS);
    expect(await composer.getByLabel(MEASURES.remove.label, { exact: true }).isChecked()).toBe(true);
    await clean();

    // Confirmed again, with options that bind the decision itself: the saved texts are used as they are.
    await confirm.click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 1);
    expect(sent()).toBe(posted + 1);
    expect(fixtures.state.texts).toHaveLength(saved + 2);
    const [facts, reason] = fixtures.state.texts.slice(-2);
    expect(facts).toMatchObject({ caseId: CASE_POST, kind: "facts", text: TYPED_FACTS });
    expect(fixtures.state.decisions).toHaveLength(2);
    expect(fixtures.state.decisions[1]).toMatchObject({
      caseId: CASE_POST,
      // 3e: the case answer says a strike is due, so the key confirmed it with the removal.
      params: { kind: "final", stateVersion: 4, throughSeq: 2, reviewsDecisionId: null, outcome: "restricted", ground: "incompatible", ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", categoryKeyword: null, actions: [{ kind: "remove", mediaId: null }, { kind: "strike", mediaId: null }], factsDigest: facts!.digest, reasonDigest: reason!.digest, legalReferenceDigest: null },
    });
    // The answer is the case as it now stands: closed, with nothing more to decide on it.
    await shown(page.getByText("; closed ", { exact: false }));
    await shown(page.getByRole("region", { name: "Decide" }).getByText(COMPOSER.closed));
    expect(await page.getByRole("button", { name: "Confirm with your staff key" }).count()).toBe(0);
    await texts();
    await clean();
  });

  test("the seal from the composer on an account's case: the fixed drafts as its facts and reason, the draft still there after a session that ended and a sign-in, the key confirming it, and no image asked for", async () => {
    const asked = fixtures.state.imageRequests.length;
    await page.goto(`${origin}/cases/${CASE_SEALABLE}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    const composer = page.getByRole("region", { name: "Decide" });
    // A moderator decides only while an admin decides, and the banner says what ends the urgent mails.
    await shown(composer.getByText(COMPOSER.adminFinal));
    await shown(composer.getByText(COMPOSER.onlySealEnds));
    expect(await composer.getByLabel(COMPOSER_KINDS.final).count()).toBe(0);
    // Under that sentence the restriction stands alone: an outcome without a measure is a final decision's, an admin's here.
    expect(await composer.getByLabel(COMPOSER_OUTCOMES.restricted, { exact: true }).count()).toBe(1);
    expect(await composer.getByLabel(COMPOSER_OUTCOMES.no_violation, { exact: true }).count()).toBe(0);
    expect(await composer.getByLabel(COMPOSER_OUTCOMES.not_evident, { exact: true }).count()).toBe(0);
    await composer.getByRole("button", { name: MEASURES.seal_media.label }).click();
    expect(await composer.getByLabel("Rule", { exact: true }).inputValue()).toBe("R2");
    expect(await composer.getByLabel("Facts").inputValue()).toBe(SEAL_DRAFTS.facts.notice_account);
    expect(await composer.getByLabel("Reason", { exact: true }).inputValue()).toBe(SEAL_DRAFTS.reason.deciding);
    await shown(composer.getByText(COMPOSER.neverWrite).first());
    expect(await composer.locator(".frame.preview p.frame-text").first().textContent()).toBe(STATEMENT_WORDS.sealAccount(3, 2));
    await clean();

    // The session ends behind the page's back: the confirmation meets the sign-in, in place; nothing was saved or signed.
    const before = await signatures();
    const saved = fixtures.state.texts.length;
    fixtures.endEverySession();
    await composer.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(page.getByText("Your staff session ended."));
    expect(page.url()).toBe(`${origin}/cases/${CASE_SEALABLE}`);
    expect(fixtures.state.texts).toHaveLength(saved);
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    expect(await signatures()).toBe(before + 1);
    // The draft is the one its person left: the seal chosen, with its rule and its texts.
    const again = page.getByRole("region", { name: "Decide" });
    await shown(again.getByLabel(`${MEASURES.seal_media.label}: chosen`));
    expect(await again.getByLabel(`${MEASURES.seal_media.label}: chosen`).isChecked()).toBe(true);
    expect(await again.getByLabel("Rule", { exact: true }).inputValue()).toBe("R2");
    expect(await again.getByLabel("Facts").inputValue()).toBe(SEAL_DRAFTS.facts.notice_account);
    expect(await again.getByLabel("Reason", { exact: true }).inputValue()).toBe(SEAL_DRAFTS.reason.deciding);

    await again.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 2);
    const [facts, reason] = fixtures.state.texts.slice(-2);
    expect([facts!.text, reason!.text]).toEqual([SEAL_DRAFTS.facts.notice_account, SEAL_DRAFTS.reason.deciding]);
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_SEALABLE,
      params: { kind: "interim", throughSeq: 0, outcome: "restricted", ground: "incompatible", ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", actions: [{ kind: "seal_media", mediaId: null }], factsDigest: facts!.digest, reasonDigest: reason!.digest },
    });
    // The case as it now stands: the seal in force with what it covers. No image is served any more, so the banner now
    // names a note, and the seal stays on offer for images posted later.
    await shown(page.getByText(`${MEASURES.seal_media.label}: in force`, { exact: false }));
    await shown(page.getByText("3 images on 2 posts (0 of them deleted by their author)"));
    await shown(page.getByRole("region", { name: "Decide" }).getByText(COMPOSER.noteEnds));
    expect(await page.getByRole("region", { name: "Decide" }).getByText(COMPOSER.onlySealEnds).count()).toBe(0);
    // A moderator is not offered the lifting of a seal.
    expect(await page.getByRole("button", { name: COMPOSER.liftLabel }).count()).toBe(0);
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.locator("main a").count()).toBe(0);
    await texts();
    await clean();
  });

  test("the choice not to seal: nothing to record until a reason is written; it is saved without the key, shown on the case with its reason, and no image is asked for", async () => {
    const [asked, before, options] = [fixtures.state.imageRequests.length, await signatures(), fixtures.state.stepUpOptionsServed];
    await page.goto(`${origin}/cases/${CASE_DECLINE}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    const composer = page.getByRole("region", { name: "Decide" });
    await composer.getByRole("button", { name: "Do not seal now" }).click();
    const choice = composer.getByRole("group", { name: "Do not seal now" });
    await shown(choice.getByText(COMPOSER.declineWords));
    const record = choice.getByRole("button", { name: "Record this choice" });
    expect(await record.isDisabled()).toBe(true);
    await choice.getByLabel("Why you do not seal now").fill("   ");
    expect(await record.isDisabled()).toBe(true);
    await choice.getByLabel("Why you do not seal now").fill(TYPED_DECLINE);
    await record.click();
    await shown(page.getByText(COMPOSER.declined));
    expect(fixtures.state.texts.at(-1)).toMatchObject({ caseId: CASE_DECLINE, kind: "seal_declined", text: TYPED_DECLINE });
    // The choice is on the case, with who made it and its reason in a frame; the seal is still offered.
    await shown(page.getByText("Chose not to seal:", { exact: false }));
    expect(await page.locator(".frame", { hasText: "Reason. Written by staff" }).locator("p.frame-text").last().textContent()).toBe(TYPED_DECLINE);
    await choice.waitFor({ state: "detached" });
    expect(await composer.getByRole("button", { name: MEASURES.seal_media.label }).isEnabled()).toBe(true);
    // No key was asked, no decision made, no image requested, and the page links nowhere.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.stepUpOptionsServed).toBe(options);
    expect(fixtures.state.decisions.filter((made) => made.caseId === CASE_DECLINE)).toEqual([]);
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    expect(await page.locator("img").count()).toBe(0);
    expect(await page.locator("main a").count()).toBe(0);
    await texts();
    await clean();
  });

  test("an admin's composer on a case with an unanswered report of child sexual abuse material: every outcome listed first, the choice not to seal only while deciding, and an answer without a measure that needs its facts, tells its author nothing and leaves the later report open", async () => {
    const [asked, before] = [fixtures.state.imageRequests.length, await signatures()];
    fixtures.state.role = "admin";
    await page.goto(`${origin}/cases/${CASE_ADMIN}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    const composer = page.getByRole("region", { name: "Decide" });
    const confirm = composer.getByRole("button", { name: "Confirm with your staff key" });
    // The outcome comes first, with every outcome an admin may decide; beside them, that an answer now is given unseen.
    expect(await composer.locator("fieldset legend").first().textContent()).toBe("Outcome");
    for (const outcome of Object.values(COMPOSER_OUTCOMES)) expect(await composer.getByLabel(outcome, { exact: true }).count(), outcome).toBe(1);
    expect(await composer.getByText(COMPOSER.adminFinal).count()).toBe(0);
    await shown(composer.getByText(COMPOSER.unseen));
    // While deciding, the seal and the choice not to seal stand side by side.
    expect(await composer.getByLabel(COMPOSER_KINDS.interim).isChecked()).toBe(true);
    await shown(composer.getByRole("button", { name: MEASURES.seal_media.label }));
    await shown(composer.getByRole("button", { name: "Do not seal now" }));
    // Deciding the case, an admin seals for good or answers without a seal: the choice not to seal is not offered.
    await composer.getByLabel(COMPOSER_KINDS.final).check();
    await shown(composer.getByText(COMPOSER.admin.endsFreeze));
    await shown(composer.getByText(COMPOSER.admin.unseen));
    await shown(composer.getByRole("button", { name: MEASURES.seal_media.label }));
    expect(await composer.getByRole("button", { name: "Do not seal now" }).count()).toBe(0);

    // An answer without a measure: no kind is asked, the category the key will confirm is shown, and the facts are needed.
    await composer.getByLabel(COMPOSER_OUTCOMES.no_violation, { exact: true }).check();
    expect(await composer.locator("legend", { hasText: "When" }).count()).toBe(0);
    expect(await composer.locator("legend", { hasText: "Measures" }).count()).toBe(0);
    expect(await composer.getByLabel("Ground").count()).toBe(0);
    expect(await composer.getByRole("button", { name: "Do not seal now" }).count()).toBe(0);
    expect(await composer.getByLabel("Category").inputValue()).toBe("STATEMENT_CATEGORY_OTHER_VIOLATION_TC");
    await composer.getByLabel("Category").selectOption("STATEMENT_CATEGORY_PROTECTION_OF_MINORS");
    expect(await confirm.isDisabled()).toBe(true);
    // Under both fields: never to say what the images are, and that the author never receives the text.
    expect(await composer.getByText(COMPOSER.neverWrite, { exact: true }).count()).toBe(2);
    expect(await composer.getByText(`${COMPOSER_WORDS.personalDataRule} ${COMPOSER_WORDS.staysInRecord}`, { exact: true }).count()).toBe(2);
    expect(await composer.getByText(COMPOSER_WORDS.toAuthor, { exact: false }).count()).toBe(0);
    // Nothing was done while deciding on this case, so the answer is told to nobody, and the page says so in the preview's place.
    await shown(composer.getByText(COMPOSER_WORDS.noStatement));
    expect(await composer.locator(".frame.preview").count()).toBe(0);
    const saved = fixtures.state.texts.length;
    await composer.getByLabel("Reason", { exact: true }).fill("Nothing in the report or in the post supports it.");
    expect(await confirm.isDisabled()).toBe(true);
    await composer.getByLabel("Facts").fill(TYPED_ADMIN_FACTS);
    expect(await confirm.isDisabled()).toBe(false);
    // Each text is saved, without the key, when its field loses focus.
    await composer.getByLabel("Facts").press("Tab");
    await arrived(() => fixtures.state.texts.length === saved + 2, "the reason and the facts saved when their fields lost focus");
    const written = (kind: string) => fixtures.state.texts.slice(saved).find((text) => text.kind === kind)!;
    expect(written("facts")).toMatchObject({ caseId: CASE_ADMIN, text: TYPED_ADMIN_FACTS });
    expect(await signatures()).toBe(before);
    await clean();

    await confirm.click();
    // The answer reaches the newest report of child sexual abuse material: the rule report that arrived after it stays open.
    await shown(page.getByText(`${COMPOSER.recorded} ${COMPOSER.leftForLater(1)}`));
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.texts).toHaveLength(saved + 2);
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_ADMIN,
      params: { kind: "final", stateVersion: 3, throughSeq: 2, reviewsDecisionId: null, outcome: "no_violation", ground: null, ruleId: null, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", categoryKeyword: null, actions: [], factsDigest: written("facts").digest, reasonDigest: written("reason").digest, legalReferenceDigest: null },
    });
    // The case as the answer gave it: the answer with its facts, for staff, and a composer for the report left open.
    await shown(page.getByText("; version 4", { exact: false }));
    expect(await texts()).toContain(TYPED_ADMIN_FACTS);
    const after = page.getByRole("region", { name: "Decide" });
    expect(await after.getByText(COMPOSER.neverWrite, { exact: true }).count()).toBe(0);
    expect(await after.getByLabel(COMPOSER_OUTCOMES.no_violation, { exact: true }).count()).toBe(1);
    expect(await after.getByLabel(COMPOSER_OUTCOMES.not_evident, { exact: true }).count()).toBe(0);
    expect(fixtures.state.imageRequests).toHaveLength(asked);
    expect(await page.locator("img").count()).toBe(0);
    // The steps that follow are a moderator's again: each opens its page anew, and reads who is signed in.
    fixtures.state.role = "moderator";
    await clean();
  });

  test("a case that another staff member decided meanwhile: a save that failed is worded under its field and made again by the confirmation, the refusal is worded in place, the case is read again with the draft kept, and confirmed again the decision is recorded without a text saved twice", async () => {
    const before = await signatures();
    const REASON = "That is what the rule names.";
    const requests = (method: string, tail: string) => fixtures.state.requests.filter((r) => r.method === method && r.path === `/api/staff/cases/${CASE_CHANGED}${tail}`).map((r) => r.status);
    await page.goto(`${origin}/cases/${CASE_CHANGED}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    await shown(page.getByText("; version 1", { exact: false }));
    const composer = page.getByRole("region", { name: "Decide" });
    const confirm = composer.getByRole("button", { name: "Confirm with your staff key" });
    // A moderator's own page again: no outcome of an admin's is on it that this person may not take.
    expect(await composer.getByLabel(COMPOSER_OUTCOMES.not_evident, { exact: true }).count()).toBe(0);
    // One image withheld while deciding: a measure that still stands once another staff member has hidden the post.
    await composer.getByLabel(MEASURES.withhold_media.label, { exact: true }).check();
    await composer.getByLabel("Facts").fill(TYPED_CHANGED_FACTS);
    await composer.getByLabel("Reason", { exact: true }).fill(REASON);
    await arrived(() => requests("POST", "/texts").length === 1, "the facts saved when their field lost focus");
    // The reason's save meets the minute's limit when its field loses focus: the words stand under the field, and the text stays.
    fixtures.state.refuseNextSave = "rate_limited";
    await composer.getByLabel("Reason", { exact: true }).press("Tab");
    await shown(composer.getByRole("alert").filter({ hasText: NOTE_WORDS.rate_limited }));
    expect(requests("POST", "/texts")).toEqual([201, 429]);
    expect(await composer.getByLabel("Reason", { exact: true }).inputValue()).toBe(REASON);
    expect(await confirm.isDisabled()).toBe(false);
    await clean();

    // Another staff member withholds the post while this page still shows the case as it read it.
    fixtures.decideBehindThePage(CASE_CHANGED);
    const read = requests("GET", "").length;
    await confirm.click();
    // The confirmation saved the reason, the key signed the decision the page showed, and the API refused it: in place.
    await shown(composer.getByRole("alert").filter({ hasText: messageFor("case_changed") }));
    expect(requests("POST", "/texts")).toEqual([201, 429, 201]);
    expect(await signatures()).toBe(before + 1);
    expect(requests("POST", "/decisions")).toEqual([409]);
    expect(fixtures.state.decisions.filter((made) => made.caseId === CASE_CHANGED)).toEqual([]);
    // The page read the case again, once: the other decision is on it, and the composer follows the case as it now stands.
    await arrived(() => requests("GET", "").length === read + 1, "the case read again");
    await shown(page.getByText("; version 2", { exact: false }));
    expect(await texts()).toContain(OTHER_STAFF);
    // The case hides the post now: a second withhold of the post is not offered, and the image measure changes nothing now.
    await shown(composer.getByText(COMPOSER.alreadyHidden));
    expect(await composer.getByLabel(MEASURES.withhold.label, { exact: true }).count()).toBe(0);
    await shown(composer.getByText(COMPOSER.noEffect));
    expect(await composer.locator(".frame.preview p.frame-text").first().textContent()).toBe(`${STATEMENT_WORDS.done.withhold_media("2026-09-30 12:00 UTC")} ${STATEMENT_WORDS.already("image")}`);
    // The refusal's words stay, the reason's own refusal is gone now that it is saved, and the draft is as its person left it.
    await shown(composer.getByRole("alert").filter({ hasText: messageFor("case_changed") }));
    expect(await composer.getByRole("alert").filter({ hasText: NOTE_WORDS.rate_limited }).count()).toBe(0);
    expect(await composer.getByLabel("Facts").inputValue()).toBe(TYPED_CHANGED_FACTS);
    expect(await composer.getByLabel("Reason", { exact: true }).inputValue()).toBe(REASON);
    expect(await composer.getByLabel(MEASURES.withhold_media.label, { exact: true }).isChecked()).toBe(true);
    expect(requests("GET", "")).toHaveLength(read + 1);
    await clean();

    // Confirmed again, on the version the page now shows: the texts are used as they were saved.
    await confirm.click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 2);
    expect(requests("POST", "/texts")).toEqual([201, 429, 201]);
    expect(requests("POST", "/decisions")).toEqual([409, 201]);
    const mine = fixtures.state.texts.filter((text) => text.caseId === CASE_CHANGED);
    expect(mine.map((text) => [text.kind, text.text])).toEqual([
      ["facts", TYPED_CHANGED_FACTS],
      ["reason", REASON],
    ]);
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_CHANGED,
      params: { kind: "interim", stateVersion: 2, throughSeq: 0, outcome: "restricted", ground: "incompatible", ruleId: "R1", actions: [{ kind: "withhold_media", mediaId: IMAGE_ONE }], factsDigest: mine[0]!.digest, reasonDigest: mine[1]!.digest, legalReferenceDigest: null },
    });
    await shown(page.getByText("; version 3", { exact: false }));
    expect(await page.getByRole("region", { name: "Decide" }).getByRole("alert").count()).toBe(0);
    expect(await texts()).toContain(TYPED_CHANGED_FACTS);
    await clean();
  });

  test("a draft's texts come back after a reload: each was saved when its field lost focus, a refused save is worded under its field with the text kept, a saved text is restored with its digest, one answered with other words under its digest is dropped, and the decision names the text saved before the reload", async () => {
    const [before, options] = [await signatures(), fixtures.state.stepUpOptionsServed];
    const QUOTING = 'The reporter wrote "this account spams one link everywhere".';
    const REASON = "The post repeats one link, which the rule names.";
    const saves = () => fixtures.state.requests.filter((r) => r.method === "POST" && r.path === `/api/staff/cases/${CASE_DRAFTS}/texts`).map((r) => r.status);
    const mine = () => fixtures.state.texts.filter((text) => text.caseId === CASE_DRAFTS);
    await page.goto(`${origin}/cases/${CASE_DRAFTS}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    const composer = page.getByRole("region", { name: "Decide" });
    await composer.getByLabel("Facts").fill(TYPED_DRAFT_FACTS);
    await composer.getByLabel("Facts").press("Tab");
    await arrived(() => mine().length === 1, "the facts saved when their field lost focus");
    expect(mine()[0]).toMatchObject({ kind: "facts", text: TYPED_DRAFT_FACTS });
    // A text that quotes what someone wrote about the case is refused where it was written, and nothing of it is lost.
    fixtures.state.refuseNextSave = "text_quotes_user";
    await composer.getByLabel("Reason", { exact: true }).fill(QUOTING);
    await composer.getByLabel("Reason", { exact: true }).press("Tab");
    await shown(composer.getByRole("alert").filter({ hasText: messageFor("text_quotes_user") }));
    expect(await composer.getByLabel("Reason", { exact: true }).inputValue()).toBe(QUOTING);
    expect(saves()).toEqual([201, 422]);
    expect(mine()).toHaveLength(1);
    // Written again in the person's own words, the refusal's words go, and the text is saved when its field loses focus.
    await composer.getByLabel("Reason", { exact: true }).fill(REASON);
    await composer.getByRole("alert").waitFor({ state: "detached" });
    await composer.getByLabel("Reason", { exact: true }).press("Tab");
    await arrived(() => mine().length === 2, "the reason saved when its field lost focus");
    expect(mine()[1]).toMatchObject({ kind: "reason", text: REASON });
    // No key was asked for any of it.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.stepUpOptionsServed).toBe(options);
    await clean();

    // A reload before any confirmation: the case's answer brings the saved texts back. This one answers the reason with
    // other words under the digest of what was saved: the page holds each text to its digest, and drops that one.
    fixtures.state.forgedDraft = { caseId: CASE_DRAFTS, kind: "reason" };
    await page.goto(`${origin}/cases/${CASE_DRAFTS}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    const again = page.getByRole("region", { name: "Decide" });
    await shown(again);
    expect(await again.getByLabel("Facts").inputValue()).toBe(TYPED_DRAFT_FACTS);
    expect(await again.getByLabel("Reason", { exact: true }).inputValue()).toBe("");
    expect(await page.content()).not.toContain(FORGED_DRAFT);
    expect(saves()).toEqual([201, 422, 201]);
    await clean();

    // A measure and a reason later the key confirms the decision. The click that confirms takes the focus from the
    // reason's field: that save ends first, the confirmation saves nothing, and the facts are the ones saved before the reload.
    await again.getByLabel(MEASURES.withhold.label, { exact: true }).check();
    await again.getByLabel("Reason", { exact: true }).fill(REASON);
    await again.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 1);
    expect(saves()).toEqual([201, 422, 201, 201]);
    expect(mine().map((text) => text.kind)).toEqual(["facts", "reason", "reason"]);
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_DRAFTS,
      params: { kind: "interim", stateVersion: 1, throughSeq: 0, outcome: "restricted", ground: "incompatible", ruleId: "R1", actions: [{ kind: "withhold", mediaId: null }], factsDigest: mine()[0]!.digest, reasonDigest: mine()[2]!.digest, legalReferenceDigest: null },
    });
    fixtures.state.forgedDraft = null;
    expect(await texts()).toContain(TYPED_DRAFT_FACTS);
    await clean();
  });

  test("home lists, for every staff member, the decisions that lifted the protection of reported images, the choices not to seal and the seals taken while deciding, each with its staff handle as text and its case", async () => {
    await page.getByRole("link", { name: "Home" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    await shown(page.getByRole("heading", { name: "Protection of reported images lifted in the last 30 days" }));
    const lists = page.locator("ul.reveals");
    await shown(lists.nth(3));
    // The reveals' list, then the three of the path, in the order the screen names them.
    expect(await lists.count()).toBe(4);
    expect(await lists.nth(1).locator("li").innerText()).toContain(PROTECTION_LIFTED_WORDS.dismissed);
    expect(await lists.nth(1).locator("a").getAttribute("href")).toBe(`/cases/${CASE_FROZEN}`);
    // Two choices not to seal: the one the fixtures hold on the frozen case, and the one the walk recorded.
    expect(await lists.nth(2).locator("li").allInnerTexts()).toEqual([expect.stringContaining("Chose not to seal"), expect.stringContaining("Chose not to seal")]);
    expect(await page.evaluate(`[...document.querySelectorAll("ul.reveals")[2].querySelectorAll("a")].map((link) => link.getAttribute("href"))`)).toEqual([`/cases/${CASE_FROZEN}`, `/cases/${CASE_DECLINE}`]);
    // The reason of a choice not to seal is on its case, never here.
    expect(await page.locator("#root").innerText()).not.toContain(TYPED_DECLINE);
    expect(await lists.nth(3).locator("li").innerText()).toContain("3 images on 2 posts");
    expect(await lists.nth(3).locator("a").getAttribute("href")).toBe(`/cases/${CASE_SEALABLE}`);
    const shownTexts = await texts();
    for (const text of [PERSON_HANDLE, HOSTILE.img]) expect(shownTexts, text).toContain(text);
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await clean();
  });

  test("the appeals screen: the appeals that wait, each with its decision, the end of its appeal window and whether this person may review it, its case as its only link, and no statement", async () => {
    await page.getByRole("link", { name: "Appeals" }).click();
    await shown(page.getByRole("heading", { name: "Appeals" }));
    const rows = page.locator("table.queue tbody tr");
    await shown(rows.first());
    expect(await rows.count()).toBe(2);
    // The newest first: an appeal of a seal, which only an admin reviews, and which nobody at korbat can review now.
    const sealed = await rows.nth(0).innerText();
    for (const words of [MEASURES.seal_media.label, "under R2", APPEAL_WORDS.mayNotReview, APPEAL_WORDS.needsAdmin, APPEAL_WORDS.reviewer.none_single_staff]) expect(sealed, words).toContain(words);
    // Then the appeal of the removal another staff member decided: this person may review it.
    const removal = await rows.nth(1).innerText();
    for (const words of [MEASURES.remove.label, "under R1", APPEAL_WORDS.mayReview]) expect(removal, words).toContain(words);
    expect(removal).not.toContain(APPEAL_WORDS.needsAdmin);
    // Each row's only link is its case in the console, and the list holds nothing the appellant wrote.
    expect(await page.evaluate(`[...document.querySelectorAll("table.queue a")].map((link) => link.getAttribute("href"))`)).toEqual([`/cases/${CASE_FROZEN}`, `/cases/${CASE_APPEALED}`]);
    expect(await page.locator("main").innerText()).not.toContain(HOSTILE.img);
    await shown(page.getByText(APPEAL_WORDS.statementOnCase, { exact: false }));
    await texts();
    await clean();
  });

  test("a review with the key: the appellant's statement as text on the case, Keep, Reverse in part and Reverse, the reason saved as a review reason, the preview the review's statement, the key confirming exactly that review, and the appeal answered", async () => {
    await page.locator("table.queue tbody tr").nth(1).getByRole("link", { name: "Open the case" }).click();
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    await shown(page.getByText("not answered yet", { exact: false }));
    // What the appellant wrote is text in a frame of its own.
    expect(await texts()).toContain(HOSTILE.img);
    const before = await signatures();
    const decisionsBefore = fixtures.state.decisions.length;
    await page.getByRole("button", { name: APPEAL_WORDS.reviewLabel }).click();
    const review = page.getByRole("region", { name: COMPOSER.reviewLabel });
    await shown(review);
    const confirm = review.getByRole("button", { name: "Confirm with your staff key" });
    // "Keep" is chosen and lifts nothing; nothing is confirmed without a reason.
    expect(await review.getByLabel(REVIEW_OUTCOMES.kept, { exact: true }).isChecked()).toBe(true);
    expect(await confirm.isDisabled()).toBe(true);
    await review.getByLabel("Reason of the review").fill(TYPED_REVIEW_REASON);
    expect(await confirm.isDisabled()).toBe(false);
    // A decision with one measure cannot be reversed in part: whatever is ticked, the answer does not stand.
    await review.getByLabel(REVIEW_OUTCOMES.partly_reversed, { exact: true }).check();
    expect(await confirm.isDisabled()).toBe(true);
    await review.getByLabel(MEASURES.restore.label).check();
    expect(await confirm.isDisabled()).toBe(true);
    // "Reverse" lifts everything that is still in force, and says so by its ticked box.
    await review.getByLabel(REVIEW_OUTCOMES.reversed, { exact: true }).check();
    expect(await review.getByLabel(MEASURES.restore.label).isChecked()).toBe(true);
    expect(await confirm.isDisabled()).toBe(false);
    // The preview is the statement its author will receive: the review's lead, and what was typed as its reason.
    const preview = review.locator(".frame.preview p.frame-text");
    expect(await preview.first().textContent()).toBe(STATEMENT_WORDS.reviewed("2026-10-01 09:00 UTC", "reversed"));
    expect(await preview.allTextContents()).toContain(`Why korbat changed it: ${TYPED_REVIEW_REASON}`);
    expect(await inspect(page)).toEqual([]);
    await confirm.click();
    await shown(page.getByText(COMPOSER.reviewed));
    expect(await signatures()).toBe(before + 1);
    const reason = fixtures.state.texts.at(-1)!;
    expect(reason).toMatchObject({ caseId: CASE_APPEALED, kind: "review_reason", text: TYPED_REVIEW_REASON });
    // What the key confirmed is the review the page showed: of that decision, answering that appeal, with that reversal
    // and the digest of the saved reason. No decision on the case was sent in its place.
    expect(fixtures.state.reviews).toHaveLength(1);
    expect(fixtures.state.reviews[0]).toMatchObject({
      decisionId: DECISION_APPEALED,
      params: { stateVersion: 3, appealId: APPEAL_ONE, outcome: "reversed", rulesVersion: 2, actions: [{ kind: "restore", mediaId: null }], reasonDigest: reason.digest },
    });
    expect(fixtures.state.decisions).toHaveLength(decisionsBefore);
    // The case as the answer gave it: the next version, the removal lifted, the appeal answered, and nothing left to review.
    await shown(page.getByText("version 4", { exact: false }));
    await shown(page.getByText("answered: reversed", { exact: false }));
    await shown(page.getByText(`${MEASURES.remove.label}: lifted by the decision of`, { exact: false }));
    expect(await page.getByRole("button", { name: APPEAL_WORDS.reviewLabel }).count()).toBe(0);
    expect(await texts()).toContain(TYPED_REVIEW_REASON);
    // The appeals screen no longer lists it.
    await page.getByRole("link", { name: "Appeals" }).click();
    await shown(page.locator("table.queue tbody tr").first());
    expect(await page.locator("table.queue tbody tr").count()).toBe(1);
    await clean();
  });

  // ---------------------------------------------------------------- 3e, Task 1 (design, section 8.10)

  test("a post decision signs the strike the case answer says is due: the author's standing in bands above the evidence, the strike line under Restrict, the preview's strike, and the key confirming the removal with its strike", async () => {
    const before = await signatures();
    await page.goto(`${origin}/cases/${CASE_STRIKE}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    // The author's standing, in bands, above the evidence, and why it is shown.
    const standing = page.getByRole("region", { name: "The author's standing" });
    await shown(standing);
    for (const words of [STANDING_WORDS.bands.activeStrikes["2"], STANDING_WORDS.bands.suspensionsInYear["1"], STANDING_WORDS.bands.now.none, STANDING_WORDS.postStanding]) await shown(standing.getByText(words, { exact: true }));
    const composer = page.getByRole("region", { name: "Decide" });
    const confirm = composer.getByRole("button", { name: "Confirm with your staff key" });
    // While deciding no strike is given; deciding the case under the report's rule gives one, which is no choice.
    await shown(composer.getByText(STANDING_WORDS.strike.none.interim, { exact: true }));
    await composer.getByLabel(COMPOSER_KINDS.final).check();
    await shown(composer.getByText(STANDING_WORDS.strike.due, { exact: true }));
    expect(await composer.getByText(STANDING_WORDS.strike.none.interim, { exact: true }).count()).toBe(0);
    expect(await composer.getByLabel(MEASURES.strike.label, { exact: true }).count()).toBe(0);
    await composer.getByLabel(MEASURES.remove.label, { exact: true }).check();
    await composer.getByLabel("Facts").fill(STRIKE_FACTS);
    await composer.getByLabel("Reason", { exact: true }).fill("It sells followers, which the rule names.");
    await composer.getByLabel("Reason", { exact: true }).press("Tab");
    await arrived(() => fixtures.state.texts.filter((text) => text.caseId === CASE_STRIKE).length === 2, "both texts saved when their fields lost focus");
    // The preview tells the strike as its author will read it: the third active strike, the band's two and this one.
    const preview = composer.locator(".frame.preview p.frame-text");
    const told = (await preview.allTextContents()).join(" ");
    expect(told).toContain("This decision gives your account a strike.");
    expect(told).toContain("With it your account had 3 active strikes when this was decided.");
    expect(await preview.allTextContents()).toContain(STATEMENT_WORDS.automationStrike);
    expect(await inspect(page)).toEqual([]);
    await confirm.click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 1);
    // What the key confirmed: the removal and the strike, which the page added because the answer said it was due.
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_STRIKE,
      params: { kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R1", actions: [{ kind: "remove", mediaId: null }, { kind: "strike", mediaId: null }], unfounded: [], replaced: false },
    });
    // The case as the answer gave it: the strike in force with the day it stops counting, and the band one higher.
    await shown(page.getByText(`${MEASURES.strike.label}: in force; counts until`, { exact: false }));
    await shown(standing.getByText(STANDING_WORDS.bands.activeStrikes["3_or_more"], { exact: true }));
    await texts();
    await clean();
  });

  test("a review that reverses a decision whose strike carries a suspension: [review.strike] and [review.rests] beside the reversals, the overruling the page adds to Reverse, and the strike lifted", async () => {
    // The case is put in place by this run, so that the appeals listed before it stay as they were.
    fixtures.state.cases.set(CASE_STRUCK, struckCase());
    const before = await signatures();
    const reviews = fixtures.state.reviews.length;
    await page.goto(`${origin}/cases/${CASE_STRUCK}`);
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    await shown(page.getByText(`${MEASURES.strike.label}: in force; counts until`, { exact: false }));
    await page.getByRole("button", { name: APPEAL_WORDS.reviewLabel }).click();
    const review = page.getByRole("region", { name: COMPOSER.reviewLabel });
    await shown(review);
    // The strike is never offered on its own; the two sentences say what reversing this decision does to it.
    await shown(review.getByText(STANDING_WORDS.reviewStrike, { exact: true }));
    await shown(review.getByText(STANDING_WORDS.reviewRests, { exact: true }));
    expect(await review.getByLabel(MEASURES.overrule.label, { exact: true }).count()).toBe(0);
    const confirm = review.getByRole("button", { name: "Confirm with your staff key" });
    await review.getByLabel("Reason of the review").fill(OVERRULE_REASON);
    await review.getByLabel(REVIEW_OUTCOMES.reversed, { exact: true }).check();
    expect(await review.getByLabel(MEASURES.restore.label).isChecked()).toBe(true);
    expect(await confirm.isDisabled()).toBe(false);
    // The preview tells the overruling with the restoration.
    expect(await review.locator(".frame.preview p.frame-text").allTextContents()).toContain(STATEMENT_WORDS.overruled);
    expect(await inspect(page)).toEqual([]);
    await confirm.click();
    await shown(page.getByText(COMPOSER.reviewed));
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.reviews).toHaveLength(reviews + 1);
    expect(fixtures.state.reviews.at(-1)).toMatchObject({
      decisionId: DECISION_STRUCK,
      params: { appealId: APPEAL_STRUCK, outcome: "reversed", rulesVersion: 3, actions: [{ kind: "overrule", mediaId: null }, { kind: "restore", mediaId: null }] },
    });
    // The answer: the removal and the strike lifted by the review.
    await shown(page.getByText(`${MEASURES.remove.label}: lifted by the decision of`, { exact: false }));
    await shown(page.getByText(`${MEASURES.strike.label}: lifted by the decision of`, { exact: false }));
    expect(await texts()).toContain(HOSTILE.script);
    await clean();
  });

  test("3e: a suspension at once offered to an admin: the four grounds marked met or not, the protective one greyed with [atOnce.noSeal], the drafted facts, the preview, and the key confirming the suspension with its days and announced false", async () => {
    // The case is put in place by this run, so that the queue and the appeals listed before it stay as they were.
    fixtures.state.cases.set(CASE_AT_ONCE, atOnceCase());
    fixtures.state.role = "admin";
    try {
      const before = await signatures();
      await page.goto(`${origin}/cases/${CASE_AT_ONCE}`);
      await shown(page.getByRole("heading", { name: "Case about an account" }));
      const composer = page.getByRole("region", { name: "Decide" });
      await composer.getByLabel(COMPOSER_KINDS.final).check();
      const control = composer.getByLabel(STANDING_WORDS.atOnce.label, { exact: true });
      await shown(control);
      expect(await control.isDisabled()).toBe(false);
      await shown(composer.getByText(STANDING_WORDS.atOnce.what, { exact: true }));
      // The four grounds, two met now and two not: the protective one says why it is not.
      expect(await composer.locator(".grounds strong").allTextContents()).toEqual([STANDING_WORDS.atOnce.met, STANDING_WORDS.atOnce.unmet, STANDING_WORDS.atOnce.met, STANDING_WORDS.atOnce.unmet]);
      await shown(composer.getByText(STANDING_WORDS.atOnce.threat, { exact: true }));
      await shown(composer.getByText(STANDING_WORDS.atOnce.noSeal, { exact: true }));
      await control.check();
      const days = composer.getByLabel(STANDING_WORDS.atOnce.days(30));
      await days.fill("10");
      expect(await composer.getByLabel("Facts").inputValue()).toBe("A final decision of korbat found a direct threat of violence in a post of this account.");
      await composer.getByLabel("Facts").press("Tab");
      await composer.getByLabel("Reason", { exact: true }).fill("The threat names a place and a time.");
      await composer.getByLabel("Reason", { exact: true }).press("Tab");
      await arrived(() => fixtures.state.texts.filter((text) => text.caseId === CASE_AT_ONCE).length === 2, "both texts saved when their fields lost focus");
      const told = (await composer.locator(".frame.preview p.frame-text").allTextContents()).join(" ");
      expect(told).toContain("korbat suspended your account for 10 days, from this decision until");
      expect(told).toContain(STATEMENT_WORDS.basis.threat("2026-10-10 08:00 UTC"));
      await shown(composer.getByText(STANDING_WORDS.previewTimes, { exact: true }));
      expect(await inspect(page)).toEqual([]);
      await composer.getByRole("button", { name: "Confirm with your staff key" }).click();
      await shown(page.getByText(COMPOSER.recorded));
      expect(await signatures()).toBe(before + 1);
      expect(fixtures.state.decisions.at(-1)).toMatchObject({
        caseId: CASE_AT_ONCE,
        params: { kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R5", actions: [{ kind: "suspend", mediaId: null, days: 10, announced: false }], unfounded: [], replaced: false },
      });
      await texts();
      await clean();
    } finally {
      fixtures.state.role = "moderator";
    }
  });

  test("3e: a suspension at once greyed for a moderator with [atOnce.admin], its grounds still listed, and nothing signed", async () => {
    const id = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
    fixtures.state.cases.set(id, { ...atOnceCase({}, "R6"), id });
    const decided = fixtures.state.decisions.length;
    await page.goto(`${origin}/cases/${id}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    const composer = page.getByRole("region", { name: "Decide" });
    await composer.getByLabel(COMPOSER_KINDS.final).check();
    await composer.getByLabel("Rule").selectOption("R6");
    const control = composer.getByLabel(STANDING_WORDS.atOnce.label, { exact: true });
    await shown(control);
    expect(await control.isDisabled()).toBe(true);
    await shown(composer.getByText(STANDING_WORDS.atOnce.admin, { exact: true }));
    expect(await composer.locator(".grounds li").count()).toBe(4);
    expect(await inspect(page)).toEqual([]);
    expect(fixtures.state.decisions).toHaveLength(decided);
    await texts();
    await clean();
  });

  test("3e Task 4: an announced suspension on an account case, offered to a moderator with the rung's days, its options binding days and announced; and the same case greyed with [reports.first] while it holds a report that waits", async () => {
    // A report waits in the case: the announced measures are greyed, and say why.
    fixtures.state.cases.set(CASE_LADDER, ladderCase(true));
    await page.goto(`${origin}/cases/${CASE_LADDER}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    let composer = page.getByRole("region", { name: "Decide" });
    await composer.getByLabel(COMPOSER_KINDS.final).check();
    const greyed = composer.getByLabel(STANDING_WORDS.suspend.label, { exact: true });
    await shown(greyed);
    expect(await greyed.isDisabled()).toBe(true);
    await shown(composer.getByText(STANDING_WORDS.reportsFirst, { exact: true }).first());
    expect(await inspect(page)).toEqual([]);

    // The case once its reports are decided: the moderator announces 2 days of the rung's 3, under the newest strike's rule.
    fixtures.state.cases.set(CASE_LADDER, ladderCase(false));
    const before = await signatures();
    await page.goto(`${origin}/cases/${CASE_LADDER}`);
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    composer = page.getByRole("region", { name: "Decide" });
    await composer.getByLabel(COMPOSER_KINDS.final).check();
    const control = composer.getByLabel(STANDING_WORDS.suspend.label, { exact: true });
    await shown(control);
    expect(await control.isDisabled()).toBe(false);
    await control.check();
    await shown(composer.getByText(STANDING_WORDS.suspend.days(3, 1), { exact: true }));
    await shown(composer.getByText(STANDING_WORDS.suspend.rule("R1"), { exact: true }));
    const days = composer.getByLabel(STANDING_WORDS.suspend.daysLabel(3));
    await days.fill("2");
    await shown(composer.getByText(STANDING_WORDS.suspend.what(2), { exact: true }));
    expect(await composer.getByLabel("Facts").inputValue()).toBe("When this was written the account had 3 active strikes. Each was given by a decision that found a breach of a korbat rule in a post, and each of those decisions was sent to the account with its reasons.");
    await composer.getByLabel("Facts").press("Tab");
    await composer.getByLabel("Reason", { exact: true }).fill(`Three strikes in two weeks ${HOSTILE.quote}`);
    await composer.getByLabel("Reason", { exact: true }).press("Tab");
    await arrived(() => fixtures.state.texts.filter((text) => text.caseId === CASE_LADDER).length === 2, "both texts saved when their fields lost focus");
    const told = (await composer.locator(".frame.preview p.frame-text").allTextContents()).join(" ");
    expect(told).toContain("korbat will suspend your account for 2 days. Nothing is restricted yet. It rests on the active strikes of your account:");
    expect(told).toContain("This rests on korbat's terms, section Suspension and termination");
    expect(told).not.toMatch(/It breaks korbat rule/);
    expect(await inspect(page)).toEqual([]);
    await composer.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_LADDER,
      params: { kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R1", actions: [{ kind: "suspend", mediaId: null, days: 2, announced: true }], unfounded: [], replaced: false },
    });
    await texts();
    await clean();
  });

  test("3e Task 4: the queue's Replies to answer, without the reply's text; the reply read on its case as text; and answered Keep, which signs a kept correction with nothing lifted", async () => {
    fixtures.state.cases.set(CASE_REPLIED, repliedCase());
    await page.goto(`${origin}/queue`);
    await shown(page.getByRole("heading", { name: STANDING_WORDS.reply.title }));
    const row = page.locator("ul.replies li").first();
    await shown(row);
    expect(await row.textContent()).toContain(STANDING_WORDS.reply.before);
    expect(await row.textContent()).toContain(STANDING_WORDS.reply.suspension(3));
    // The queue never carries the reply's words: they are read on the case page, whose read is logged.
    expect(await page.getByText(REPLY_TEXT, { exact: false }).count()).toBe(0);
    await row.getByRole("link", { name: "Open the case" }).click();
    await shown(page.getByRole("heading", { name: "Case about an account" }));
    const block = page.getByRole("group", { name: STANDING_WORDS.reply.blockTitle });
    await shown(block);
    await shown(block.getByText(STANDING_WORDS.reply.onTime, { exact: true }));
    expect(await texts()).toContain(REPLY_TEXT);
    const before = await signatures();
    await block.getByRole("button", { name: STANDING_WORDS.reply.answerLabel }).click();
    const answer = page.getByRole("region", { name: STANDING_WORDS.reply.answerLabel });
    await shown(answer);
    expect(await answer.getByLabel(STANDING_WORDS.reply.keepLabel, { exact: true }).isChecked()).toBe(true);
    await shown(answer.getByText(STANDING_WORDS.reply.same, { exact: true }));
    await answer.getByLabel("Reason of the answer").fill(`Your reply did not change the strikes ${HOSTILE.img}`);
    await answer.getByLabel("Reason of the answer").press("Tab");
    const told = (await answer.locator(".frame.preview p.frame-text").allTextContents()).join(" ");
    expect(told).toContain("and keeps that decision. The suspension of 3 days starts at");
    expect(await inspect(page)).toEqual([]);
    await answer.getByRole("button", { name: "Confirm with your staff key" }).click();
    await shown(page.getByText(COMPOSER.recorded));
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.decisions.at(-1)).toMatchObject({
      caseId: CASE_REPLIED,
      params: { kind: "correction", outcome: "kept", reviewsDecisionId: DECISION_REPLIED, actions: [], unfounded: [], replaced: false },
    });
    // The case as the answer leaves it: the reply answered, and nothing to answer any more.
    await shown(page.getByRole("group", { name: STANDING_WORDS.reply.blockTitle }).getByText("Answered on", { exact: false }));
    expect(await page.getByRole("button", { name: STANDING_WORDS.reply.answerLabel }).count()).toBe(0);
    await texts();
    await clean();
  });

  test("3e Task 4: Withdraw it for another measure on an announced suspension that has not started, for an admin while the account's case shows [conflict]: a correction with the lift signed replaced", async () => {
    fixtures.state.cases.set(CASE_WITHDRAW, withdrawCase());
    fixtures.state.role = "admin";
    try {
      const before = await signatures();
      await page.goto(`${origin}/cases/${CASE_WITHDRAW}`);
      await shown(page.getByRole("heading", { name: "Case about an account" }));
      const composer = page.getByRole("region", { name: "Decide" });
      await composer.getByLabel(COMPOSER_KINDS.final).check();
      await shown(composer.getByText(STANDING_WORDS.conflict, { exact: true }).first());
      await page.getByRole("button", { name: STANDING_WORDS.replace.label }).click();
      const withdraw = page.getByRole("region", { name: STANDING_WORDS.replace.label });
      await shown(withdraw);
      await shown(withdraw.getByText(STANDING_WORDS.replace.what, { exact: true }));
      await withdraw.getByLabel("Reason of the withdrawal").fill("A threat since needs a suspension at once.");
      await withdraw.getByLabel("Reason of the withdrawal").press("Tab");
      const told = (await withdraw.locator(".frame.preview p.frame-text").allTextContents()).join(" ");
      expect(told).toContain("because it is taking another measure on your account.");
      expect(told).not.toContain("korbat corrected its decision");
      expect(await inspect(page)).toEqual([]);
      await withdraw.getByRole("button", { name: "Confirm with your staff key" }).click();
      await shown(page.getByText(COMPOSER.recorded));
      expect(await signatures()).toBe(before + 1);
      expect(fixtures.state.decisions.at(-1)).toMatchObject({
        caseId: CASE_WITHDRAW,
        params: { kind: "correction", outcome: "reversed", reviewsDecisionId: DECISION_WITHDRAW, actions: [{ kind: "lift_suspension", mediaId: null }], unfounded: [], replaced: true },
      });
      await texts();
      await clean();
    } finally {
      fixtures.state.role = "moderator";
    }
  });

  test("3e Task 4: the Standing screen's four lists, a hostile handle shown as text, and Open a case on this account, which opens the moderator's own finding on the account under the newest strike's rule", async () => {
    await page.getByRole("link", { name: "Standing" }).click();
    await shown(page.getByRole("heading", { name: STANDING_WORDS.lists.title }));
    for (const title of [STANDING_WORDS.lists.strikesTitle, STANDING_WORDS.lists.reportingTitle, STANDING_WORDS.lists.noticesTitle, STANDING_WORDS.lists.terminationsTitle]) await shown(page.getByRole("heading", { name: title }));
    await shown(page.getByText(STANDING_WORDS.lists.strikes, { exact: true }));
    await shown(page.getByText(STANDING_WORDS.lists.appealHolds, { exact: false }));
    expect(await texts()).toContain(STANDING_WORDS.lists.noticesRow(HOSTILE.script, "2026-10-01", "2026-10-15T09:00:00.000Z"));
    const findings = fixtures.state.findings.length;
    await page.getByRole("button", { name: STANDING_WORDS.lists.openCase }).first().click();
    await shown(page.getByRole("heading", { name: "Case about a post" }));
    expect(fixtures.state.findings).toHaveLength(findings + 1);
    expect(fixtures.state.findings.at(-1)).toEqual({ target: { kind: "account", handle: STANDING_HANDLE }, ground: "rule", ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" });
    await texts();
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
