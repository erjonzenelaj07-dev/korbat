/**
 * What a text holds that the eye does not see (3c design, section 8, Text from others): the hidden-characters view of a
 * frame, and the hosts of the web addresses a text mentions. Both are pure, and both answer text: nothing here is ever a
 * link, and no address is ever opened.
 */

/** A character's code point as the view writes it: [U+202E]. */
const codePoint = (character: string): string => `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`;

/**
 * The text with every character outside printable ASCII drawn as its code point: a direction override, a zero-width
 * character or a letter of another script that looks like a Latin one then shows for what it is. A line feed stays a
 * line break, after its code point, so the text keeps its lines.
 */
export function showHidden(text: string): string {
  let shown = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) shown += character;
    else if (code === 0x0a) shown += `${codePoint(character)}\n`;
    else shown += codePoint(character);
  }
  return shown;
}

/** Whether a text holds a character the hidden-characters view would draw differently. */
export function hasHidden(text: string): boolean {
  return showHidden(text) !== text;
}

/**
 * The web addresses a text mentions: what follows http:// or https://, or begins with www., up to the first slash,
 * question mark or hash. `hosts` are the hosts the console could read, each once, in the order they appear; a name and
 * password before an at sign are left out, so an address made to look like another host's shows the host it really
 * names. `unread` counts the addresses whose host cannot be read at all, one made unreadable on purpose among them (a
 * direction override where the host ends): the frame says that they are there, since an address left out of the list
 * would look like no address.
 */
export function mentionedAddresses(text: string): { hosts: string[]; unread: number } {
  const hosts: string[] = [];
  let unread = 0;
  for (const match of text.matchAll(/(?:https?:\/\/|\bwww\.)[^\s<>"'`]+/gi)) {
    const address = /^https?:\/\//i.test(match[0]) ? match[0] : `http://${match[0]}`;
    let host = "";
    try {
      host = new URL(address).host;
    } catch {
      // No host can be read from it: counted below.
    }
    if (host === "") unread += 1;
    else if (!hosts.includes(host)) hosts.push(host);
  }
  return { hosts, unread };
}

/** The hosts alone: every host the console could read among the addresses a text mentions. The frame lists them as text. */
export const mentionedHosts = (text: string): string[] => mentionedAddresses(text).hosts;
