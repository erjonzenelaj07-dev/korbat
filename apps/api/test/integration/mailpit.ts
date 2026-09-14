/** Reads messages from the local Mailpit HTTP API (infra/compose.dev.yml). Test helper only. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:58025";

interface MessageSummary {
  ID: string;
  Subject: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Messages to one address, newest first. */
async function search(to: string): Promise<MessageSummary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const list = (await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)).json()) as { messages: MessageSummary[] };
  return list.messages;
}

async function messageText(id: string): Promise<{ subject: string; text: string }> {
  const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as { Subject: string; Text: string };
  return { subject: message.Subject, text: message.Text };
}

/** Waits up to ~5 seconds for the newest message to `to` and returns its plain-text body. */
export async function latestMessageTo(to: string): Promise<{ subject: string; text: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const newest = (await search(to))[0];
    if (newest) return messageText(newest.ID);
    await sleep(250);
  }
  throw new Error(`no email to ${to} arrived in Mailpit`);
}

/**
 * One address's mailbox that hands out each message once. Messages already there when the inbox is
 * opened are ignored.
 */
export async function inbox(to: string) {
  const seen = new Set((await search(to)).map((m) => m.ID));
  return {
    /**
     * Waits up to ~10 seconds for the newest message with this subject that has not been handed out,
     * returns its text, and marks it and every older message as seen.
     */
    async next(subject: string): Promise<string> {
      for (let attempt = 0; attempt < 40; attempt++) {
        const messages = await search(to);
        const index = messages.findIndex((m) => m.Subject === subject && !seen.has(m.ID));
        if (index !== -1) {
          for (const m of messages.slice(index)) seen.add(m.ID);
          return (await messageText(messages[index]!.ID)).text;
        }
        await sleep(250);
      }
      throw new Error(`no new "${subject}" email to ${to} arrived in Mailpit`);
    },
  };
}

export type Inbox = Awaited<ReturnType<typeof inbox>>;

/** The first 6-digit code in a message body. */
export function codeFrom(text: string): string {
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw new Error("no 6-digit code in message");
  return code;
}
