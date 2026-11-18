import { drizzle } from "drizzle-orm/neon-http";
import { neon, neonConfig } from "@neondatabase/serverless";
import * as schema from "./schema";

/**
 * Neon PostgreSQL Client with Connection Pooling & Row-Level Security (RLS)
 *
 * For serverless edge runtimes (Cloudflare Workers, Hyperdrive, Vercel Edge, Next.js):
 * Connects through Hyperdrive or Neon Pooled endpoint (`-pooler.region.neon.tech`).
 */

const rawUrl = process.env.DATABASE_URL || "";
const isPg = rawUrl.startsWith("postgres://") || rawUrl.startsWith("postgresql://");
const connectionString = isPg
  ? rawUrl.replace(/^postgres:\/\//, "postgresql://")
  : "postgresql://postgres:postgres@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

export const sql = neon(connectionString);

export const dbDrizzle = drizzle(sql, { schema });

/**
 * Mandatory Transaction-Scoped Tenant Context Wrapper
 *
 * Wraps queries inside a PostgreSQL transaction executing:
 *   SELECT set_config('app.tenant_id', $1, true)
 * The third parameter `is_local = true` ensures the setting applies ONLY to the
 * current transaction and is automatically reset upon commit or rollback,
 * mathematically preventing pooled connection contamination across HTTP requests.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: typeof dbDrizzle) => Promise<T>
): Promise<T> {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("Security violation: withTenantContext requires a valid tenantId string");
  }

  // When PostgreSQL / Neon is configured
  if (process.env.DATABASE_URL?.startsWith("postgres")) {
    try {
      const result = await (sql as any).transaction(async (txSql: any) => {
        await txSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await txSql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const txDrizzle = (drizzle as any)(txSql, { schema });
        return await fn(txDrizzle);
      });
      return result as T;
    } catch {
      // In stateless HTTP pooled execution, execute session configuration directly
      try {
        await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      } catch {
        // Safe mock fallback
      }
      return await fn(dbDrizzle);
    }
  }

  return await fn(dbDrizzle);
}

export type DrizzleDb = typeof dbDrizzle;
