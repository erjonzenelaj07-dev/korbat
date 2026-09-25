/**
 * Saving a response body as a file, for the account export (1b design, section 7.5). Browser globals
 * are typed locally, as lib/api.ts does, so this file does not depend on the DOM type library.
 */
const web = globalThis as unknown as {
  document?: {
    createElement(tag: string): { href: string; download: string; click(): void; remove(): void };
    body: { appendChild(node: unknown): unknown };
  };
};

const DEFAULT_FILENAME = "korbat-export.zip";

/**
 * The file name the API put in Content-Disposition (`attachment; filename="..."`). Only a name of the
 * API's own shape (letters, digits, dots, dashes; nothing that looks like a path) reaches the browser's
 * download prompt; anything else, or no header at all, gets the plain default.
 */
export function exportFilename(disposition: string | null): string {
  const name = /filename="([^"]*)"/.exec(disposition ?? "")?.[1] ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : DEFAULT_FILENAME;
}

/** Hands a blob to the browser as a download, through a temporary anchor with the `download` attribute. */
export function saveBlob(blob: Blob, filename: string): void {
  const doc = web.document;
  if (!doc) throw new Error("downloads need a browser");
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Firefox counts the click only for an anchor in the document; it leaves again at once.
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
