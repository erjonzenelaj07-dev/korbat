# korbat Foundation — Task 16 of 16: Cloudflare Tunnel

You are executing the final task of an approved implementation plan. Do this task completely, verify it, commit it, and report. Do nothing beyond it.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend running as a Docker Compose stack (Task 14). The security design says the server never opens an inbound port: a `cloudflared` container makes an outbound connection to Cloudflare, and Cloudflare routes public traffic for the chosen hostname through that tunnel to Caddy inside the Docker network. This keeps the server's IP private (important later on a home connection) while still giving the app Cloudflare's WAF, DDoS absorption, edge rate limits, Turnstile, and CSAM scanning. The admin console will later sit on its own hostname behind Cloudflare Access.

This task proves that path end to end: create the tunnel, route a hostname to `caddy:80`, run the `cloudflared` service under its Compose profile, and verify from the public internet that `/api/health` answers with a `cf-ray` header and that no host port is published in the production configuration.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. **Docker Desktop running** with the Task 14 stack up. A Cloudflare account with a domain whose DNS is on Cloudflare (Zero Trust is free for this use). The human operator must do the dashboard steps; you cannot log in for them. Ask for the exact hostname they chose and use it wherever `<your-domain>` appears below.
- Notes: the `cloudflared` service is behind the Compose profile `tunnel`, so it only starts with `--profile tunnel`. The token goes in `infra/.env` (gitignored) as `TUNNEL_TOKEN`. Routing is configured in the Cloudflare dashboard, not in a local config file, so there is nothing else to commit.
- Full plan: `docs/superpowers/plans/2026-09-03-foundation.md` (Task 16).

## Preconditions

`git log --oneline -1` must show `ci: typecheck, tests, audit, semgrep, compose validation; renovate`. `docker compose -f infra/compose.yml ps` shows `api` and `caddy` healthy. `infra/.env` exists.

## Rules

1. Never paste the tunnel token into a file that is tracked by git, into the report, or into chat. It belongs only in `infra/.env`.
2. Do not modify `infra/compose.yml`; the `cloudflared` service and profile are already defined.
3. Verify before claiming; paste real output (with the token redacted if it ever appears in a log).
4. Commit exactly once at the end with the given message and trailer.

## Steps

### Step 1: Create the tunnel (operator does this in the Cloudflare dashboard)
Tell the operator to:
1. Open Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → name it `korbat-dev` → Save.
2. On the install screen pick Docker and copy only the token (the long string after `--token`), not the whole command.
3. Public Hostname tab → Add a public hostname: Subdomain `dev`, their domain, Service type `HTTP`, URL `caddy:80` → Save.
4. Paste the token into `infra/.env` as `TUNNEL_TOKEN=<token>` (replace the empty value).
Wait for the operator to confirm the hostname (for example `dev.example.com`) before continuing.

### Step 2: Start the tunnel service
```bash
docker compose -f infra/compose.yml --profile tunnel up -d cloudflared
sleep 5
docker compose -f infra/compose.yml logs cloudflared | tail -8
```
Expected: lines containing `Registered tunnel connection` (usually four, one per edge location). An `Unauthorized` or `invalid token` line means the token was pasted incompletely.

### Step 3: Verify from outside
```bash
curl -s https://dev.<your-domain>/api/health
curl -sI https://dev.<your-domain>/ | grep -i -E "^(cf-ray|content-security-policy|server):"
curl -s -o /dev/null -w "%{http_code}\n" https://dev.<your-domain>/api/me
```
Expected: health JSON with all checks `ok`; a `cf-ray` header (Cloudflare is in front), the CSP header (Caddy served it), and `server: cloudflare`; `/api/me` returns `401`. Ask the operator to open `https://dev.<your-domain>` in a browser: the korbat shell renders and shows `api ok`.

### Step 4: Confirm nothing is exposed directly
Restart the stack in the production configuration (no dev override) and list ports:
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down
docker compose -f infra/compose.yml --profile tunnel up -d
docker compose -f infra/compose.yml ps --format "table {{.Name}}\t{{.Ports}}"
```
Expected: the `Ports` column is empty for every service, including `api` and `caddy` (Postgres, Redis, and MinIO show only internal `/tcp` entries with no `0.0.0.0:` mapping). Re-run the Step 3 health curl; it must still succeed because traffic now flows only through the tunnel.

### Step 5: Record the environment and commit
Append to `README.md`:
```markdown

## Environments

- dev: https://dev.<your-domain> (Cloudflare Tunnel `korbat-dev`, `docker compose -f infra/compose.yml --profile tunnel up -d`)
```
Then:
```bash
git add README.md && git commit -m "docs: dev environment hostname

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Confirm `git status --short` is clean and `infra/.env` is untracked.

### Step 6: Foundation sign-off
Run the complete definition-of-done for sub-project 0 and report each line as pass/fail:
1. `pnpm typecheck && pnpm test` pass (43 tests, 1 skipped integration).
2. Role isolation: the three "permission denied" checks from Task 8 still hold (re-run them).
3. `docker compose -f infra/compose.yml --profile tunnel ps` shows every long-running service healthy/running.
4. `https://dev.<your-domain>/api/health` responds through the tunnel with `cf-ray`.
5. No published host ports in the production configuration.
6. The browser shell loads with no CSP console errors.

## Report format

- The hostname used (never the token)
- Output of Steps 2, 3, and 4
- The six sign-off results from Step 6
- Deviations and why
- Anything blocked or uncertain
