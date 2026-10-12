import { useState } from "react";
import { mentionedAddresses, showHidden } from "./hidden";
import { UserText } from "./ui";

/**
 * Text from others (3c design, section 8). Every string a reporter, a notifier, an appellant or an author wrote is drawn
 * inside a frame that says who wrote it, never in a place where the console speaks for itself: a text made to look like
 * one of the console's own lines is then plainly someone's words. Each frame can show its hidden characters, and lists
 * the hosts of the web addresses the text mentions, as text, and says so for each address whose host it cannot read: the
 * console opens no address and links nowhere.
 */
export interface FrameViewProps {
  /** Who wrote it, in the console's own words: "Written by the author". */
  by: string;
  text: string;
  /** Set for a text that opens collapsed: the words of the button that shows it. */
  collapsedLabel?: string;
  open: boolean;
  hiddenShown: boolean;
  onOpen(): void;
  onToggleHidden(): void;
}

/** The console's words for an address in a text whose host it cannot read. */
const UNREAD_ADDRESS = "an address this console cannot read";

export function FrameView({ by, text, collapsedLabel, open, hiddenShown, onOpen, onToggleHidden }: FrameViewProps) {
  const { hosts, unread } = mentionedAddresses(text);
  // One mention for each address that could not be read, after the hosts that could; the first opens the line when
  // there is no host to list.
  const unreadWords = Array.from({ length: unread }, (_, index) => (index === 0 && hosts.length === 0 ? `Mentions ${UNREAD_ADDRESS}` : ` and ${UNREAD_ADDRESS}`)).join("");
  const collapsed = collapsedLabel !== undefined && !open;
  return (
    <div className="frame">
      <p className="frame-label">{by}</p>
      {collapsed ? (
        <button type="button" onClick={onOpen}>
          {collapsedLabel}
        </button>
      ) : (
        <>
          <p className="frame-text">
            <UserText>{hiddenShown ? showHidden(text) : text}</UserText>
          </p>
          {hosts.length > 0 || unread > 0 ? (
            <p className="hint">
              {hosts.length > 0 ? (
                <>
                  Mentions addresses at: <UserText>{hosts.join(", ")}</UserText>
                </>
              ) : null}
              {unreadWords}
            </p>
          ) : null}
          <button type="button" className="quiet-button" onClick={onToggleHidden} aria-pressed={hiddenShown}>
            {hiddenShown ? "Show the text as written" : "Show hidden characters"}
          </button>
        </>
      )}
    </div>
  );
}

/** A frame with its own two switches: shown or collapsed, and the hidden-characters view. */
export function Frame({ by, text, collapsedLabel }: { by: string; text: string; collapsedLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [hiddenShown, setHiddenShown] = useState(false);
  return <FrameView by={by} text={text} collapsedLabel={collapsedLabel} open={open} hiddenShown={hiddenShown} onOpen={() => setOpen(true)} onToggleHidden={() => setHiddenShown((shown) => !shown)} />;
}
