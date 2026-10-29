# The card lab

`card-lab.mjs` checks korbat's share cards in Caddy itself (2d design, sections 8.2 and 12.4), without the rest of the
stack and without fetching any real site. It starts the Caddy image built from `infra/caddy/Dockerfile` beside a stub API
of a few lines (Caddy again, from the same image) that answers the card routes as the API would, and asks for every page
from this machine and from a client on the push network.

## Running it

From the repository root, with Docker running:

```
node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab
node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab --image korbat-caddy
```

- `--prefix` names everything the lab makes: the image `<prefix>-caddy` (when it builds one), the networks
  `<prefix>-app` and `<prefix>-push`, and the containers `<prefix>-api`, `<prefix>-caddy` and `<prefix>-client`. The lab
  removes all of them at its end, whether it passed or not, and touches no other image, network or container.
- `--image` uses an image already built, such as the stack's Caddy after `docker compose build`. Without it the lab builds
  one with Cloudflare's Turnstile test key and a development contact address; the web export runs inside, which takes
  minutes.
- `--port` (18381 by default) is the local port the lab's Caddy listens on, at 127.0.0.1 only.
- `--push-subnet` (172.16.193.0/24 by default) is the push network's subnet, which the lab gives Caddy as `PUSH_SUBNET`.
  It must not overlap a network Docker already has.

It prints one line a check, its measurements, and `card lab passed`; otherwise each failed check and `card lab FAILED`,
with exit code 1.

## What it checks

- `caddy list-modules` lists `http.handlers.templates`, and `card.html` is the exported `index.html` with one line more:
  the template action right after the charset's meta element, the file's only `{{`. robots.txt in `/srv` is
  `infra/caddy/robots.txt`.
- `/post/card` and `/u/card`, whose card route answers 204 with a block: `card.html` with the block decoded once in its
  head, status 200, `Cache-Control: no-cache`, `X-Robots-Tag: noindex` and the shell's security headers; the
  `Korbat-Card` header never reaches the client. The profile's block is just under the API's bound of 4,096 bytes and both
  hold a four-byte character.
- A block holding `{{ .Env }}` and `{{env "HOME"}}`, unescaped, is printed as text: neither Caddy's environment nor its
  `HOME` appears.
- A card route's 404 gives the plain shell with 404; its 429 the plain shell with 200; an API that drops the connection
  the plain shell with 200 through `handle_errors`; for a post's page and a profile's.
- `/card.html` asked by its own path answers 404 with no body; `/robots.txt` answers the file byte for byte.
- `X-Robots-Tag: noindex` on `/post/`, `/u/`, `/settings/appearance` and a `handle_errors` answer, and none on `/`,
  `/rules`, `/transparency`, `/explore/about` and `/terms`.
- A client on the push network is answered 403 on `/u/x` and `/post/x`.
- Each fetcher of `crawlers.json` (Twitterbot, facebookexternalhit with Meta's `Range: bytes=0-524288`,
  Slackbot-LinkExpanding with a range, Discordbot, LinkedInBot and Mastodon's fetcher, all with
  `Accept-Encoding: gzip, deflate` and no cookie) gets the same answer on both pages as a request with no User-Agent: a
  whole 200, never 206, with the Open Graph tags within the first 524,288 bytes and before `<title>`, which is `korbat`.

## crawlers.json

The request shapes of the link-preview fetchers, as their official pages give them (korbat-scratch/research-2d/inputs.md,
sections 3.2 and 3.3); a `note` says where a value is not from an official page. `robotsToken` is the agent's name in
`robots.txt`, null for a fetcher it does not name. The console's test `console-site.test.ts` holds the named agents of
`robots.txt` equal to these tokens, and the stack's smoke test reads Twitterbot's User-Agent from here.
