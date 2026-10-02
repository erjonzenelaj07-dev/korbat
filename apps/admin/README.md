# @korbat/admin

The staff console of sub-project 3a (`docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`): a React page bundled by esbuild with plain CSS, built into Caddy's image and served by Caddy's console site on `CONSOLE_ORIGIN`, an origin of its own apart from the app's. Cloudflare Access in front of it is an optional extra gate. The page talks only to `/api/staff/*` on its own origin, and only a staff key opens it: sign-in, enrolment from a link `staff.js enroll` printed, the home screen (who is signed in, every staff account's sign-ins of the last 7 days, your staff sessions, your keys) and the audit log. Cases arrive in sub-project 3c.

It runs under a strict Content Security Policy with Trusted Types (`site-headers.mjs`, which Caddy's console site sends too): scripts, styles, images and requests from its own origin only, and no HTML or script sink at all. Every string a person wrote is rendered as text, zod is jitless, and no link is built from data; `test/source.test.ts` keeps it so.

## Commands

```bash
pnpm --filter @korbat/admin build   # dist/: index.html, the hashed bundle and stylesheet under assets/, favicon.svg
pnpm --filter @korbat/admin dev     # esbuild in watch mode and the console on http://localhost:8090
pnpm --filter @korbat/admin test    # server-rendered screens, the page's logic, source scans, the build and the dev server
pnpm --filter @korbat/admin test:browser   # every screen in Chromium under the console site's policy (below)
pnpm --filter @korbat/admin typecheck
```

The development server serves the build with the console site's headers, the policy included, on `127.0.0.1:8090` (`--port <number>` moves it: `pnpm --filter @korbat/admin dev --port 8091`), and forwards `/api/staff/*` to the API at `http://localhost:3000` with the `Host` header kept, so the API's staff gate sees the console's host. Start the API first (`pnpm --filter @korbat/api dev`) with `CONSOLE_ORIGIN=http://localhost:8090` in `apps/api/.env` (`node scripts/gen-dev-env.mjs` adds it), naming the same port. Open the console at `http://localhost:8090`, never `127.0.0.1`: browsers refuse WebAuthn on an IP address. A page that says the console is not available at this address means the API answered `/api/staff/me` with 404: `CONSOLE_ORIGIN` is unset, or names another address.

Caddy's console site (`infra/caddy/Caddyfile`, port 8090 in its container) sends exactly the headers of `site-headers.mjs`: `test/console-site.test.ts` reads the Caddyfile and compares the two, checks that the development server takes its headers from that module alone, and checks the site's routes (`/api/staff` and `/api/staff/*` to the API, any other `/api` path Caddy's own 404, everything else the console's files from `/console`) and that the app's site refuses the staff API ahead of its API proxy.

The browser check (`test/browser/`) builds the console into a temporary folder and serves it from a small Node server with the routes and headers of Caddy's console site, read from `infra/caddy/Caddyfile`, so the page is tested under the policy Caddy really sends. The server answers `/api/staff/*` from fixtures held in memory, whose handles, key names and browser labels are hostile: markup, `javascript:` URLs, a direction override and the longest names allowed. playwright-core then drives Chromium with a CDP virtual authenticator over every screen: the console switched off, enrolment (a synced passkey refused and explained, then a device-bound key that verifies its user), sign-in, home, a session revoked with the key, step-up options that bind another action refused before the key is asked, the audit log, an unknown address, the ended session and sign-out. Any policy report (the page's `securitypolicyviolation` events, Chromium's console and the CDP Log, DevTools issues), any page error and any dialog fails it. It needs no database or API and writes nothing outside its temporary folder. It never downloads a browser: by default it uses the Chromium build playwright-core 1.63.0 names (`chromium-1243` under `ms-playwright`), which must already be installed, and with `KORBAT_BROWSER_CHANNEL=chrome` it uses the machine's own Chrome, as CI does.
