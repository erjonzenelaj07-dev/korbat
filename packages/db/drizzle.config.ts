import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["public", "auth"],
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATE ?? "postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat",
  },
  strict: true,
  verbose: true,
});
