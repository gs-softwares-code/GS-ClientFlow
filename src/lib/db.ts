import { PrismaClient } from "@prisma/client";
export { dbDrizzle, withTenantContext, sql as neonSql } from "@/db/index";
export * as drizzleSchema from "@/db/schema";

/**
 * GS ClientFlow Unified Database Layer
 *
 * In production (Neon PostgreSQL), Drizzle ORM provides canonical, version-controlled
 * migrations and transactional RLS context (`withTenantContext`).
 *
 * In local development and sandboxes, PrismaClient provides SQLite runtime compatibility
 * matching the schema 1:1.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
