import { describe, expect, test } from "vitest";
import { ExportFormat } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-24T10:00:00.000Z";

/** A complete export of a small account: every list holds one entry so each entry shape is exercised. */
const full = {
  format: "korbat-export-1",
  exportedAt: at,
  account: {
    id: id(1),
    email: "ada@example.com",
    createdAt: at,
    role: "user",
    mfaEnabled: true,
    hasPassword: true,
    verified: false,
    termsVersion: "draft-2026-09",
    termsAcceptedAt: at,
    passkeys: [
      { name: "Laptop", createdAt: at, lastUsedAt: at, synced: true, createdOn: "Chrome on Windows" },
      { name: "Security key", createdAt: at, lastUsedAt: null, synced: false, createdOn: null },
    ],
  },
  profile: { handle: "ada", displayName: "Ada", bio: "hello", createdAt: at, handleHistory: ["ada_l", "ada"] },
  posts: [
    { id: id(2), body: "first", createdAt: at, replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [{ id: id(3), file: `media/${id(3)}.webp`, altText: "a cat", width: 2048, height: 1536 }] },
    { id: id(4), body: "", createdAt: at, replyToId: id(2), quoteOfId: null, state: "deleted_by_author", deletedAt: at, media: [] },
  ],
  likes: [{ postId: id(5), at }],
  reposts: [{ postId: id(5), at }],
  bookmarks: [{ postId: id(5), at }],
  following: [{ handle: "grace", since: at }],
  blocks: [{ handle: "troll", since: at }],
  mutes: [{ handle: "loud", since: at }],
  // A session is named by its handle, as the session list names it; the token's hash stays on the server.
  sessions: [{ id: id(9), createdAt: at, lastUsedAt: at, current: true }],
  devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: at, lastSeenAt: at }],
  events: [{ type: "signup", at }],
  missingMedia: [id(6)],
};

describe("export format", () => {
  test("a complete export parses unchanged, and every list may be empty", () => {
    expect(ExportFormat.parse(full)).toEqual(full);
    const empty = { ...full, account: { ...full.account, passkeys: [] }, posts: [], likes: [], reposts: [], bookmarks: [], following: [], blocks: [], mutes: [], sessions: [], devices: [], events: [], missingMedia: [] };
    expect(ExportFormat.parse(empty)).toEqual(empty);
  });

  test("the format name is fixed, so a reader can tell what it opened", () => {
    expect(ExportFormat.safeParse({ ...full, format: "korbat-export-2" }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, format: undefined }).success).toBe(false);
  });

  test("the account and the profile carry the nullable facts as null, never missing", () => {
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, termsVersion: null, termsAcceptedAt: null } }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, email: "not-an-email" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, role: "owner" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: [1] } }).success).toBe(false);
  });

  test("the account's passkeys carry a name, their times, whether they are synced and where they were added, and nothing that identifies the key", () => {
    const [laptop] = full.account.passkeys;
    const withPasskeys = (passkeys: unknown) => ExportFormat.safeParse({ ...full, account: { ...full.account, passkeys } }).success;
    // The list is part of the format since 1c: always present, empty for an account without passkeys.
    expect(withPasskeys(undefined)).toBe(false);
    expect(withPasskeys([])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: null, createdOn: null }])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdOn: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, name: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdAt: "last week" }])).toBe(false);
    expect(withPasskeys([{ ...laptop, synced: "yes" }])).toBe(false);
    // A reader gets the five fields and no more: nothing of the key, its id or its authenticator is part of the format.
    const parsed = ExportFormat.parse({ ...full, account: { ...full.account, passkeys: [{ ...laptop, id: id(7), credentialId: "Y3JlZA", publicKey: "cose", aaguid: id(8) }] } });
    expect(parsed.account.passkeys).toEqual([laptop]);
  });

  test("a deleted post keeps its place with an empty body and a deletion time; an attached image has its dimensions", () => {
    const [post] = full.posts;
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, state: "hidden" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, replyToId: undefined }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: [{ id: id(3), file: "media/x.webp", altText: "a cat" }] }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: undefined }] }).success).toBe(false);
  });

  test("engagement entries name a post and a time, graph entries a handle and a time", () => {
    expect(ExportFormat.safeParse({ ...full, likes: [{ postId: "nope", at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, bookmarks: [{ postId: id(5) }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, following: [{ handle: "grace" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, mutes: [{ handle: "loud", since: "last week" }] }).success).toBe(false);
  });

  test("sessions, devices, events and missing media keep their shapes", () => {
    expect(ExportFormat.safeParse({ ...full, sessions: [{ id: id(9), createdAt: at, lastUsedAt: at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], label: null }] }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], platform: "desktop" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, events: [{ type: "signup" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, missingMedia: undefined }).success).toBe(false);
  });
});
