import { isLowerUuid, type CaseId } from "./router";

/**
 * Images in the console (3c design, sections 7.3 and 8). An image reaches the console only from the staff API on the
 * console's own origin, through the one route that decides whether staff may be served it at all, and only once its
 * person asks for it: first the small size, blurred and grey by a stylesheet class, then clearly. This is the only file
 * that writes a `src`, and it builds the address from two checked ids and one of two literal sizes, never from a text an
 * answer carried.
 */

declare const imageIdBrand: unique symbol;
/** An image's id that parseImageId has checked. */
export type ImageId = string & { readonly [imageIdBrand]: true };

/** The image's id when the text is a lower-case uuid; null for anything else, for which no image is ever asked. */
export function parseImageId(text: string): ImageId | null {
  return isLowerUuid(text) ? (text as ImageId) : null;
}

export type StaffImageSize = "small" | "large";

/** The address of a case's image on the staff API. */
export function staffImageSrc(caseId: CaseId, mediaId: ImageId, size: StaffImageSize): string {
  // The types say so already; an address is still never built from anything but two lower-case uuids and a known size.
  if (!isLowerUuid(caseId) || !isLowerUuid(mediaId) || (size !== "small" && size !== "large")) throw new Error("an image's address is built from checked ids only");
  return `/api/staff/cases/${caseId}/media/${mediaId}/${size}`;
}

/**
 * One image of a case's post, once its person asked to see it. `clear` is false until the second click: the image is
 * then drawn blurred and grey by the stylesheet. The alt text an author wrote is shown beside it, in its frame, never here.
 *
 * `onError` runs when the image did not load: the API refused it (the post was frozen or the image sealed since the page
 * read the case, or the session ended) or the request failed. The browser asks for an image itself, so the page learns of
 * a refusal only here; its caller then says so in the image's place and reads the case again.
 */
export function StaffImage({ caseId, mediaId, size, clear, onError }: { caseId: CaseId; mediaId: ImageId; size: StaffImageSize; clear: boolean; onError(): void }) {
  return <img className={clear ? "evidence" : "evidence blurred"} src={staffImageSrc(caseId, mediaId, size)} alt="An image of the reported post" onError={onError} />;
}
