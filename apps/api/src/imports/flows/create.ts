import { randomBytes, randomUUID } from "node:crypto";
import { CreateImportRequest, IMPORT_RULES, type ImportView } from "@korbat/contracts";
import { IMPORTER_HEARTBEAT_STALE_MS } from "@korbat/import-protocol";
import { ImportError, type ImportDeps } from "../context";
import { importView } from "../view";

/** A day, the window of the per-address limit (7.6, import-address-day). */
const DAY_MS = 24 * 60 * 60_000;

/**
 * POST /api/imports (3b design, section 4.2 step 3): creates an import in uploading. Its refusals come cheapest first and
 * in 4.2's order: a declared size over the cap (archive_too_large, before the body's other rules), imports switched off or
 * the source not among IMPORT_SOURCES (imports_unavailable), then, from the one statement that locks the profile row,
 * an account that is not live or is suspended (account_suspended), one younger than seven days or whose address is not
 * verified (import_too_soon), an active import (import_active), three published imports in seven days
 * (import_weekly_limit); then the address's five a day (rate_limited), the site's count of uploads and scans, the
 * importer's heartbeat and the free space for the archive and its scan (imports_unavailable). The last ones run inside
 * the creating transaction, so a refusal rolls the row back, and the address's count is given back for every import that
 * was not created. Nothing is written to a volume but the upload's empty folder, after the commit.
 */
export async function createImport(deps: ImportDeps, ownerId: string, body: unknown, addressKey: string): Promise<ImportView> {
  // The cap first: CreateImportRequest refuses a size over it like any malformed body, and this one has its own words.
  const declared = typeof body === "object" && body !== null ? (body as { bytes?: unknown }).bytes : undefined;
  if (typeof declared === "number" && declared > IMPORT_RULES.maxBytes) throw new ImportError("archive_too_large");
  const parsed = CreateImportRequest.safeParse(body);
  if (!parsed.success) throw new ImportError("invalid_request");
  const { source, bytes } = parsed.data;
  if (!deps.settings.imports || !deps.settings.sources.includes(source)) throw new ImportError("imports_unavailable");

  // The address is the auth module's, read before the transaction and judged in 4.2's order inside it.
  const verified = await deps.auth.emailVerified(ownerId);
  const id = randomUUID();
  const bucket = `imports:import-address-day:${addressKey}`;
  let counted = false;
  try {
    await deps.repo.create({ id, ownerId, source, bytes, images: deps.settings.images, verified, maxActive: deps.settings.maxActive, key: randomBytes(IMPORT_RULES.keyBytes) }, async (facts) => {
      if (!facts.live) throw new ImportError("account_suspended");
      if (!facts.aged || !verified) throw new ImportError("import_too_soon");
      if (facts.active) throw new ImportError("import_active");
      if (facts.week >= IMPORT_RULES.importsPerWeek) {
        const wait = facts.weekFreesAt === null ? 1 : Math.ceil((facts.weekFreesAt.getTime() - deps.now().getTime()) / 1000);
        throw new ImportError("import_weekly_limit", { retryAfterSeconds: Math.max(1, wait) });
      }
      let hit: { count: number; resetMs: number };
      try {
        hit = await deps.limits.hit(bucket, DAY_MS);
        counted = true;
      } catch {
        throw new ImportError("imports_unavailable");
      }
      if (hit.count > IMPORT_RULES.importsPerAddressDay) throw new ImportError("rate_limited", { retryAfterSeconds: Math.max(1, Math.ceil(hit.resetMs / 1000)) });
      if (facts.site >= deps.settings.maxActive) {
        deps.log.warn({ site: facts.site, maxActive: deps.settings.maxActive }, "import: refused, the site's uploads and scans are at IMPORT_MAX_ACTIVE");
        throw new ImportError("imports_unavailable");
      }
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age >= IMPORTER_HEARTBEAT_STALE_MS) {
        deps.log.error({ ageMs: age }, "import: refused, the importer's heartbeat is missing or stale");
        throw new ImportError("imports_unavailable");
      }
      // The archive, the most its scan may write to import-work (7.2), and the floor the owner keeps free.
      const needed = bytes + IMPORT_RULES.scanWriteBytes + deps.settings.minFreeBytes;
      const free = await deps.files.freeBytes().catch(() => -1);
      if (free < needed) {
        deps.log.error({ freeBytes: free, neededBytes: needed }, "import: refused, free space on import-archives is under what an import needs");
        throw new ImportError("imports_unavailable");
      }
    });
  } catch (err) {
    // An import that was not created costs the address nothing.
    if (counted) await deps.limits.release(bucket).catch(() => undefined);
    throw err;
  }
  // The upload's folder; its first chunk makes it again if this fails.
  await deps.files.ensureJobDir(id).catch((err: unknown) => deps.log.warn({ id, error: (err as NodeJS.ErrnoException).code }, "import: the upload's folder could not be made yet"));
  deps.log.info({ id, phase: "created", source, bytes }, "import: created");
  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  return importView(deps, row);
}
