import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Tenant } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionCtx, type SessionCtx } from "@/server/tenancy/session";
import { readSettings, type TenantSettings } from "@/server/settings";
import { rateLimit, pruneBuckets } from "@/server/ratelimit";
import { meterUsage } from "@/server/usage";
import { logEvent } from "@/server/logs";
import { toJson } from "@/server/lib/json";

/**
 * Central API guard — every session route goes through here:
 *   1. authenticate the session (tenant is resolved server-side only)
 *   2. tenant-scoped rate limiting
 *   3. usage metering
 *   4. uniform error envelope + structured logs
 *
 * This is the app-level equivalent of a Postgres `SET LOCAL app.tenant_id`
 * + RLS policy: handlers never receive a tenant id from the client.
 */

export type PublicCtx = { tenant: Tenant; settings: TenantSettings; ip: string };

export function jsonOk(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as Record<string, unknown>, init);
}

export function jsonError(code: string, message: string, status: number, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type RouteParams = { params: Promise<Record<string, string>> } | undefined;

export function withRoute(
  handler: (ctx: SessionCtx, req: NextRequest, params: Record<string, string>) => Promise<NextResponse>,
  opts: { name?: string; limitPerMinute?: number } = {}
): (req: NextRequest, route?: RouteParams) => Promise<NextResponse> {
  return async (req: NextRequest, route: RouteParams) => {
    const url = new URL(req.url);
    const routeName = opts.name ?? url.pathname;
    let tenantIdForLog: string | undefined;
    try {
      const ctx = await getSessionCtx();
      if (!ctx) return jsonError("unauthorized", "Sign in required", 401);

      tenantIdForLog = ctx.tenant.id;
      const rl = rateLimit(`t:${ctx.tenant.id}:${routeName}`, opts.limitPerMinute ?? 90, opts.limitPerMinute ? opts.limitPerMinute / 60 : 1.5);
      if (!rl.ok) {
        await logEvent("warn", "ratelimit", `429 on ${routeName}`, { route: routeName }, ctx.tenant.id);
        return jsonError("rate_limited", "Too many requests — slow down", 429, { retryAfterMs: rl.retryAfterMs });
      }
      await meterUsage(ctx.tenant.id, "requests");
      if (Math.random() < 0.03) pruneBuckets();

      const params = route?.params ? await route.params : {};
      return await handler(ctx, req, params);
    } catch (err) {
      if (err instanceof ApiError) {
        await logEvent("warn", "api", `${err.code}: ${err.message}`, { route: routeName }, tenantIdForLog);
        return jsonError(err.code, err.message, err.status);
      }
      const message = err instanceof Error ? err.message : "Unexpected error";
      await logEvent("error", "api", `Unhandled error on ${routeName}: ${message}`, { route: routeName }, tenantIdForLog);
      return jsonError("internal", "Internal server error", 500);
    }
  };
}

export function withPublicRoute(
  handler: (ctx: PublicCtx, req: NextRequest, params: Record<string, string>) => Promise<NextResponse>,
  opts: { name?: string; limitPerMinute?: number } = {}
): (req: NextRequest, route?: RouteParams) => Promise<NextResponse> {
  return async (req: NextRequest, route: RouteParams) => {
    const url = new URL(req.url);
    const routeName = opts.name ?? url.pathname;
    try {
      const slug = url.searchParams.get("tenant") ?? req.headers.get("x-gscf-tenant") ?? "";
      if (!slug) return jsonError("bad_request", "Missing tenant slug (?tenant=)", 400);

      const tenant = await db.tenant.findUnique({ where: { slug } });
      if (!tenant || tenant.status !== "active") return jsonError("not_found", "Unknown business", 404);

      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "local";
      const rl = rateLimit(`ip:${ip}:${routeName}`, opts.limitPerMinute ?? 10, (opts.limitPerMinute ?? 10) / 60);
      if (!rl.ok) {
        await logEvent("warn", "ratelimit", `429 (public) on ${routeName}`, { ip }, tenant.id);
        return jsonError("rate_limited", "Too many requests — try again shortly", 429, { retryAfterMs: rl.retryAfterMs });
      }

      const params = route?.params ? await route.params : {};
      return await handler({ tenant, settings: readSettings(tenant), ip }, req, params);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonError(err.code, err.message, err.status);
      }
      const message = err instanceof Error ? err.message : "Unexpected error";
      await logEvent("error", "api", `Unhandled public error on ${routeName}: ${message}`, { route: routeName });
      return jsonError("internal", "Internal server error", 500);
    }
  };
}

export async function audit(
  ctx: SessionCtx | PublicCtx,
  action: string,
  entity: string,
  entityId?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  const actorId = "user" in ctx ? ctx.user.id : null;
  const actorLabel = "user" in ctx ? `${ctx.user.name} (${ctx.user.role})` : "public";
  await db.auditLog
    .create({
      data: { tenantId: ctx.tenant.id, actorId, actorLabel, action, entity, entityId, meta: toJson(meta ?? {}) },
    })
    .catch(() => undefined);
}
