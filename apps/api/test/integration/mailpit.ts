/** Reads messages from the local Mailpit HTTP API (infra/compose.dev.yml). Test helper only. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:58025";

interface SearchResult {
  messages: { ID: string; Subject: string }[];
}

/** Waits up to ~5 seconds for the newest message to `to` and returns its plain-text body. */
export async function latestMessageTo(to: string): Promise<{ subject: string; text: string }> {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)).json()) as SearchResult;
    const newest = list.messages[0];
    if (newest) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)).json()) as { Subject: string; Text: string };
      return { subject: message.Subject, text: message.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no email to ${to} arrived in Mailpit`);
}

/** The first 6-digit code in a message body. */
export function codeFrom(text: string): string {
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw new Error("no 6-digit code in message");
  return code;
}
