import { defineConfig } from "drizzle-kit";

// ponytail: tables are also auto-created on boot (CREATE TABLE IF NOT EXISTS in db/client.ts);
// this config exists only so `db:generate` works if you prefer real migrations.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DATABASE_URL?.replace(/^file:/, "") ?? "./data/browserpilot.sqlite" },
});
