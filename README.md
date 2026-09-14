# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
cp infra/.env.example infra/.env            # then edit passwords
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis minio minio-init   # dev host ports 55432, 56379, 59000, 59001
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health
pnpm --filter @korbat/app web               # http://localhost:8081
```
