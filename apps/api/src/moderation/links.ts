import { ModerationError } from "./context";

/**
 * korbat links (3c design, section 7.1, step 3). A report names things on korbat only: a post by its id, an account by
 * its handle, or the app's own address of either, which is parsed here. Nothing is ever fetched: a link to another site
 * is refused, never followed, so no moderator and no server opens an address a stranger chose.
 */

/** What a korbat link names. */
export type LinkTarget = { type: "post"; id: string } | { type: "account"; handle: string };

// The path's own words are the app's, in lower case only; the id's letters may be written in either case.
const POST_PATH = /^[/]post[/]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})[/]?$/;
const PROFILE_PATH = /^[/]u[/]([A-Za-z0-9_]{3,20})[/]?$/;

/**
 * Parses a link: it must be the app's address of a post (`/post/<id>`) or of a profile (`/u/<handle>`). Refused with
 * notice_link_offsite when it names another host, and with notice_link_invalid when it is no web address or names
 * another path. The host is compared with the app's, port included; the scheme is not, since a person may copy an
 * address from before the redirect to https. A query and a fragment are ignored. The id and the handle are answered in
 * lower case, as the database keeps them.
 */
export function parseLink(appOrigin: string, link: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new ModerationError("notice_link_invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ModerationError("notice_link_invalid");
  if (url.host !== new URL(appOrigin).host) throw new ModerationError("notice_link_offsite");
  // No korbat address carries a user name or a password.
  if (url.username !== "" || url.password !== "") throw new ModerationError("notice_link_invalid");
  const post = POST_PATH.exec(url.pathname);
  if (post) return { type: "post", id: post[1]!.toLowerCase() };
  const profile = PROFILE_PATH.exec(url.pathname);
  if (profile) return { type: "account", handle: profile[1]!.toLowerCase() };
  throw new ModerationError("notice_link_invalid");
}

/** The app's origin without a path, whatever final slash the setting was written with. */
const originOf = (appOrigin: string) => new URL(appOrigin).origin;

/** The app's address of a post. */
export const postLink = (appOrigin: string, postId: string): string => `${originOf(appOrigin)}/post/${postId}`;

/**
 * The app's address of an account under a handle. A report is shown back under the handle it named, never under the one
 * the profile holds now: no report may show its sender a later handle, since there is no redirect from a handle an
 * account has left either.
 */
export const accountLink = (appOrigin: string, handle: string): string => `${originOf(appOrigin)}/u/${handle}`;
