import { describe, expect, test } from "vitest";
import { ModerationError } from "../src/moderation/context";
import { accountLink, orderLinkTarget, parseLink, postLink } from "../src/moderation/links";

/**
 * korbat links (3c design, section 7.1, step 3): the only thing a report may name besides an id or a handle. A link must
 * be the app's own address of a post or of a profile; anything else is refused with one of two codes, and nothing is
 * ever fetched or followed.
 */
const APP = "http://localhost:8081";
const POST = "0190f3a2-7c1e-7b1a-9f00-0123456789ab";

const refusal = (origin: string, url: string): string | null => {
  try {
    parseLink(origin, url);
    return null;
  } catch (err) {
    if (err instanceof ModerationError) return `${err.code} ${err.status}`;
    throw err;
  }
};

describe("parseLink", () => {
  test("a post's address names the post by its id, a profile's the account by its handle", () => {
    expect(parseLink(APP, `${APP}/post/${POST}`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/ada_99`)).toEqual({ type: "account", handle: "ada_99" });
  });

  test("hosts: only the app's own host and port; the scheme and the host's case do not matter, a port or a subdomain does", () => {
    expect(parseLink(APP, `HTTP://LOCALHOST:8081/post/${POST}`)).toEqual({ type: "post", id: POST });
    // Someone copies the address as their browser showed it before a redirect to https.
    expect(parseLink("https://korbat.example", `http://korbat.example/u/ada`)).toEqual({ type: "account", handle: "ada" });
    expect(parseLink("https://korbat.example", `https://KORBAT.example:443/u/ada`)).toEqual({ type: "account", handle: "ada" });
    for (const url of [
      `http://localhost:8082/post/${POST}`,
      `http://localhost/post/${POST}`,
      `https://elsewhere.example/post/${POST}`,
      `http://www.localhost:8081/post/${POST}`,
      `http://localhost.evil.example:8081/post/${POST}`,
      // The part before the @ is a user name; the host is what follows it.
      `http://localhost:8081@evil.example/post/${POST}`,
    ]) {
      expect(refusal(APP, url), url).toBe("notice_link_offsite 422");
    }
    expect(refusal("https://korbat.example", `https://korbat.example.evil.example/u/ada`)).toBe("notice_link_offsite 422");
  });

  test("paths: only /post/<id> and /u/<handle>, each with at most one final slash; a query and a fragment are ignored", () => {
    expect(parseLink(APP, `${APP}/post/${POST}/`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/ada/`)).toEqual({ type: "account", handle: "ada" });
    expect(parseLink(APP, `${APP}/post/${POST}?ref=share#top`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/ada?x=1`)).toEqual({ type: "account", handle: "ada" });
    for (const url of [
      APP,
      `${APP}/`,
      `${APP}/post`,
      `${APP}/post/`,
      `${APP}/post/${POST}//`,
      `${APP}/post/${POST}/thread`,
      `${APP}/posts/${POST}`,
      `${APP}/u`,
      `${APP}/u/ada/followers`,
      `${APP}/u/ada/following`,
      `${APP}/settings/profile`,
      `${APP}/terms`,
      `${APP}/api/posts/${POST}`,
      `${APP}/notice/N-ABCDEFGH23`,
      `${APP}//post/${POST}`,
    ]) {
      expect(refusal(APP, url), url).toBe("notice_link_invalid 422");
    }
  });

  test("case: an id and a handle are taken in lower case; the path's own words are the app's, in lower case only", () => {
    expect(parseLink(APP, `${APP}/post/${POST.toUpperCase()}`)).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, `${APP}/u/Ada_99`)).toEqual({ type: "account", handle: "ada_99" });
    expect(refusal(APP, `${APP}/Post/${POST}`)).toBe("notice_link_invalid 422");
    expect(refusal(APP, `${APP}/U/ada`)).toBe("notice_link_invalid 422");
  });

  test("an id that is not an id and a handle that is not a handle are no link to anything", () => {
    for (const url of [`${APP}/post/123`, `${APP}/post/${POST.slice(1)}`, `${APP}/post/${POST}x`, `${APP}/post/${POST.replace(/-/g, "")}`]) {
      expect(refusal(APP, url), url).toBe("notice_link_invalid 422");
    }
    for (const handle of ["ab", "a".repeat(21), "ada-lovelace", "ada.lovelace", "@ada", "ada%20x", "%61da"]) {
      expect(refusal(APP, `${APP}/u/${handle}`), handle).toBe("notice_link_invalid 422");
    }
    expect(parseLink(APP, `${APP}/u/${"a".repeat(20)}`)).toEqual({ type: "account", handle: "a".repeat(20) });
    expect(parseLink(APP, `${APP}/u/abc`)).toEqual({ type: "account", handle: "abc" });
  });

  test("what is no web address at all, or carries a user name or a password, is refused as no link", () => {
    for (const url of ["", "not a link", "/u/ada", "localhost:8081/u/ada", "javascript:alert(1)", `ftp://localhost:8081/post/${POST}`, `http://ada:secret@localhost:8081/u/ada`, `http://ada@localhost:8081/u/ada`]) {
      expect(refusal(APP, url), url).toBe("notice_link_invalid 422");
    }
  });
});

describe("the links korbat builds", () => {
  test("a post's from its id and an account's from a handle, at the app's origin, and each parses back to what it names", () => {
    expect(postLink(APP, POST)).toBe(`${APP}/post/${POST}`);
    expect(accountLink(APP, "ada_99")).toBe(`${APP}/u/ada_99`);
    expect(parseLink(APP, postLink(APP, POST))).toEqual({ type: "post", id: POST });
    expect(parseLink(APP, accountLink(APP, "ada_99"))).toEqual({ type: "account", handle: "ada_99" });
    // An origin written with a final slash gives the same links.
    expect(postLink("https://korbat.example/", POST)).toBe(`https://korbat.example/post/${POST}`);
    expect(accountLink("https://korbat.example/", "ada")).toBe("https://korbat.example/u/ada");
  });
});

describe("an order's link (3f design, section 7.4): what it names, never fetched, never refused", () => {
  const app = "https://korbat.example";
  const post = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const media = "5f4e3d2c-1b0a-4f9e-8d7c-6b5a4f3e2d1c";

  test("a post's page names the post, in lower case", () => {
    expect(orderLinkTarget(app, `${app}/post/${post}`)).toEqual({ kind: "post", postId: post });
    expect(orderLinkTarget(app, `http://korbat.example/post/${post.toUpperCase()}/`)).toEqual({ kind: "post", postId: post });
  });

  test("an image korbat serves names the image, whose post the media module answers", () => {
    expect(orderLinkTarget(app, `${app}/api/media/${media}/large.webp`)).toEqual({ kind: "image", mediaId: media });
    expect(orderLinkTarget(app, `${app}/api/media/${media}/small.webp?x=1`)).toEqual({ kind: "image", mediaId: media });
    expect(orderLinkTarget(app, `${app}/api/media/${media}/huge.webp`)).toEqual({ kind: "other" });
  });

  test("a profile's page names an account", () => {
    expect(orderLinkTarget(app, `${app}/u/Some_One`)).toEqual({ kind: "account", handle: "some_one" });
  });

  test("another site, another path, a user name in the address and no address at all are other, and nothing throws", () => {
    for (const link of [`https://elsewhere.example/post/${post}`, `${app}/settings`, `https://user:pw@korbat.example/post/${post}`, "not a link", "javascript:alert(1)", `ftp://korbat.example/post/${post}`]) {
      expect(orderLinkTarget(app, link), link).toEqual({ kind: "other" });
    }
  });
});
