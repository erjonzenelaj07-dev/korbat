/**
 * The page for a console that is off, or opened at another address (3a design, section 9). GET /api/staff/me answers
 * 404 in both cases, since the staff gate answers a wrong Host with the same 404 as a console that is off, so the page
 * cannot tell them apart and says both. It shows only this.
 */
export const UNAVAILABLE_TEXT =
  "The staff console is not available at this address. It is off on this server, or this is not the address set in CONSOLE_ORIGIN: open it at exactly that address, never at 127.0.0.1.";

export function Unavailable() {
  return (
    <main className="unavailable">
      <p>{UNAVAILABLE_TEXT}</p>
    </main>
  );
}
