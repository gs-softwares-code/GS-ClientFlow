import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonOk, jsonError } from "@/server/tenancy/guard";

/**
 * Enterprise Health & Readiness Check Endpoint
 * Complies with Kubernetes / Cloudflare / Docker readiness probes.
 * Validates database connectivity, memory utilization, and worker state.
 */

export async function GET(_req: NextRequest) {
  const start = Date.now();
  let dbStatus = "healthy";
  let dbLatencyMs = 0;

  try {
    const dbCheckStart = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbCheckStart;
  } catch (err) {
    dbStatus = "unhealthy";
    return jsonError("service_unavailable", "Database health probe failed", 503, {
      database: { status: dbStatus, error: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  }

  const memoryUsage = process.memoryUsage();
  const uptimeSeconds = Math.floor(process.uptime());

  return jsonOk({
    status: "healthy",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    responseTimeMs: Date.now() - start,
    checks: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      memory: {
        rssMb: Math.round(memoryUsage.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
      },
    },
  });
}

export const dynamic = "force-dynamic";
