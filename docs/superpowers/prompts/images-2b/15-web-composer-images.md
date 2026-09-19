# korbat 2b — Task 15 of 17: The web composer takes up to four images: file picker, refusals before upload, previews, processing state, a required description per image, and a Post button that says what is missing

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The web composer takes images. The file picker is limited to the accepted types; a file that is too large or of another type is refused before upload with the reason, a HEIC photo included even when the browser reports no type. Each image shows a local preview at once, its processing state polled every second, a required description with a counter, and Remove. The Post button stays disabled and says what is missing until every image is ready and described. Uploads go as raw bodies with the CSRF header like every other write.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs with `--config.minimum-release-age=0` for that one command, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(infra): MinIO leaves the stack; media-uploads and media-store volumes; the worker runs without network, capabilities or credentials under memory, CPU and process limits; Caddy caps upload bodies; dev scripts load their env files`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/15-web-composer-images.md 1
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/lib/pick-images.ts`

```ts
import { Platform } from "react-native";
import { MEDIA_ACCEPTED_TYPES } from "@korbat/contracts";

/** Whether this platform can choose image files. The web can; native gets a picker with the native builds. */
export const canPickImages = Platform.OS === "web";

/**
 * Opens the browser's file dialog, limited to the image types korbat accepts, and resolves with the
 * chosen files. Dismissing the dialog resolves with none. The input element is created for one use
 * and never attached to the page.
 */
export function pickImages(): Promise<File[]> {
  if (!canPickImages) return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MEDIA_ACCEPTED_TYPES.join(",");
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
```

### Create `apps/app/src/components/social/useImageUploads.ts`

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { ALT_MAX_LENGTH, MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, MEDIA_MAX_PER_POST, altLength, normalizeAltText, type MediaFailure } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social } from "@/lib/social";

export interface ComposerImage {
  /** Stable for the life of the row; the upload id only exists once the server answered. */
  key: string;
  /** A blob: URL of the chosen file, so the preview shows at once and nothing has to be downloaded. */
  previewUrl: string;
  alt: string;
  status: "uploading" | "processing" | "ready" | "failed";
  id: string | null;
  error: string | null;
}

const FAILURES: Record<MediaFailure, string> = {
  unsupported_format: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  animated_not_supported: "Animated images are not supported yet. Use a still image.",
  image_too_large: "That image has too many pixels. Make it smaller and try again.",
  corrupt_image: "That file could not be read as an image.",
  processing_failed: "We could not process that image. Try again.",
};

const POLL_MS = 1000;
/** A little longer than the server waits before it fails an upload itself. */
const GIVE_UP_MS = 6 * 60_000;

/**
 * Why a file is refused before it is sent, or null when it may go. The server checks again. Browsers on
 * Windows often report no type at all for a .heic file, so its name is checked too: an iPhone photo
 * should get the advice that helps, not the generic refusal.
 */
export function refusal(file: { name: string; type: string; size: number }): string | null {
  if (file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name)) return "HEIC photos are not supported. Export the photo as JPEG and try again.";
  if (!(MEDIA_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return FAILURES.unsupported_format;
  if (file.size > MEDIA_MAX_BYTES) return "Images can be at most 20 MB.";
  return null;
}

/** What still stands between these images and posting them. */
export function describeState(images: ComposerImage[]): { waiting: boolean; failed: boolean; undescribed: boolean } {
  return {
    waiting: images.some((image) => image.status === "uploading" || image.status === "processing"),
    failed: images.some((image) => image.status === "failed"),
    undescribed: images.some((image) => {
      const length = altLength(normalizeAltText(image.alt));
      return length < 1 || length > ALT_MAX_LENGTH;
    }),
  };
}

/**
 * The images of one composer: uploads each chosen file, follows its processing, and keeps the
 * descriptions. Removing an image also removes the upload on the server. Blob URLs are released
 * when an image goes and when the composer closes.
 */
export function useImageUploads() {
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** The same list as `images`, readable by callbacks without waiting for a render. */
  const list = useRef<ComposerImage[]>([]);
  const closed = useRef(false);

  const commit = useCallback((next: ComposerImage[]) => {
    list.current = next;
    setImages(next);
  }, []);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      for (const image of list.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<ComposerImage>) => commit(list.current.map((image) => (image.key === key ? { ...image, ...change } : image))),
    [commit],
  );
  const present = (key: string) => !closed.current && list.current.some((image) => image.key === key);

  const follow = useCallback(
    async (key: string, file: File) => {
      try {
        const sent = await social.uploadMedia(file);
        if (!present(key)) {
          await social.removeMedia(sent.id).catch(() => undefined);
          return;
        }
        patch(key, { id: sent.id, status: "processing" });
        const deadline = Date.now() + GIVE_UP_MS;
        while (present(key) && Date.now() < deadline) {
          const state = await social.mediaStatus(sent.id);
          if (!present(key)) return;
          if (state.status === "ready") return patch(key, { status: "ready" });
          if (state.status === "failed") return patch(key, { status: "failed", error: FAILURES[state.error] });
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        if (present(key)) patch(key, { status: "failed", error: FAILURES.processing_failed });
      } catch (err) {
        if (present(key)) patch(key, { status: "failed", error: errorMessage(err) });
      }
    },
    [patch],
  );

  const add = useCallback(
    (files: File[]) => {
      const room = Math.max(0, MEDIA_MAX_PER_POST - list.current.length);
      let message: string | null = files.length > room ? `A post can have at most ${MEDIA_MAX_PER_POST} images.` : null;
      const added: ComposerImage[] = [];
      const started: [string, File][] = [];
      for (const file of files.slice(0, room)) {
        const why = refusal(file);
        if (why) {
          message = why;
          continue;
        }
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        added.push({ key, previewUrl: URL.createObjectURL(file), alt: "", status: "uploading", id: null, error: null });
        started.push([key, file]);
      }
      setNotice(message);
      commit([...list.current, ...added]);
      for (const [key, file] of started) void follow(key, file);
    },
    [commit, follow],
  );

  const remove = useCallback(
    (key: string) => {
      const image = list.current.find((candidate) => candidate.key === key);
      if (!image) return;
      URL.revokeObjectURL(image.previewUrl);
      commit(list.current.filter((candidate) => candidate.key !== key));
      if (image.id) void social.removeMedia(image.id).catch(() => undefined);
    },
    [commit],
  );

  /** After posting: the uploads now belong to the post, so only the previews are released. */
  const clear = useCallback(() => {
    for (const image of list.current) URL.revokeObjectURL(image.previewUrl);
    commit([]);
    setNotice(null);
  }, [commit]);

  const setAlt = useCallback((key: string, alt: string) => patch(key, { alt }), [patch]);

  return { images, notice, add, remove, clear, setAlt };
}
```

### Create `apps/app/src/components/social/ComposerImages.tsx`

```tsx
import { Image } from "expo-image";
import { Pressable, Text, TextInput, View } from "react-native";
import { ALT_MAX_LENGTH, altLength, normalizeAltText } from "@korbat/contracts";
import type { ComposerImage } from "./useImageUploads";

const STATUS: Record<ComposerImage["status"], string> = {
  uploading: "Uploading…",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
};

/**
 * The images of a post being written: a preview from the chosen file, where the upload stands, and
 * the description every image needs. The counter uses the server's rule, so what it allows is what
 * the API accepts.
 */
export function ComposerImages({ images, onAlt, onRemove }: { images: ComposerImage[]; onAlt: (key: string, alt: string) => void; onRemove: (key: string) => void }) {
  if (images.length === 0) return null;
  return (
    <View className="mt-3 gap-3">
      {images.map((image, index) => {
        const length = altLength(normalizeAltText(image.alt));
        const label = `image ${index + 1}`;
        return (
          <View key={image.key} className="flex-row gap-3 rounded-lg border border-zinc-800 p-2">
            <Image source={{ uri: image.previewUrl }} contentFit="cover" accessibilityLabel={`Preview of ${label}`} style={{ width: 72, height: 72, borderRadius: 6 }} />
            <View className="flex-1">
              <Text accessibilityLiveRegion="polite" className={`text-xs ${image.status === "failed" ? "text-red-400" : image.status === "ready" ? "text-emerald-400" : "text-zinc-400"}`}>
                {image.status === "failed" && image.error ? image.error : STATUS[image.status]}
              </Text>
              <TextInput
                accessibilityLabel={`Description of ${label}`}
                placeholder="Describe this image for people who cannot see it"
                placeholderTextColor="#71717a"
                multiline
                value={image.alt}
                onChangeText={(alt) => onAlt(image.key, alt)}
                className="mt-1 min-h-[44px] rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-5 text-zinc-50"
              />
              <View className="mt-1 flex-row items-center justify-between">
                <Text className={`text-xs ${length > ALT_MAX_LENGTH ? "text-red-400" : "text-zinc-500"}`}>
                  {length}/{ALT_MAX_LENGTH}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={() => onRemove(image.key)}>
                  <Text className="text-xs text-zinc-400 underline">Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "@marsidev/react-turnstile": "1.6.1",
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
    "expo-image": "57.0.5",
    "expo-linking": "57.0.10",
    "expo-router": "57.0.21",
    "expo-status-bar": "57.0.1",
    "nativewind": "4.2.6",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2",
    "react-native-web": "0.21.2",
    "react-native-worklets": "0.10.1",
    "zod": "4.5.4"
  },
  "devDependencies": {
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "5.9.3"
  }
}
```

### Replace `apps/app/src/lib/api.ts` (whole file)

```ts
import { Platform } from "react-native";
import { ErrorEnvelope, HealthResponse, type AuthErrorCode } from "@korbat/contracts";
import type { z } from "zod";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

const CSRF_COOKIE = "__Host-korbat_csrf";
const DEVICE_KEY = "korbat.deviceId";

/** Browser globals, typed locally so this file does not depend on the DOM type library. */
const web = globalThis as unknown as {
  document?: { cookie: string };
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  crypto: { getRandomValues<T extends Uint8Array>(array: T): T };
};

/** A failed API call with the server's error code and a message fit to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Partial<Record<AuthErrorCode | "unauthenticated" | "invalid_request" | "not_found" | "internal" | "network", string>> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Start again.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Turn on two-factor authentication first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  unauthenticated: "Sign in to continue.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  internal: "Something went wrong on our side. Try again.",
  network: "Cannot reach korbat. Check your connection.",
};

export function messageFor(code: string, fallback?: string): string {
  return MESSAGES[code as keyof typeof MESSAGES] ?? fallback ?? "Something went wrong. Try again.";
}

/** The message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function readCookie(name: string): string | undefined {
  const cookies = web.document?.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split("; ")) {
    const separator = part.indexOf("=");
    if (part.slice(0, separator) === name) return decodeURIComponent(part.slice(separator + 1));
  }
  return undefined;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes as unpadded base64url (43 characters). */
function randomDeviceId(): string {
  const bytes = web.crypto.getRandomValues(new Uint8Array(33));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]! + BASE64URL[n & 63]!;
  }
  return out.slice(0, 43);
}

/** A random id created once per browser. The server stores only a keyed hash of it. */
export function deviceId(): string {
  try {
    const existing = web.localStorage?.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{22,64}$/.test(existing)) return existing;
    const created = randomDeviceId();
    web.localStorage?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return randomDeviceId();
  }
}

export const platform: "web" | "ios" | "android" = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

interface RequestOptions<T> {
  method?: "GET" | "POST" | "DELETE";
  json?: unknown;
  /** A raw body sent as it is, with its declared type: how an image is uploaded. */
  raw?: { type: string; body: Blob };
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie. State-changing requests echo the CSRF cookie in
 * X-CSRF-Token; the session cookie itself is HttpOnly and never readable here.
 */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? (options.json === undefined && options.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.raw) headers["content-type"] = options.raw.type;
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.raw ? options.raw.body : options.json === undefined ? undefined : JSON.stringify(options.json),
    });
  } catch {
    throw new ApiError(0, "network", messageFor("network"));
  }

  if (!res.ok) {
    const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => null));
    const code = parsed.success ? parsed.data.error.code : "internal";
    // The server's message is written for people and can be more specific than the generic text for
    // its code ("Two-factor setup expired. Start again."). Only validation and internal errors use
    // the local wording, because their server messages are technical.
    const generic = code === "invalid_request" || code === "internal" || !parsed.success;
    throw new ApiError(res.status, code, generic ? messageFor(code) : parsed.data.error.message);
  }
  if (!options.schema) return undefined as T;
  return options.schema.parse(await res.json());
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api("/api/health", { schema: HealthResponse });
}
```

### Replace `apps/app/src/lib/social.ts` (whole file)

```ts
import {
  BlockResponse,
  EngagementResponse,
  FollowResponse,
  MediaStatusResponse,
  MuteResponse,
  PostPage,
  PostView,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { api } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string; media?: { id: string; alt: string }[] }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(`/api/posts/${id}`, { schema: PostView }),
  deletePost: (id: string) => api(`/api/posts/${id}`, { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`/api/posts/${id}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`/api/posts/${id}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),

  /** Sends one image file as the request body. The answer is an id to ask about, not a finished image. */
  uploadMedia: (file: Blob) => api("/api/media", { raw: { type: file.type, body: file }, schema: UploadResponse }),
  mediaStatus: (id: string) => api(`/api/media/${id}`, { schema: MediaStatusResponse }),
  removeMedia: (id: string) => api(`/api/media/${id}`, { method: "DELETE" }),

  following: (cursor?: string) => api(`/api/timeline/following${query(cursor)}`, { schema: TimelinePage }),
  latest: (cursor?: string) => api(`/api/timeline/latest${query(cursor)}`, { schema: TimelinePage }),

  profile: (handle: string) => api(handlePath(handle), { schema: ProfileView }),
  profilePosts: (handle: string, cursor?: string) => api(`${handlePath(handle)}/posts${query(cursor)}`, { schema: TimelinePage }),
  profileReplies: (handle: string, cursor?: string) => api(`${handlePath(handle)}/replies${query(cursor)}`, { schema: PostPage }),
  followers: (handle: string, cursor?: string) => api(`${handlePath(handle)}/followers${query(cursor)}`, { schema: ProfilePage }),
  followingOf: (handle: string, cursor?: string) => api(`${handlePath(handle)}/following${query(cursor)}`, { schema: ProfilePage }),
  setFollow: (handle: string, on: boolean) => api(`${handlePath(handle)}/follow`, { method: on ? "POST" : "DELETE", schema: FollowResponse }),
  setBlock: (handle: string, on: boolean) => api(`${handlePath(handle)}/block`, { method: on ? "POST" : "DELETE", schema: BlockResponse }),
  setMute: (handle: string, on: boolean) => api(`${handlePath(handle)}/mute`, { method: on ? "POST" : "DELETE", schema: MuteResponse }),

  myLikes: (cursor?: string) => api(`/api/me/likes${query(cursor)}`, { schema: PostPage }),
  myBookmarks: (cursor?: string) => api(`/api/me/bookmarks${query(cursor)}`, { schema: PostPage }),
  myBlocks: (cursor?: string) => api(`/api/me/blocks${query(cursor)}`, { schema: ProfilePage }),
  myMutes: (cursor?: string) => api(`/api/me/mutes${query(cursor)}`, { schema: ProfilePage }),
};

/** "just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}
```

### Replace `apps/app/src/components/social/Composer.tsx` (whole file)

```tsx
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MEDIA_MAX_PER_POST, POST_MAX_LENGTH, normalizePostBody, postLength, type PostView } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { canPickImages, pickImages } from "@/lib/pick-images";
import { social } from "@/lib/social";
import { ComposerImages } from "./ComposerImages";
import { QuoteEmbed } from "./PostCard";
import { describeState, useImageUploads } from "./useImageUploads";

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * One composer for posts, replies and quotes, with up to four images. The counters use the same
 * normalization the server applies, so what they allow is exactly what the API accepts. A post
 * needs text or an image, and every image needs to be processed and described before it can go.
 * States reach assistive technology through `aria-*` props: react-native-web 0.21 ignores
 * `accessibilityState`, and `disabled` already sets `aria-disabled`.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useImageUploads();

  const length = postLength(normalizePostBody(text));
  const { waiting, failed, undescribed } = describeState(uploads.images);
  const hasContent = length >= 1 || uploads.images.length >= 1;
  const ready = hasContent && length <= POST_MAX_LENGTH && !waiting && !failed && !undescribed && !busy;
  // While images hold the post back, the button itself says what is missing, what the user can act
  // on first. Its accessible name is then that sentence, so a screen reader hears the reason too.
  const missing = failed ? "Remove the failed image" : undescribed ? "Describe every image" : waiting ? "Waiting for images…" : null;
  const action = replyTo ? "Reply" : quoteOf ? "Quote" : "Post";

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost({
        body: text,
        media: uploads.images.map((image) => ({ id: image.id!, alt: image.alt })),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
      });
      setText("");
      uploads.clear();
      onPosted?.(post);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addImages() {
    uploads.add(await pickImages());
  }

  return (
    <View className="px-4 py-3">
      {replyTo ? <Text className="mb-2 text-xs text-zinc-500">Replying to @{replyTo.author.handle}</Text> : null}
      <TextInput
        accessibilityLabel={replyTo ? "Your reply" : quoteOf ? "Your comment on the quoted post" : "What's on your mind?"}
        placeholder={replyTo ? "Write your reply" : quoteOf ? "Add your comment" : "What's on your mind?"}
        placeholderTextColor="#71717a"
        multiline
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        className="min-h-[88px] rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base leading-6 text-zinc-50"
      />
      <ComposerImages images={uploads.images} onAlt={uploads.setAlt} onRemove={uploads.remove} />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} /> : null}
      {uploads.notice ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-amber-300">
          {uploads.notice}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row items-center gap-3">
        {canPickImages && uploads.images.length < MEDIA_MAX_PER_POST ? (
          <Pressable accessibilityRole="button" onPress={() => void addImages()} className="rounded-lg border border-zinc-700 px-3 py-2">
            <Text className="text-sm text-zinc-200">Add image</Text>
          </Pressable>
        ) : null}
        <View className="flex-1" />
        <Text className={`text-xs ${length > POST_MAX_LENGTH ? "text-red-400" : "text-zinc-500"}`}>
          {length}/{POST_MAX_LENGTH}
        </Text>
        {onCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" aria-busy={busy} disabled={!ready} onPress={() => void submit()} className={`rounded-lg px-4 py-2 ${ready ? "bg-zinc-50" : "bg-zinc-800"}`}>
          <Text className={`text-sm font-semibold ${ready ? "text-zinc-950" : "text-zinc-500"}`}>{busy ? "Posting…" : (missing ?? action)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

## Step 2: verify: install

```bash
pnpm install --config.minimum-release-age=0
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.5s using pnpm v10.30.0
```

## Step 3: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `new package versions since HEAD; all at least 7 days old`

Allowed difference: The number of new package versions can differ from the dry run if a dependency of a dependency published a release since; the line must still end in `all at least 7 days old`. A version younger than 7 days is a STOP condition: report it, do not work around it.

Observed on the dry run:

```text
1 new package versions since HEAD; all at least 7 days old
```

## Step 4: verify: typecheck

```bash
pnpm --filter @korbat/app typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: same-words

```bash
for s in 'HEIC photos are not supported. Export the photo as JPEG and try again.' 'Images can be at most 20 MB.' 'That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.'; do echo "server $(grep -cF "$s" apps/api/src/media/context.ts) client $(grep -cF "$s" apps/app/src/components/social/useImageUploads.ts): $s"; done
```

Expected output contains:

- `server 1 client 1: HEIC photos are not supported.`
- `server 1 client 1: Images can be at most 20 MB.`
- `server 1 client 1: That file type is not supported.`

Observed on the dry run:

```text
server 1 client 1: HEIC photos are not supported. Export the photo as JPEG and try again.
server 1 client 1: Images can be at most 20 MB.
server 1 client 1: That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.
```

## Step 6: verify: export

```bash
cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Allowed difference: The web export runs a full Metro bundle and can take a few minutes.

Observed on the dry run:

```text
Exported: dist
```

## Step 7: verify: api-unchanged

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 139 skipped (281)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 139 skipped (281)
```

## Step 8: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.6s using pnpm v10.30.0
```

## Step 9: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/package.json`
- `apps/app/src/components/social/Composer.tsx`
- `apps/app/src/components/social/ComposerImages.tsx`
- `apps/app/src/components/social/useImageUploads.ts`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/pick-images.ts`
- `apps/app/src/lib/social.ts`
- `pnpm-lock.yaml`

## Step 10: commit

```bash
git add -A
git commit -q -m "feat(app): the composer attaches up to four images with previews, processing state and a required description each; uploads go as raw bodies with the CSRF header; the Post button names what is missing" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the composer attaches up to four images with previews, processing state and a required description each; uploads go as raw bodies with the CSRF header; the Post button names what is missing`.

## Report format (mandatory)

```text
TASK 15 REPORT
Files written: <count, expected 7>
Verify "install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "same-words": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
