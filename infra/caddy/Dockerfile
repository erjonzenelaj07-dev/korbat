FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
# Whether the account settings show the verified badge section (WEB_BADGE in infra/.env): on only when the API's
# verification provider is on, off by default as the provider is. Anything else is refused, so a typo cannot hide or show it.
ARG EXPO_PUBLIC_BADGE=off
RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac
# The users' contact address (WEB_CONTACT_EMAIL in infra/.env), inlined like the site key: the report form names it when
# the form itself cannot be used, and the terms page shows it. A build without an address is refused, and a production
# build refuses a placeholder domain, as it refuses a Turnstile test key: mail to it would reach nobody.
ARG EXPO_PUBLIC_CONTACT_EMAIL
RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" npx expo export --platform web

# The staff console (apps/admin), in a stage of its own: its page takes no build argument and holds no secret, and its
# packages never meet the app's. esbuild writes dist/: index.html, favicon.svg and the hashed script and stylesheet.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS console
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --frozen-lockfile --filter @korbat/admin...
RUN pnpm --filter @korbat/admin build

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The console's site serves /console, a folder outside the app's /srv, so the app's site can never serve the console.
COPY --from=console /repo/apps/admin/dist /console
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Ports 8080 and 8090 need no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on ports it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
# The app's site and the staff console's.
EXPOSE 8080 8090
