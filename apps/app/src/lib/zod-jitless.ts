import { z } from "zod";

// The app's page runs under a policy that allows no script compiled from a string (script-src 'self' and Turnstile only;
// infra/caddy/Caddyfile, app_page_headers). Unless zod is jitless, the first object schema it builds probes whether it
// may compile code from a string, which the browser reports as a policy violation even though zod catches the failure
// (the console found the same, apps/admin/src/zod-jitless.ts). The contracts build their schemas as soon as they are
// imported, and expo-router loads layouts while it builds the route tree, before the root layout runs, so the app's
// entry (apps/app/index.ts) imports this module first, and it imports nothing but zod.
z.config({ jitless: true });
