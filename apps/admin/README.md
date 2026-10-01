# @korbat/admin

The staff console of sub-project 3a (`docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`): a React page bundled by esbuild with plain CSS, built into Caddy's image and served by Caddy's console site on `CONSOLE_ORIGIN`, an origin of its own apart from the app's. Cloudflare Access in front of it is an optional extra gate. The page talks only to `/api/staff/*` on its own origin, and only a staff key opens it: sign-in, enrolment from a link `staff.js enroll` printed, the home screen (who is signed in, every staff account's sign-ins of the last 7 days, your staff sessions, your keys) and the audit log. Cases arrive in sub-project 3c.

It runs under a strict Content Security Policy with Trusted Types (`site-headers.mjs`, which Caddy's console site sends too): scripts, styles, images and requests from its own origin only, and no HTML or script sink at all. Every string a person wrote is rendered as text, zod is jitless, and no link is built from data; `test/source.test.ts` keeps it so.

## Commands

```bash
pnpm --filter @korbat/admin build   # dist/: index.html, the hashed bundle and stylesheet under assets/, favicon.svg
pnpm --filter @korbat/admin dev     # esbuild in watch mode and the console on http://localhost:8090
pnpm --filter @korbat/admin test    # server-rendered screens, the page's logic, source scans, the build and the dev server
pnpm --filter @korbat/admin typecheck
```

The development server serves the build with the console site's headers, the policy included, on `127.0.0.1:8090` (`--port <number>` moves it: `pnpm --filter @korbat/admin dev --port 8091`), and forwards `/api/staff/*` to the API at `http://localhost:3000` with the `Host` header kept, so the API's staff gate sees the console's host. Start the API first (`pnpm --filter @korbat/api dev`) with `CONSOLE_ORIGIN=http://localhost:8090` in `apps/api/.env` (`node scripts/gen-dev-env.mjs` adds it), naming the same port. Open the console at `http://localhost:8090`, never `127.0.0.1`: browsers refuse WebAuthn on an IP address. A page that says the console is not available at this address means the API answered `/api/staff/me` with 404: `CONSOLE_ORIGIN` is unset, or names another address.
