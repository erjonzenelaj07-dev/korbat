import type { BrowserContext, CDPSession, Page } from "playwright-core";

/**
 * Every channel a policy report, an error, a warning or a dialog can reach the app's check by (UI design, section 12.3,
 * after apps/admin/test/browser/watch.ts), watched for the whole walk: the page's own securitypolicyviolation events, from
 * a listener installed before any of the page's scripts runs; Chromium's console, through Playwright and through the CDP
 * Log domain; DevTools issues for the policy; page errors; dialogs, dismissed; failed requests; and any request that
 * would leave the app's origin, aborted, but Turnstile's, which the walk answers itself with a stub. Everything found is
 * a problem, listed with what it said. The one error the app causes on purpose is /api/me's 401 for a reader who is
 * signed out, which Chromium logs as a failed resource.
 */
const POLICY_TEXT = /Content.Security.Policy|Trusted.?Type|require-trusted-types-for|Refused to/i;
const FAILED_RESOURCE = /^Failed to load resource: the server responded with a status of (\d+)/;

/** The origin of Turnstile's script and widget, which the walk serves from a stub (see app.browser.ts). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Whether a console line is /api/me's expected 401: Chromium logs it with the resource's address. */
function expectedHttpError(text: string, url: string | undefined): boolean {
  const status = FAILED_RESOURCE.exec(text)?.[1];
  return status === "401" && url !== undefined && new URL(url, "http://localhost").pathname === "/api/me";
}

/** Runs in every page before its own scripts, outside its policy (Playwright adds it through CDP), and reports through the binding. */
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
    }));
  }, true);
})();
`;

export interface Watcher {
  cdp: CDPSession;
  /** The problems found since the last call, which it clears. */
  take(): string[];
}

export async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watcher> {
  let problems: string[] = [];
  const found = (text: string) => problems.push(text);

  await context.exposeBinding("__korbatReport", (_source, kind: string, detail: string) => found(`${kind}: ${detail}`));
  await context.addInitScript({ content: INIT_SCRIPT });

  const cdp = await context.newCDPSession(page);
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.source === "security" || POLICY_TEXT.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
    else if ((entry.level === "error" || entry.level === "warning") && !expectedHttpError(entry.text, entry.url)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text} ${entry.url ?? ""}`);
  });
  await cdp.send("Log.enable");
  cdp.on("Audits.issueAdded", ({ issue }) => {
    if (issue.code === "ContentSecurityPolicyIssue") found(`DevTools CSP issue: ${JSON.stringify(issue.details.contentSecurityPolicyIssueDetails)}`);
  });
  await cdp.send("Audits.enable");

  page.on("console", (message) => {
    const text = message.text();
    if (POLICY_TEXT.test(text)) found(`console ${message.type()}: ${text}`);
    else if ((message.type() === "error" || message.type() === "warning") && !expectedHttpError(text, message.location().url)) found(`console ${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => found(`page error: ${error.message}`));
  page.on("dialog", (dialog) => {
    found(`dialog (${dialog.type()}): ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "no reason";
    void request.response().then((response) => {
      // Chromium reports a 204 answer as aborted once it has arrived, since there is no body to read. The answer did arrive.
      if (reason === "net::ERR_ABORTED" && response?.status() === 204) return;
      found(`request failed: ${request.method()} ${request.url()} (${reason})`);
    });
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.fallback();
    if (url.origin === TURNSTILE_ORIGIN) return route.fallback();
    found(`a request to another origin, aborted: ${url.href}`);
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
 * The app's rules at a phone's width (UI design, sections 4.4, 10 and 12.3), which every step at 360 px is held to: no
 * horizontal scroll, every control at least 44 by 44 px, except an `a` laid out inline in running text (a link in a post,
 * a mention, a link in a notice), which needs 24 by 24 px under WCAG 2.5.8, and an element clipped to 1 px by
 * VisuallyHidden, which is passed over until it holds the focus and then measured like any control (the skip link). A
 * control is an a, button, input, select, textarea or summary element, or anything with a control's role, that is shown.
 * Plain text, evaluated in the page, so no test runner's transform can put a helper into it.
 */
const PHONE_SCRIPT = `
((scope) => {
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) out.push("a horizontal scroll bar: the page is " + doc.scrollWidth + " px wide in " + doc.clientWidth);
  const shown = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const clipped = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.position === "absolute" && style.overflow === "hidden" && rect.width <= 1 && rect.height <= 1;
  };
  const selector = "a, button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem]";
  for (const element of document.querySelectorAll(selector)) {
    if (!shown(element)) continue;
    if (!element.closest(scope)) continue;
    if (clipped(element) && document.activeElement !== element) continue;
    let box = element.getBoundingClientRect();
    if (element.tagName === "INPUT" && (element.type === "radio" || element.type === "checkbox")) {
      const label = element.closest("label") || (element.id ? document.querySelector("label[for='" + element.id + "']") : null);
      if (label) {
        const other = label.getBoundingClientRect();
        box = { width: Math.max(box.right, other.right) - Math.min(box.left, other.left), height: Math.max(box.bottom, other.bottom) - Math.min(box.top, other.top) };
      }
    }
    const inline = element.tagName === "A" && getComputedStyle(element).display === "inline";
    const least = inline ? 24 : 44;
    if (box.width < least - 0.5 || box.height < least - 0.5) {
      const name = (element.getAttribute("aria-label") || element.textContent || element.getAttribute("name") || "").trim().slice(0, 40);
      out.push("a " + (inline ? "link in running text" : "control") + " smaller than " + least + " px: <" + element.tagName.toLowerCase() + "> " + name + " (" + Math.round(box.width) + " by " + Math.round(box.height) + ")");
    }
  }
  return out;
})
`;

/**
 * What the page breaks of the phone's rules, at the viewport it is shown in: the horizontal scroll of the whole page, and
 * the controls inside `scope` (a selector of the parts to measure, the whole body by default).
 */
export function phoneProblems(page: Page, scope = "body"): Promise<string[]> {
  return page.evaluate(`${PHONE_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;
}

/**
 * Labels that do not fit their box (UI design, sections 1.5 and 12.3): a control, a tab or a heading whose text is wider
 * or taller than the box shows it, which is where a longer language would break first. Labels wrap or grow; nothing is
 * cut. Plain text, evaluated in the page.
 */
const CLIPPED_SCRIPT = `
((scope) => {
  const out = [];
  const shown = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && getComputedStyle(element).visibility !== "hidden";
  };
  for (const element of document.querySelectorAll("a, button, [role=button], [role=tab], h1, h2, h3, label")) {
    if (!shown(element)) continue;
    if (!element.closest(scope)) continue;
    // An inline element has no box of its own to fit (clientWidth 0); its block does.
    if (getComputedStyle(element).display === "inline") continue;
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
      out.push("a clipped label: <" + element.tagName.toLowerCase() + "> " + (element.textContent || "").trim().slice(0, 40) + " (" + element.scrollWidth + " by " + element.scrollHeight + " in " + element.clientWidth + " by " + element.clientHeight + ")");
    }
  }
  return out;
})
`;

/** The labels inside `scope` (the whole body by default) whose text does not fit their box. */
export function clippedLabels(page: Page, scope = "body"): Promise<string[]> {
  return page.evaluate(`${CLIPPED_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;
}
