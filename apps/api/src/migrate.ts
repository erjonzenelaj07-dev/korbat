import path from "node:path";
import { runMigrations } from "@korbat/db/migrate";

const url = process.env.DATABASE_URL_MIGRATE;
if (!url) throw new Error("DATABASE_URL_MIGRATE is required");
const folder = path.resolve(process.env.MIGRATIONS_DIR ?? "../../packages/db/migrations");

runMigrations(url, folder)
  .then(() => { console.log(`migrations applied from ${folder}`); })
  .catch((err) => { console.error(err); process.exit(1); });
