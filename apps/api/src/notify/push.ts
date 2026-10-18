import { renderAlert, type AlertFacts, type AlertKind, type AlertScope, type NotifyError } from "@korbat/contracts";

/**
 * The watcher's publisher (3f design, sections 5 and 7.1 step 5): one row of alert_outbox as one publish to ntfy, at
 * http://ntfy:2586/<topic> in the stack, with the publisher's token. The push is the title and the one sentence of the
 * row's kind in the contracts' ALERT_TEXTS, filled from the row's facts, which hold counts and UTC times only, so a lock
 * screen shows that an alert of a kind went out at a time and nothing else. The kind is the push's tag.
 */

/** The ntfy topic of each scope: the phone on call subscribes to the first, every staff phone to the second. */
export const TOPICS: Record<AlertScope, string> = { on_call: "korbat-oncall", all: "korbat-all" };

/** How long one publish may take before it counts as a failure to connect. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** A row still owed its push, as the watcher reads it. */
export interface OwedPush {
  id: number;
  kind: AlertKind;
  priority: 3 | 5;
  scope: AlertScope;
  facts: AlertFacts;
}

export type PublishOutcome = "ok" | Extract<NotifyError, "push_connect" | "push_refused">;

/**
 * Publishes one row: a 200 is "ok", any other answer push_refused, and a request that fails or does not finish in time
 * push_connect. Never throws.
 */
export async function publish(fetchFn: typeof fetch, baseUrl: string, token: string, row: OwedPush, now: Date): Promise<PublishOutcome> {
  let text: { title: string; sentence: string };
  try {
    text = renderAlert(row.kind, row.facts, now);
  } catch {
    // A row whose facts do not fill its words is never published with a hole in it.
    return "push_refused";
  }
  try {
    const res = await fetchFn(`${baseUrl}/${TOPICS[row.scope]}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-priority": String(row.priority),
        "x-tags": row.kind,
        "x-title": text.title,
        "content-type": "text/plain; charset=utf-8",
      },
      body: text.sentence,
      redirect: "error",
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    // The answer's body is ntfy's message as JSON; nothing in it is needed.
    await res.body?.cancel().catch(() => undefined);
    return res.status === 200 ? "ok" : "push_refused";
  } catch {
    return "push_connect";
  }
}
