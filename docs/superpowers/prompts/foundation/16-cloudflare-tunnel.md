# korbat Foundation — Task 16 of 16: Cloudflare Tunnel

You are executing the final task of an approved implementation plan. The compose service and the local checks below were verified on 2026-09-13; the tunnel itself needs the operator's Cloudflare account, so the dashboard steps are theirs. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend running as a Docker Compose stack (Task 14). The server never opens an inbound port: a `cloudflared` container makes an outbound connection to Cloudflare, and Cloudflare routes public traffic for the chosen hostname through that tunnel to Caddy inside the Docker network. This keeps the server's IP private (important later on a home connection) while keeping Cloudflare's WAF, DDoS absorption, edge rate limits, Turnstile, and CSAM scanning in front.

This task proves that path end to end: create the tunnel, route a hostname to `caddy:80`, run `cloudflared` under its Compose profile, and verify from the public internet that `/api/health` answers with a `cf-ray` header and that no host port is published in the production configuration.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. **Docker Desktop running** with the Task 14 stack up. A Cloudflare account with a domain whose DNS is on Cloudflare (Zero Trust is free for this). The operator does the dashboard steps; you cannot log in for them. Ask for the exact hostname they chose and use it wherever `<your-domain>` appears.
- The `cloudflared` service is behind the Compose profile `tunnel`, so it only starts with `--profile tunnel`. The token goes in `infra/.env` (gitignored) as `TUNNEL_TOKEN`. Routing is configured in the Cloudflare dashboard, so nothing else is committed.

## Preconditions

`git log --oneline -1` must show `ci: typecheck, tests, audit, semgrep, compose validation; supply-chain hardening; renovate`. `docker compose -f infra/compose.yml ps` shows `api` healthy and `caddy` up. `infra/.env` exists.

## Rules (read twice)

1. Never paste the tunnel token into a tracked file, the report, or chat. It belongs only in `infra/.env`.
2. Do not modify `infra/compose.yml`; the `cloudflared` service and profile already exist.
3. Compare each command's output with the **Expected** text. A missing `Registered tunnel connection` line, a health response without `cf-ray`, or any published `0.0.0.0:` port in step 4 is a **STOP condition**: stop, write the report with the exact output (token redacted), and end the session.
4. Commit exactly once, at the end, with the exact message given.
5. The report format at the bottom is mandatory.

## Steps

### Step 1: Create the tunnel (operator, in the Cloudflare dashboard)
Tell the operator to:
1. Open Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → name it `korbat-dev` → Save.
2. On the install screen choose Docker and copy only the token (the long string after `--token`).
3. Public Hostname tab → Add a public hostname: Subdomain `dev`, their domain, Service type `HTTP`, URL `caddy:80` → Save.
4. Put the token into `infra/.env` as `TUNNEL_TOKEN=<token>`.
Wait for the operator to confirm the hostname (for example `dev.example.com`) before continuing.

### Step 2: Start the tunnel service
```bash
docker compose -f infra/compose.yml --profile tunnel up -d cloudflared
sleep 8
docker compose -f infra/compose.yml logs cloudflared | grep -c "Registered tunnel connection"
```
Expected: a number of at least `1` (normally `4`). If `0`, run `docker compose -f infra/compose.yml logs cloudflared | tail -10`; an `Unauthorized` or `invalid token` line means the token was pasted incompletely; STOP and report.

### Step 3: Verify from outside
```bash
curl -s https://dev.<your-domain>/api/health; echo
curl -sI https://dev.<your-domain>/ | grep -iE "^(cf-ray|content-security-policy|server):"
curl -s -o /dev/null -w "%{http_code}\n" https://dev.<your-domain>/api/me
```
Expected: the health JSON with all checks `ok`; three header lines: `cf-ray: ...`, `content-security-policy: default-src 'self'; ...`, `server: cloudflare`; and `401`. Ask the operator to open `https://dev.<your-domain>` in a browser: the korbat shell renders and shows `api ok`.

### Step 4: Confirm nothing is exposed directly
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down
docker compose -f infra/compose.yml --profile tunnel up -d
docker compose -f infra/compose.yml ps --format "table {{.Name}}\t{{.Ports}}"
curl -s https://dev.<your-domain>/api/health; echo
```
Expected `Ports` column (verified format):
```
korbat-api-1        3000/tcp
korbat-caddy-1      80/tcp, 443/tcp, 2019/tcp, 443/udp
korbat-cloudflared-1
korbat-minio-1      9000/tcp
korbat-postgres-1   5432/tcp
korbat-redis-1      6379/tcp
korbat-worker-1
```
No entry may contain `0.0.0.0:` or `->`. The health curl still succeeds because traffic flows only through the tunnel.

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
git status --short
```
Expected: clean status; `infra/.env` untracked and unlisted.

### Step 6: Foundation sign-off
Run each and report pass/fail:
1. `pnpm typecheck && pnpm test` → six `Done` lines; Tests 6, 4, 9, 4, `19 passed | 1 skipped`.
2. The three "permission denied" checks from Task 8 step 7 still print the exact errors.
3. `docker compose -f infra/compose.yml --profile tunnel ps` → every long-running service `Up`, `api` `(healthy)`.
4. `https://dev.<your-domain>/api/health` responds with `cf-ray`.
5. No published host ports in the production configuration (Step 4).
6. The browser shell loads with no CSP console errors (operator confirmation).

## Report format (mandatory)

```
TASK 16 REPORT
Hostname used (never the token): <paste>
Step 2 output: <paste>
Step 3 output: <paste>
Step 4 table + health line: <paste>
Step 5 status output: <paste>
Sign-off 1-6: <pass/fail each, with the evidence line>
STOP condition hit: none | <exact output, token redacted>
```
