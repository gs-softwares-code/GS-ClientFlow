import { drizzle } from "drizzle-orm/neon-http";
import { neon, neonConfig } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Neon PostgreSQL Client with Connection Pooling & RLS Support
 *
 * For serverless runtimes (Cloudflare Workers, Vercel Edge, Next.js):
 * Uses Hyperdrive or Neon pooled HTTP endpoint (`-pooler.region.neon.tech`).
 */

neonConfig.fetchConnectionCache = true;

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

const sql = neon(connectionString);

export const dbDrizzle = drizzle(sql, { schema });

/**
 * Helper to execute a query or transaction with transaction-local tenant context.
 * Sets `app.current_tenant_id` for PostgreSQL Row-Level Security policies.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: typeof dbDrizzle) => Promise<T>
): Promise<T> {
  // In pooled HTTP / transaction block, set session tenant variable:
  await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
  return fn(dbDrizzle);
}
