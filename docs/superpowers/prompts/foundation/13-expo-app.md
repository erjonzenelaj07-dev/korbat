# korbat Foundation — Task 13 of 16: `@korbat/app` Expo web shell

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-13 with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform. The client is one Expo (React Native) codebase targeting the web first and iOS/Android later. Styling is NativeWind (Tailwind classes on React Native components); routing is expo-router (file-based, routes under `src/app/`). In production Caddy serves the exported web build at `/` and proxies `/api/*` on the same origin. In development the Expo dev server runs on port 8081 and calls the API on port 3000 cross-origin (the API's `TRUSTED_ORIGINS` allows `http://localhost:8081`).

This task writes the app by hand, with every dependency pinned to the exact version the official Expo SDK 57 template resolves to. It does **not** run `create-expo-app`: that scaffold asks an interactive question, changes between releases, and pulls in packages we do not want. The single screen fetches `/api/health` through a typed client that parses the response with `HealthResponse` from `@korbat/contracts`. That proves the full path: monorepo package import inside Metro, Tailwind classes on web, and the API contract shared end to end. The real UI comes in later sub-projects; keep this screen exactly as given.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0. **Docker Desktop running** with `postgres` and `redis` up (Task 8) so the dev API can answer `ok`. Ports 3000 and 8081 free.
- Exact pins (resolved from the Expo SDK 57 template on 2026-09-13): expo 57.0.22, expo-constants 57.0.18, expo-linking 57.0.10, expo-router 57.0.21, expo-status-bar 57.0.1, react 19.2.3, react-dom 19.2.3, react-native 0.86.3, react-native-gesture-handler 2.32.0, react-native-reanimated 4.5.1, react-native-safe-area-context 5.7.0, react-native-screens 4.26.2, react-native-web 0.21.2, react-native-worklets 0.10.1, nativewind 4.2.6, tailwindcss 3.4.19, @types/react 19.2.18, typescript 5.9.3.
- `.npmrc` already sets `node-linker=hoisted`, which Expo needs.

## Preconditions

`git log --oneline -1` must show `feat(worker): redis list consumer with job registry`. `apps/api/.env` exists (Task 11). If `apps/app/` exists, compare every file with this prompt, fix drift, run steps 3 to 5, and report.

## Rules (read twice)

1. Copy every file below byte for byte. Do not run `create-expo-app`, `expo install`, or `expo upgrade`. Do not change any pinned version.
2. Run every command exactly as written, in order, from the repo root.
3. Compare each command's output with the **Expected** text. Expo prints many informational lines; they are fine. Any line starting with `error`, `Error:`, or `CommandError`, an `error TS` line, a missing `dist/index.html`, or a browser status other than `api ok` is a **STOP condition**.
4. On a STOP condition: do not change the given code, do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module`: run `rm -rf node_modules && pnpm install` once from the repo root and repeat the failed command. Record it.
6. `apps/app/dist/` and `apps/app/.expo/` are gitignored; confirm before committing.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Files to create

### `apps/app/package.json`
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
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
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
    "react-native-worklets": "0.10.1"
  },
  "devDependencies": {
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "5.9.3"
  }
}
```

### `apps/app/app.json`
```json
{
  "expo": {
    "name": "korbat",
    "slug": "korbat",
    "version": "0.0.0",
    "scheme": "korbat",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "web": {
      "bundler": "metro",
      "output": "single"
    },
    "plugins": ["expo-router"],
    "experiments": {
      "typedRoutes": false
    }
  }
}
```

### `apps/app/tsconfig.json`
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", "nativewind-env.d.ts"]
}
```

### `apps/app/.gitignore`
```
node_modules/
.expo/
dist/
web-build/
expo-env.d.ts
.metro-health-check*
*.tsbuildinfo
/ios
/android
```

### `apps/app/global.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### `apps/app/tailwind.config.js`
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  // "class" (not the default "media"): the theme is switched by the app, and NativeWind's web
  // runtime throws in dev mode under "media" when Metro injects the stylesheet.
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
```

### `apps/app/babel.config.js`
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

### `apps/app/metro.config.js`
```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

### `apps/app/nativewind-env.d.ts`
```ts
/// <reference types="nativewind/types" />
```

### `apps/app/src/lib/api.ts`
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

### `apps/app/src/app/_layout.tsx`
```tsx
import "../../global.css";
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### `apps/app/src/app/index.tsx`
```tsx
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { HealthResponse } from "@korbat/contracts";
import { fetchHealth } from "@/lib/api";

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const status = error ? `api unreachable: ${error}` : health ? `api ${health.status} \u00b7 v${health.version}` : "checking api\u2026";

  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6">
      <Text className="text-4xl font-bold tracking-tight text-zinc-50">korbat</Text>
      <Text className="mt-3 text-base text-zinc-400">{status}</Text>
    </View>
  );
}
```
(`\u00b7` is a middle dot and `\u2026` an ellipsis, written as escapes so the file stays pure ASCII.)

## Steps

1. Create all twelve files above (`apps/app/` with `src/app/` and `src/lib/` subfolders).
2. Run:
   ```bash
   pnpm install
   ```
   Expected: ends with `Done in <time> using pnpm v10.30.0`. This install takes one to two minutes.
3. Run:
   ```bash
   pnpm --filter @korbat/app typecheck
   ```
   Expected: no `error TS` lines.
4. Export the web build:
   ```bash
   pnpm --filter @korbat/app export:web
   ls apps/app/dist
   grep -o '<script[^>]*>' apps/app/dist/index.html
   ```
   Expected: the export ends with `Exported: dist`; `dist/` lists `_expo`, `assets`, `index.html`, `metadata.json`; the grep prints exactly one `<script src="/_expo/static/js/web/entry-<hash>.js" defer>` line (one external script, no inline scripts, which the Caddy CSP in Task 14 relies on).
5. Start the dev API and the Expo web server, then check the page:
   ```bash
   (cd apps/api && set -a && . ./.env && set +a && npx tsx src/index.ts > ../../.dev.log 2>&1 &)
   (cd apps/app && EXPO_PUBLIC_API_URL=http://localhost:3000 CI=1 npx expo start --web --port 8081 > ../../.expo.log 2>&1 &)
   sleep 25
   curl -s -o /dev/null -w "expo dev server: %{http_code}\n" http://localhost:8081/
   curl -s http://localhost:8081/ | grep -c '<div id="root">'
   ```
   Expected: `expo dev server: 200` and `1`. Then, if this session has a browser tool, open http://localhost:8081 and confirm the page shows `korbat` above `api ok · v0.0.0-dev` on a near-black background; otherwise ask the operator to open it and confirm. Read the console in a **newly opened tab** (an existing tab can still show errors from an earlier load): it must contain no error, only React's DevTools info line and the `Running application "main"` log. An error `Cannot manually set color scheme, as dark mode is type 'media'` means `darkMode: "class"` is missing from `tailwind.config.js`: STOP.
   Stop every korbat dev process and confirm the ports are free. Run this in PowerShell (not Git Bash): killing the listening PID from Git Bash leaves the `npx`/`tsx` parents running, and `wmic` does not work on current Windows.
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'korbat|apps/worker/dist/index\.js|apps/api/dist/index\.js|npx-cli\.js" (tsx src/index\.ts|expo start)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }
   Start-Sleep -Seconds 2
   foreach ($p in 3000, 8081) { "port ${p}: " + $(if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { 'BUSY' } else { 'free' }) }
   ```
   Expected: `port 3000: free` and `port 8081: free`. This matches only processes started from the korbat repo; never stop other node processes on the machine.
   Then run `rm -f .dev.log .expo.log`.
6. Run `git status --short` and confirm `apps/app/dist/` and `apps/app/.expo/` are absent. Commit:
   ```bash
   git add -A && git commit -m "feat(app): expo web shell with nativewind calling /api/health

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
   ```
7. Run `git log --oneline -1`. Expected subject: `feat(app): expo web shell with nativewind calling /api/health`.

## Report format (mandatory)

```
TASK 13 REPORT
Files created: <list>
Step 2 output (last line): <paste>
Step 3 output: <paste or "clean">
Step 4 output (Exported line, dist listing, script tag): <paste>
Step 5 output (two curl lines) and browser confirmation: <paste>
Step 7 output: <paste>
Recovery used (rule 5): yes/no
STOP condition hit: none | <exact output>
```
