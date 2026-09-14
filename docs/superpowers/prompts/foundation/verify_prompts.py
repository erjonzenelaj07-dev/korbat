"""Prove the Foundation prompts reproduce the repository byte for byte.

For every file a prompt creates, extract the fenced block and compare it with the file on disk.
Files built from several blocks (appends) are assembled the same way the prompts build them.
Run from the korbat repo root. Exit code 1 on any mismatch.
"""
import pathlib
import re
import sys

D = pathlib.Path("docs/superpowers/prompts/foundation")


def block(prompt, heading, occurrence=1):
    lines = (D / prompt).read_text(encoding="utf-8").split("\n")
    seen = 0
    for i, line in enumerate(lines):
        if line.startswith("### ") and heading in line:
            seen += 1
            if seen != occurrence:
                continue
            j = i + 1
            while not lines[j].startswith("```"):
                j += 1
            fence = re.match(r"^`+", lines[j]).group(0)
            k = j + 1
            out = []
            while lines[k] != fence:
                out.append(lines[k])
                k += 1
            return "\n".join(out) + "\n"
    raise SystemExit(f"{prompt}: heading not found: {heading}")


SIMPLE = {
    "01-repo-scaffold.md": {
        "### `package.json`": "package.json",
        "`tsconfig.base.json`": "tsconfig.base.json",
        "`.gitattributes`": ".gitattributes",
        "`.editorconfig`": ".editorconfig",
        "`README.md`": "README.md",
    },
    "02-contracts.md": {f"packages/contracts/{p}`": f"packages/contracts/{p}" for p in ["package.json", "tsconfig.json", "test/contracts.test.ts", "src/index.ts"]},
    "03-rules.md": {f"packages/rules/{p}`": f"packages/rules/{p}" for p in ["package.json", "tsconfig.json", "test/rules.test.ts", "src/index.ts"]},
    "04-db-auth-schema.md": {f"packages/db/{p}`": f"packages/db/{p}" for p in ["package.json", "tsconfig.json", "src/schema/helpers.ts", "src/schema/auth.ts"]},
    "05-db-content-schema.md": {f"packages/db/{p}`": f"packages/db/{p}" for p in ["src/schema/identity.ts", "src/schema/content.ts"]},
    "06-db-safety-schema.md": {"packages/db/src/schema/safety.ts`": "packages/db/src/schema/safety.ts"},
    "07-db-client-migrations.md": {
        "### `packages/db/src/index.ts`": "packages/db/src/index.ts",
        "### `packages/db/src/migrate.ts`": "packages/db/src/migrate.ts",
        "### `packages/db/drizzle.config.ts`": "packages/db/drizzle.config.ts",
        "0001_grants.sql`": "packages/db/migrations/0001_grants.sql",
    },
    "08-infra-data-services.md": {
        "infra/postgres/init/01-roles.sh`": "infra/postgres/init/01-roles.sh",
        "infra/.env.example`": "infra/.env.example",
    },
    "09-api-config-logger.md": {f"apps/api/{p}`": f"apps/api/{p}" for p in ["package.json", "tsconfig.json", "test/config.test.ts", "test/logger.test.ts", "src/config.ts", "src/lib/logger.ts"]},
    "10-api-middleware.md": {f"apps/api/{p}`": f"apps/api/{p}" for p in [
        "test/middleware.test.ts", "src/env.ts", "src/lib/errors.ts", "src/lib/validate.ts",
        "src/middleware/observability.ts", "src/middleware/security-headers.ts", "src/middleware/rate-limit.ts", "src/middleware/session.ts"]},
    "11-api-app-health.md": {f"apps/api/{p}`": f"apps/api/{p}" for p in [
        "test/app.test.ts", "src/routes/health.ts", "src/app.ts", "src/index.ts", "src/migrate.ts",
        "tsup.config.ts", ".env.example", "test/integration/health.test.ts", "vitest.integration.config.ts"]},
    "12-worker.md": {f"apps/worker/{p}`": f"apps/worker/{p}" for p in ["package.json", "tsconfig.json", "tsup.config.ts", "test/jobs.test.ts", "src/jobs.ts", "src/index.ts"]},
    "13-expo-app.md": {f"apps/app/{p}`": f"apps/app/{p}" for p in [
        "package.json", "app.json", "tsconfig.json", ".gitignore", "global.css", "tailwind.config.js", "babel.config.js",
        "metro.config.js", "nativewind-env.d.ts", "src/lib/api.ts", "src/app/_layout.tsx", "src/app/index.tsx"]},
    "14-docker-compose-stack.md": {
        "Create `.dockerignore`": ".dockerignore",
        "Create `apps/api/Dockerfile`": "apps/api/Dockerfile",
        "Create `apps/worker/Dockerfile`": "apps/worker/Dockerfile",
        "Create `infra/caddy/Dockerfile`": "infra/caddy/Dockerfile",
        "Create `infra/caddy/Caddyfile`": "infra/caddy/Caddyfile",
        "Replace `infra/compose.yml`": "infra/compose.yml",
        "Replace `infra/compose.dev.yml`": "infra/compose.dev.yml",
    },
}

COMPOSITE = {
    "packages/db/test/schema.test.ts": [
        ("04-db-auth-schema.md", "packages/db/test/schema.test.ts`"),
        ("05-db-content-schema.md", "Append to the END of `packages/db/test/schema.test.ts`"),
        ("06-db-safety-schema.md", "Append to the END of `packages/db/test/schema.test.ts`"),
    ],
    "packages/db/src/schema/index.ts": [
        ("05-db-content-schema.md", "Replace the whole content of `packages/db/src/schema/index.ts`"),
        ("06-db-safety-schema.md", "Append to the END of `packages/db/src/schema/index.ts`"),
    ],
}

bad = []
count = 0
for prompt, mapping in SIMPLE.items():
    for heading, path in mapping.items():
        count += 1
        if block(prompt, heading) != pathlib.Path(path).read_text(encoding="utf-8"):
            bad.append(f"{path}  <-  {prompt}")
for path, parts in COMPOSITE.items():
    count += 1
    if "".join(block(p, h) for p, h in parts) != pathlib.Path(path).read_text(encoding="utf-8"):
        bad.append(f"{path}  <-  " + " + ".join(p for p, _ in parts))

print(f"compared {count} files against their prompts")
if bad:
    print("MISMATCHES:")
    print("\n".join("  " + b for b in bad))
    sys.exit(1)
print("prompts reproduce the repository exactly")
