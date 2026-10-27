import { Readable } from "node:stream";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { IMPORT_RULES, type ImportSource, type ImportView } from "@korbat/contracts";
import { isImportId } from "@korbat/import-protocol";
import type { AppEnv } from "../env";
import { clientIpKey } from "../middleware/rate-limit";
import { ImportError, type ImportDeps } from "./context";
import { receiveChunk } from "./flows/chunk";
import { createImport } from "./flows/create";
import { cancelImport } from "./flows/end";
import { linesPage, mediaFile, pickLine } from "./flows/picks";
import { importView } from "./view";

const DECIMAL = /^(0|[1-9][0-9]{0,5})$/;

/** GET /api/imports: the account's imports and the sources a new one may name. */
export interface ImportList {
  imports: ImportView[];
  sources: ImportSource[];
}

/**
 * The imports routes (3b design, section 9.2), mounted at /api/imports after the session's resolution. `guard` is the auth
 * module's requireSession: an onboarded account, with CSRF and Origin checked for cookie sessions. Every route is the
 * owner's only: an import of anyone else is not_found. The chunk route's body is the raw chunk, which app.ts leaves out
 * of the JSON body limit and no validator reads first; it is streamed, never parsed. Confirm and stop come with Task 5,
 * undo with Task 6.
 */
export function importRoutes(deps: ImportDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;
  /** Only a lowercase UUID names an import, and becomes part of a path (7.1); anything else is no import. */
  const importId = (c: Context<AppEnv>): string => {
    const id = c.req.param("id") ?? "";
    if (!isImportId(id)) throw new ImportError("not_found");
    return id;
  };
  const json = async (c: Context<AppEnv>): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new ImportError("invalid_request");
    }
  };
  const own = async (c: Context<AppEnv>) => {
    const row = await deps.repo.find(importId(c), me(c));
    if (!row) throw new ImportError("not_found");
    return row;
  };

  r.post("/", guard, async (c) => c.json(await createImport(deps, me(c), await json(c), clientIpKey(c)), 201));

  r.get("/", guard, async (c) => {
    const rows = await deps.repo.list(me(c), IMPORT_RULES.listMax);
    const imports: ImportView[] = [];
    for (const row of rows) imports.push(await importView(deps, row));
    return c.json({ imports, sources: deps.settings.imports ? [...deps.settings.sources] : [] } satisfies ImportList);
  });

  r.get("/:id", guard, async (c) => c.json(await importView(deps, await own(c))));

  r.put("/:id/archive", guard, async (c) =>
    c.json(
      await receiveChunk(deps, me(c), importId(c), {
        offset: c.req.header("import-offset"),
        length: c.req.header("content-length"),
        sha256: c.req.header("import-chunk-sha256"),
        body: c.req.raw.body,
      }),
    ),
  );

  r.get("/:id/lines", guard, async (c) => {
    const page = c.req.query("page") ?? "0";
    if (!DECIMAL.test(page)) throw new ImportError("invalid_request");
    return c.json(await linesPage(deps, me(c), importId(c), Number(page)));
  });

  r.put("/:id/lines/:ref", guard, async (c) => {
    const ref = c.req.param("ref");
    if (!DECIMAL.test(ref) || Number(ref) >= IMPORT_RULES.maxPosts) throw new ImportError("not_found");
    return c.json(await pickLine(deps, me(c), importId(c), Number(ref), await json(c)));
  });

  r.get("/:id/media/:file", guard, async (c) => {
    const image = await mediaFile(deps, me(c), importId(c), c.req.param("file"));
    // The person's own image before anything checked it: never stored on the way, and read only as the type it sniffed as.
    c.header("Content-Type", image.type);
    c.header("Content-Length", String(image.size));
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(Readable.toWeb(image.handle.createReadStream({ start: 0 })) as ReadableStream<Uint8Array>);
  });

  r.post("/:id/cancel", guard, async (c) => c.json(await cancelImport(deps, me(c), importId(c))));

  return r;
}
