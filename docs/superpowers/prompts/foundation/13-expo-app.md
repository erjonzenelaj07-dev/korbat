# korbat Foundation — Task 13 of 16: `@korbat/app` Expo web shell

You are executing one task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform. The client is one Expo (React Native) codebase targeting the web first and iOS/Android later via EAS. Styling is NativeWind (Tailwind classes on React Native components) so the same components render on every platform; routing is expo-router (file-based, works on web and native). The API (Task 11) is a Hono service under `/api`; in production Caddy serves the exported web build at `/` and proxies `/api/*` on the same origin, so the session cookie is first-party. In development the Expo dev server runs on port 8081 and calls the API on port 3000 cross-origin (the API's `TRUSTED_ORIGINS` allows `http://localhost:8081`).

This task scaffolds the app with the official template, wires NativeWind, and replaces the template screens with a single dark screen that fetches `/api/health` through a typed client that parses the response with `HealthResponse` from `@korbat/contracts`. That proves the full path: monorepo package import inside Metro, Tailwind classes rendering on web, and the API contract shared end to end. The real UI (feed, composer, security screens) comes in later sub-projects with the frontend-design skill; keep this screen minimal.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running** with `postgres` and `redis` up (Task 8) so the dev API can answer `ok`.
- Versions: Expo SDK 57 (the template pins react, react-native, react-native-web, reanimated, etc.; do not override those pins), nativewind 4.2.6, tailwindcss 3.4.19 (NativeWind 4 requires Tailwind 3, not 4). `.npmrc` already sets `node-linker=hoisted`, which Expo needs.
- Notes: `create-expo-app --template default` produces an expo-router app with a `(tabs)` group; `--no-install` skips npm so pnpm can install at the workspace root. `npx expo install <pkg>` picks the SDK-compatible version. `expo export --platform web` writes a static site to `dist/`. Metro resolves workspace packages through the hoisted symlinks and compiles their TypeScript source.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 13).

## Preconditions

`git log --oneline -1` must show `feat(worker): redis list consumer with job registry`. `apps/api/.env` exists (from Task 11). If `apps/app/` exists, verify against this prompt, fix drift, run the checks, skip to the report.

## Rules

1. Scaffold with the official template, then modify; do not hand-write `package.json` pins for Expo packages.
2. Exact file contents below for every file listed. Template files not mentioned stay as generated.
3. Do not add UI beyond the single screen. No fonts, icons, or extra dependencies.
4. `apps/app/dist/` and `.expo/` are gitignored; confirm before committing.
5. LF line endings, 2-space indentation.
6. Verify before claiming; paste real output.
7. Commit exactly once with the given message and trailer.

## Steps and files

### Step 1: Scaffold
```bash
cd apps && npx create-expo-app@latest app --template default --no-install && cd ..
```
Then edit `apps/app/package.json`:
- set `"name": "@korbat/app"`
- add scripts `"web": "expo start --web"` and `"typecheck": "tsc --noEmit"`
- add dependency `"@korbat/contracts": "workspace:*"`

Delete from `apps/app/`: the `app/(tabs)` folder, `components/`, `constants/`, `hooks/`, and `scripts/reset-project.js` (remove the `reset-project` script from `package.json` too). Keep `assets/`.

Run `pnpm install`. Expected: Expo SDK 57 packages installed at the workspace root `node_modules`.

### Step 2: NativeWind
```bash
pnpm --filter @korbat/app exec npx expo install nativewind
pnpm --filter @korbat/app add -D tailwindcss@3.4.19
```
Confirm `apps/app/package.json` now lists `nativewind` (4.2.x) and `tailwindcss` `3.4.19`.

Create `apps/app/global.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Create `apps/app/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
```

Create `apps/app/babel.config.js`:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

Create `apps/app/metro.config.js`:
```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

Create `apps/app/nativewind-env.d.ts`:
```ts
/// <reference types="nativewind/types" />
```

Edit `apps/app/app.json`: set `expo.name` to `"korbat"`, `expo.slug` to `"korbat"`, `expo.scheme` to `"korbat"`, and `expo.web` to:
```json
{ "bundler": "metro", "output": "single", "favicon": "./assets/images/favicon.png" }
```
(`single` output makes a SPA so Caddy's `try_files ... /index.html` fallback works.)

### Step 3: Screens and API client

Create `apps/app/src/lib/api.ts`:
```ts
import { Platform } from "react-native";
import { HealthResponse } from "@korbat/contracts";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`, { credentials: "include" });
  return HealthResponse.parse(await res.json());
}
```

Replace `apps/app/app/_layout.tsx` with:
```tsx
import "../global.css";
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `apps/app/app/index.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { HealthResponse } from "@korbat/contracts";
import { fetchHealth } from "../src/lib/api";

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const status = error ? `api unreachable: ${error}` : health ? `api ${health.status} · v${health.version}` : "checking api…";

  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6">
      <Text className="text-4xl font-bold tracking-tight text-zinc-50">korbat</Text>
      <Text className="mt-3 text-base text-zinc-400">{status}</Text>
    </View>
  );
}
```

If the template generated `app/+not-found.tsx` referencing deleted components, replace its body with a minimal screen:
```tsx
import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View className="flex-1 items-center justify-center bg-zinc-950">
        <Text className="text-zinc-50">This screen does not exist.</Text>
        <Link href="/" className="mt-4 text-zinc-400">Go home</Link>
      </View>
    </>
  );
}
```

### Step 4: Run on web against the dev API
```bash
(cd apps/api && set -a && . ./.env && set +a && pnpm dev) &
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm --filter @korbat/app web
```
Open http://localhost:8081 in a browser. Expected: dark page with "korbat" and "api ok · v0.0.0-dev". If it says "api unreachable", check that the API log shows the request and that `TRUSTED_ORIGINS` in `apps/api/.env` includes `http://localhost:8081` (CORS). Stop both processes (Ctrl+C the Expo server, `kill %1` for the API).

### Step 5: Typecheck and static export
```bash
pnpm --filter @korbat/app typecheck
pnpm --filter @korbat/app exec npx expo export --platform web
ls apps/app/dist
```
Expected: typecheck exits 0; `dist/` contains `index.html` and `_expo/`.

### Step 6: Commit
Confirm `git status --short` does not list `apps/app/dist/` or `apps/app/.expo/`. Then:
```bash
git add -A && git commit -m "feat(app): expo web shell with nativewind calling /api/health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Report format

- Files created/modified/deleted (list the template files you removed)
- The versions of `expo`, `react-native`, `nativewind`, `tailwindcss` from `apps/app/package.json`
- What the browser showed in Step 4 (exact status text)
- Output of Step 5
- Deviations and why (e.g. Metro needing an extra `watchFolders` entry to find `packages/contracts`)
- Anything blocked or uncertain
