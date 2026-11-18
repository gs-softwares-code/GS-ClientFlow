import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Tenant } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionCtx, type SessionCtx } from "@/server/tenancy/session";
import { readSettings, type TenantSettings } from "@/server/settings";
import { rateLimit, pruneBuckets, arcjetEvaluate } from "@/server/ratelimit";
import { meterUsage } from "@/server/usage";
import { logEvent } from "@/server/logs";
import { toJson } from "@/server/lib/json";

/**
 * Central API Security Guard — Every session and public route passes through here:
 *   1. Perimeter WAF (Arcjet Shield / Bot Protection)
 *   2. Session authentication (tenant context is resolved server-side only)
 *   3. Transactional tenant-scoped rate limiting (no cross-tenant noisy-neighbor DoS)
 *   4. Usage metering & audit trail logging
 *   5. Uniform error envelope & structured logging
 */

export type PublicCtx = { tenant: Tenant; settings: TenantSettings; ip: string };

export function jsonOk(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as Record<string, unknown>, init);
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
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

export type RouteParams = { params: Promise<Record<string, string>> } | undefined;

export function withRoute(
  handler: (ctx: SessionCtx, req: NextRequest, params: Record<string, string>) => Promise<NextResponse>,
  opts: { name?: string; limitPerMinute?: number } = {}
): (req: NextRequest, route?: RouteParams) => Promise<NextResponse> {
  return async (req: NextRequest, route: RouteParams) => {
    const url = new URL(req.url);
    const routeName = opts.name ?? url.pathname;
    let tenantIdForLog: string | undefined;

    try {
      // 1. Layer 1: Perimeter WAF evaluation (Arcjet Shield)
      const waf = await arcjetEvaluate(req);
      if (!waf.allowed) {
        return jsonError("waf_blocked", waf.reason || "Request blocked by perimeter security policy", 403);
      }

      // 2. Layer 2: Authenticate session
      const ctx = await getSessionCtx();
      if (!ctx) return jsonError("unauthorized", "Sign in required", 401);

      tenantIdForLog = ctx.tenant.id;

      // 3. Layer 3: Tenant-scoped rate limiting
      const rl = rateLimit(
        `t:${ctx.tenant.id}:${routeName}`,
        opts.limitPerMinute ?? 90,
        opts.limitPerMinute ? opts.limitPerMinute / 60 : 1.5
      );
      if (!rl.ok) {
        await logEvent("warn", "ratelimit", `429 on ${routeName}`, { route: routeName }, ctx.tenant.id);
        return jsonError("rate_limited", "Too many requests — slow down", 429, { retryAfterMs: rl.retryAfterMs });
      }

      await meterUsage(ctx.tenant.id, "requests");
      if (Math.random() < 0.03) pruneBuckets();

      // Resilient parameter resolution
      let params: Record<string, string> = {};
      if (route?.params) {
        params = await route.params;
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 3 && parts[0] === "api") {
          params = { id: parts[2] };
          if (parts[1] === "export") {
            params = { report: parts[2] };
          }
        }
      }

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
      // 1. Layer 1: Perimeter WAF evaluation
      const waf = await arcjetEvaluate(req);
      if (!waf.allowed) {
        return jsonError("waf_blocked", waf.reason || "Request blocked by perimeter security policy", 403);
      }

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

      let params: Record<string, string> = {};
      if (route?.params) {
        params = await route.params;
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 3 && parts[0] === "api") {
          params = { id: parts[2] };
        }
      }

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
