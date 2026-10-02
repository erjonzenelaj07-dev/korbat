import type { BrowserContext, CDPSession, Page } from "playwright-core";

/**
 * Every channel a policy report, a page error or a dialog can reach the check by (console-lab.md, section 2), watched for
 * the whole walk: the page's own securitypolicyviolation events, from a listener installed before any of the page's
 * scripts runs; any Trusted Types policy the page tries to create; Chromium's console, through Playwright and through the
 * CDP Log domain, whose source is "security" for CSP and Trusted Types messages; DevTools issues (the Audits domain), which
 * classify every CSP issue; page errors; dialogs, dismissed; failed requests; and any request that would leave the
 * console's origin, aborted. Everything found is a problem, listed with what it said.
 */

/**
 * Console errors the walk causes on purpose, which Chromium logs for every answer that is not a success: 400 (a refused
 * key at enrolment), 401 (no session, an ended session) and 404 (the console off). What the page then shows is checked
 * step by step, and a request the fixtures refuse for the page's own fault is one of their problems.
 */
const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of (400|401|404) /;
const POLICY_TEXT = /Content.Security.Policy|Trusted.?Type|require-trusted-types-for|Refused to/i;

/**
 * Runs in every page before its own scripts, outside its policy (Playwright adds it through CDP). It is plain text, so no
 * test runner's transform can put a helper into it that the page does not have. It reports through the binding below.
 */
const INIT_SCRIPT = `
(() => {
  const report = (kind, detail) => window.__korbatReport(kind, detail);
  document.addEventListener("securitypolicyviolation", (event) => {
    report("securitypolicyviolation", JSON.stringify({
      directive: event.effectiveDirective,
      blocked: event.blockedURI,
      sample: event.sample,
      source: event.sourceFile,
      line: event.lineNumber,
      disposition: event.disposition,
    }));
  }, true);
  // trusted-types 'none' already refuses every policy; this names any the page tries, should the header ever change.
  const factory = window.trustedTypes;
  if (factory && typeof factory.createPolicy === "function") {
    const create = factory.createPolicy.bind(factory);
    factory.createPolicy = (name, rules) => {
      report("a Trusted Types policy created", String(name));
      return create(name, rules);
    };
  }
})();
`;

export interface Watcher {
  /** The page's CDP session, which the walk also drives the virtual authenticator with. */
  cdp: CDPSession;
  /** The problems found since the last call, which it clears. */
  take(): string[];
}

export async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watcher> {
  let problems: string[] = [];
  const found = (text: string) => problems.push(text);

  // The binding is Playwright's, added through CDP, so the page's policy does not apply to it.
  await context.exposeBinding("__korbatReport", (_source, kind: string, detail: string) => found(`${kind}: ${detail}`));
  await context.addInitScript({ content: INIT_SCRIPT });

  const cdp = await context.newCDPSession(page);
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.source === "security" || POLICY_TEXT.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
    else if ((entry.level === "error" || entry.level === "warning") && !EXPECTED_HTTP_ERROR.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
  });
  await cdp.send("Log.enable");
  cdp.on("Audits.issueAdded", ({ issue }) => {
    if (issue.code === "ContentSecurityPolicyIssue") found(`DevTools CSP issue: ${JSON.stringify(issue.details.contentSecurityPolicyIssueDetails)}`);
  });
  await cdp.send("Audits.enable");

  page.on("console", (message) => {
    const text = message.text();
    if (POLICY_TEXT.test(text)) found(`console ${message.type()}: ${text}`);
    else if ((message.type() === "error" || message.type() === "warning") && !EXPECTED_HTTP_ERROR.test(text)) found(`console ${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => found(`page error: ${error.message}`));
  page.on("dialog", (dialog) => {
    found(`dialog (${dialog.type()}): ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "no reason";
    void request.response().then((response) => {
      // Chromium reports a 204 answer as aborted once it has arrived, since there is no body to read (the console's
      // sign-out and revocation). The answer did arrive; a request the policy blocks never gets one.
      if (reason === "net::ERR_ABORTED" && response?.status() === 204) return;
      found(`request failed: ${request.method()} ${request.url()} (${reason})`);
    });
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    found(`a request to another origin, aborted: ${url}`);
    return route.abort();
  });

  return {
    cdp,
    take() {
      const taken = problems;
      problems = [];
      return taken;
    },
  };
}

/**
 * What the page holds that the console never writes: an element that runs or loads something, an inline handler or
 * style, a link that is not one of the console's own paths, a form with an action, or a script other than the bundle.
 * Plain text, evaluated in the page, for the reason INIT_SCRIPT is.
 */
const INSPECT_SCRIPT = `
(() => {
  const out = [];
  const root = document.getElementById("root");
  if (!root) return ["the page has no #root"];
  for (const element of root.querySelectorAll("script, style, link, meta, base, iframe, frame, object, embed, img, svg, math, template, video, audio, source")) {
    out.push("a <" + element.tagName.toLowerCase() + "> element");
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on") || name === "srcdoc" || name === "style" || name === "src") out.push("a " + name + " attribute on <" + element.tagName.toLowerCase() + ">");
    }
  }
  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (href !== "/" && href !== "/audit" && href !== "/signin") out.push("a link to " + String(href));
  }
  for (const form of root.querySelectorAll("form")) {
    if (form.hasAttribute("action")) out.push("a form with an action: " + String(form.getAttribute("action")));
  }
  if (document.scripts.length !== 1) out.push(document.scripts.length + " script elements");
  return out;
})()
`;

export function inspect(page: Page): Promise<string[]> {
  return page.evaluate(INSPECT_SCRIPT) as Promise<string[]>;
}

/** The text of every element holding a string a person wrote (UserText's <bdi>) and of every <code> (actions, targets, hashes). */
export function userTexts(page: Page): Promise<string[]> {
  return page.evaluate(`[...document.querySelectorAll("bdi, code")].map((element) => element.textContent ?? "")`) as Promise<string[]>;
}
