import type { Config } from "drizzle-kit";

/**
 * Drizzle ORM configuration for Neon PostgreSQL with version-controlled migrations.
 * Production migrations directory: src/db/migrations
 */

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/gsclientflow",
  },
} satisfies Config;
