import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { defaultSettings } from "@/server/settings";
import { toJson } from "@/server/lib/json";
import { createSession } from "@/server/tenancy/session";
import { jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import { ensureReferralCode } from "@/server/services/loyalty";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { rateLimitOrThrow } from "@/server/ratelimit";

/**
 * Enterprise Business Self-Service Registration / Onboarding
 * Allows a new business to sign up, provision a tenant, and initialize its owner account.
 * Guarded by Arcjet / sliding window rate limiting.
 */

export async function POST(req: NextRequest) {
  try {
    // Explicit rate limit enforcement
    await rateLimitOrThrow(req, "auth-register-business", 5);

    const body = (await req.json().catch(() => ({}))) as {
      businessName?: string;
      slug?: string;
      category?: string;
      ownerName?: string;
      ownerEmail?: string;
      brandColor?: string;
    };

    const businessName = (body.businessName ?? "").trim();
    const rawSlug = (body.slug ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-");
    const category = body.category || "services";
    const ownerName = (body.ownerName ?? "").trim();
    const ownerEmail = (body.ownerEmail ?? "").trim().toLowerCase();
    const brandColor = body.brandColor || "#0f766e";

    if (!businessName) return jsonError("bad_request", "Business name is required", 400);
    if (!rawSlug || rawSlug.length < 3) {
      return jsonError("bad_request", "Valid business slug (at least 3 alphanumeric characters) is required", 400);
    }
    if (!ownerName) return jsonError("bad_request", "Owner name is required", 400);
    if (!ownerEmail || !ownerEmail.includes("@")) return jsonError("bad_request", "Valid owner email is required", 400);

    // Check slug collision
    const existingTenant = await db.tenant.findUnique({ where: { slug: rawSlug } });
    if (existingTenant) {
      return jsonError("conflict", `Business subdomain '${rawSlug}' is already taken. Please choose another slug.`, 409);
    }

    // Monogram (first 2 letters)
    const logoText = businessName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "GC";

    // Atomically provision Tenant + Owner User + Default Modules + Session
    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: businessName,
          slug: rawSlug,
          businessCategory: category,
          brandColor,
          logoText,
          plan: "starter",
          status: "active",
          settings: toJson(defaultSettings(category)),
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: ownerName,
          email: ownerEmail,
          role: "owner",
          isPlatformAdmin: false,
        },
      });

      // Initialize default loyalty code rule
      return { tenant, user };
    });

    // Create session cookie
    await createSession(result.user.id, result.tenant.id);

    return jsonOk({
      success: true,
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        brandColor: result.tenant.brandColor,
        logoText: result.tenant.logoText,
        businessCategory: result.tenant.businessCategory,
        plan: result.tenant.plan,
      },
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
      },
    });
  } catch (err) {
    if ((err as Error & { code?: string }).code === "rate_limited" || (err as Error).message.includes("Rate limit")) {
      return jsonError("rate_limited", (err as Error).message, 429);
    }
    console.error("[Business Registration Error]:", err);
    return jsonError("internal", "Failed to register new business", 500);
  }
}

export const dynamic = "force-dynamic";
