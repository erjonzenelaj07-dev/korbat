# korbat 2b — Task 16 of 17: Post cards show their images: one in its own ratio or up to four in a 16:9 grid, blurhash placeholders, an ALT control, thumbnails in quotes, and a full-screen viewer with arrow keys and Escape

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Post cards show their images: one in its own ratio held between 3:4 and 2:1, two to four in a 16:9 frame cropped to their cells, with blurhash placeholders, lazy loading and the small size. An ALT control shows the descriptions, and each description is the image's alt text. A quoted post shows its images as a row of thumbnails. Pressing an image opens a full-screen viewer with the large size, the description, previous and next, arrow keys and Escape, and focus returns to the image. A step checks the four library behaviours this relies on in the installed source.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the composer attaches up to four images with previews, processing state and a required description each; uploads go as raw bodies with the CSRF header; the Post button names what is missing`.
3. The previous task's last API unit run ended with `Tests  142 passed | 139 skipped (281)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/16-web-post-images.md 1
```

Expected: 3 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/components/social/MediaGrid.tsx`

```tsx
import { useState } from "react";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { MediaViewer } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * The small size of an image with its blurhash; expo-image loads it lazily on the web. The blurhash
 * fades into the image unless the system asks for reduced motion, which swaps it at once.
 */
function Picture({ item, style }: { item: MediaView; style: { width: number | "100%"; height: number | "100%"; borderRadius?: number } }) {
  const still = useReducedMotion();
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} contentFit="cover" transition={still ? 0 : 150} accessibilityLabel={item.alt} style={style} />
  );
}

function Cell({ item, onPress }: { item: MediaView; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open image: ${item.alt}`} onPress={onPress} style={{ flex: 1 }}>
      <Picture item={item} style={{ width: "100%", height: "100%" }} />
    </Pressable>
  );
}

/**
 * The images of a post. One image is shown in its own ratio; two to four share a 16:9 frame and are
 * cropped to their cell. Pressing one opens the viewer; ALT shows the descriptions in place.
 */
function Grid({ media }: { media: MediaView[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  const cell = (index: number) => <Cell key={media[index]!.id} item={media[index]!} onPress={() => setOpen(index)} />;

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: clampRatio(media[0]!.width, media[0]!.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-xl border border-zinc-800">{frame}</View>
      <Pressable accessibilityRole="button" aria-expanded={described} accessibilityLabel={described ? "Hide image descriptions" : "Show image descriptions"} onPress={() => setDescribed(!described)} className="mt-1 self-start rounded border border-zinc-700 px-1.5 py-0.5">
        <Text className="text-xs font-semibold text-zinc-300">ALT</Text>
      </Pressable>
      {described
        ? media.map((item, index) => (
            <Text key={item.id} className="mt-1 text-sm leading-5 text-zinc-300">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {item.alt}
            </Text>
          ))
        : null}
      {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 */
export function MediaGrid({ media, compact = false }: { media: MediaView[]; compact?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} />;
  return (
    <View className="mt-2 flex-row" style={{ gap: GAP }}>
      {media.map((item) => (
        <Picture key={item.id} item={item} style={{ width: THUMBNAIL, height: THUMBNAIL, borderRadius: 6 }} />
      ))}
    </View>
  );
}
```

### Create `apps/app/src/components/social/MediaViewer.tsx`

```tsx
import { useEffect } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { MediaView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";

interface MediaViewerProps {
  media: MediaView[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/**
 * One image on the whole screen, in its large size and fitted inside it, with its description
 * underneath. Arrow keys move between the images of the post; react-native-web's Modal closes it on
 * Escape and returns focus to the image that opened it. It appears at once: nothing about it needs
 * motion, and the image fades in from its blurhash only when reduced motion is not asked for.
 */
export function MediaViewer({ media, index, onIndex, onClose }: MediaViewerProps) {
  const still = useReducedMotion();
  const item = media[index]!;
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View accessibilityViewIsModal className="flex-1 bg-black/95">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-sm text-zinc-400">{many ? `${index + 1} of ${media.length}` : ""}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close the image viewer" onPress={onClose} className="rounded-lg border border-zinc-700 px-3 py-1.5">
            <Text className="text-sm text-zinc-200">Close</Text>
          </Pressable>
        </View>
        <View className="flex-1 px-2">
          <Image
            source={{ uri: `${API_BASE}${item.large}` }}
            placeholder={{ blurhash: item.blurhash }}
            contentFit="contain"
            transition={still ? 0 : 150}
            accessibilityLabel={item.alt}
            style={{ flex: 1 }}
          />
        </View>
        <Text className="px-4 py-3 text-center text-sm leading-5 text-zinc-200">{item.alt}</Text>
        {many ? (
          <View className="flex-row justify-center gap-3 pb-4">
            <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => step(-1)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Previous</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => step(1)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Next</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social, timeAgo, type EngagementKind } from "@/lib/social";
import { MediaGrid } from "./MediaGrid";
import { RichText } from "./RichText";

function AuthorLine({ author, createdAt }: { author: Author; createdAt: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${author.handle}`)}>
        <Text className="text-base font-semibold text-zinc-50">
          {author.displayName}
          {author.verified ? <Text className="text-sky-400"> ✓</Text> : null}
        </Text>
      </Pressable>
      <Text className="text-sm text-zinc-500">
        @{author.handle} · {timeAgo(createdAt)}
      </Text>
    </View>
  );
}

function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <Text className="text-sm italic text-zinc-500">{tombstone.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
    </View>
  );
}

export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${quote.id}`)} className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <AuthorLine author={quote.author} createdAt={quote.createdAt} />
      {quote.body ? <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" /> : null}
      <MediaGrid media={quote.media} compact />
    </Pressable>
  );
}

function StateChip({ state }: { state: PostView["state"] }) {
  if (state === "visible") return null;
  const amber = state === "withheld";
  return (
    <View className={`self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`}>
      <Text className={`text-xs font-medium ${amber ? "text-amber-300" : "text-red-300"}`}>{amber ? "Under review" : "Removed"}</Text>
    </View>
  );
}

function Action({ label, count, active, activeClass, onPress }: { label: string; count?: number; active?: boolean; activeClass?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
      <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{label}</Text>
      {count !== undefined && count > 0 ? <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * One post in any list. Actions update the card from the server's answer, so counts never drift
 * from the truth. A signed-out reader is sent to sign in on the first action.
 */
export function PostCard({ post: initial, repostedBy, onDeleted }: { post: PostView; repostedBy?: Author; onDeleted?: (id: string) => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPost(initial), [initial]);

  async function toggle(kind: EngagementKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    const current = post.viewer ?? { liked: false, reposted: false, bookmarked: false };
    const on = kind === "like" ? !current.liked : kind === "repost" ? !current.reposted : !current.bookmarked;
    try {
      const result = await social.engage(post.id, kind, on);
      setPost({ ...post, counts: result.counts, viewer: result.viewer });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    try {
      await social.deletePost(post.id);
      onDeleted?.(post.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <View className="border-b border-zinc-800 px-4 py-3">
      {repostedBy ? <Text className="mb-1 text-xs text-zinc-500">↻ {repostedBy.displayName} reposted</Text> : null}
      <AuthorLine author={post.author} createdAt={post.createdAt} />
      {post.author.id === me ? <StateChip state={post.state} /> : null}
      {post.replyTo ? (
        <Text className="text-xs text-zinc-500">
          Replying to <Text className="text-sky-400" onPress={() => router.push(`/u/${post.replyTo!.authorHandle}`)}>@{post.replyTo.authorHandle}</Text>
        </Text>
      ) : null}
      {/* A post may consist of images only, and then there is no text to link. */}
      {post.body ? (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${post.id}`)} className="mt-1">
          <RichText body={post.body} />
        </Pressable>
      ) : null}
      <MediaGrid media={post.media} />
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} activeClass="text-emerald-400" onPress={() => void toggle("repost")} />
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} activeClass="text-rose-400" onPress={() => void toggle("like")} />
        <Action label={post.viewer?.bookmarked ? "Saved" : "Save"} active={post.viewer?.bookmarked} activeClass="text-sky-400" onPress={() => void toggle("bookmark")} />
        {post.author.id === me ? <Action label="Delete" onPress={() => void remove()} /> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
```

## Step 2: verify: typecheck

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

## Step 3: verify: dependency-behaviour

```bash
echo "img alt from accessibilityLabel: $(grep -c 'alt={accessibilityLabel}' node_modules/expo-image/src/web/ImageWrapper.tsx)"; echo "lazy unless told otherwise: $(grep -c "responsivePolicy === 'static' ? 'lazy'" node_modules/expo-image/src/ExpoImage.web.tsx)"; echo "modal closes on Escape: $(grep -c "e.key === 'Escape'" node_modules/react-native-web/dist/exports/Modal/ModalContent.js)"; echo "modal gives focus back: $(grep -c 'UIManager.focus(lastFocusedElementOutsideTrap)' node_modules/react-native-web/dist/exports/Modal/ModalFocusTrap.js)"
```

Expected output contains:

- `img alt from accessibilityLabel: 1`
- `lazy unless told otherwise: 1`
- `modal closes on Escape: 1`
- `modal gives focus back: 1`

Observed on the dry run:

```text
img alt from accessibilityLabel: 1
lazy unless told otherwise: 1
modal closes on Escape: 1
modal gives focus back: 1
```

## Step 4: verify: export

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

## Step 5: verify: api-unchanged

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

## Step 6: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/MediaViewer.tsx`
- `apps/app/src/components/social/PostCard.tsx`

## Step 7: commit

```bash
git add -A
git commit -q -m "feat(app): post cards show images in a ratio-kept single frame or a 16:9 grid with blurhash placeholders and an ALT control; quotes show thumbnails; a full-screen viewer with arrow keys, Escape and focus return" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): post cards show images in a ratio-kept single frame or a 16:9 grid with blurhash placeholders and an ALT control; quotes show thumbnails; a full-screen viewer with arrow keys, Escape and focus return`.

## Report format (mandatory)

```text
TASK 16 REPORT
Files written: <count, expected 3>
Verify "typecheck": <paste the expected lines as printed>
Verify "dependency-behaviour": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "api-unchanged": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
