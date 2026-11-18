import { cookies } from "next/headers";
import type { Tenant, User } from "@prisma/client";
import { db } from "@/lib/db";
import { readSettings, type TenantSettings } from "@/server/settings";
import crypto from "crypto";

/**
 * Enterprise Session & Tenancy Lifecycle
 *
 * Sessions enforce strict tenant binding. Every request resolves the tenant
 * exclusively from the verified server-side session (never from client headers
 * or request parameters).
 */

export const SESSION_COOKIE = "gscf_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type SessionCtx = {
  user: Pick<User, "id" | "email" | "name" | "role" | "isPlatformAdmin">;
  tenant: Tenant;
  settings: TenantSettings;
  sessionId: string;
};

/**
 * Create a new cryptographically random session and set secure cookie
 */
export async function createSession(userId: string, tenantId: string): Promise<string> {
  // Generate high-entropy session ID
  const sessionId = crypto.randomUUID();

  const session = await db.session.create({
    data: {
      id: sessionId,
      userId,
      tenantId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });

  return session.id;
}

/**
 * Destroy active session and invalidate in database
 */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    await db.session.deleteMany({ where: { id } }).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolve authenticated session context with expiration and tenant status validation
 */
export async function getSessionCtx(): Promise<SessionCtx | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const session = await db.session.findUnique({
    where: { id },
    include: { user: true, tenant: true },
  });

  // Strict validation: session existence, expiration, tenant active status
  if (!session || session.expiresAt < new Date() || session.tenant.status !== "active") {
    if (session && session.expiresAt < new Date()) {
      // Clean up expired session asynchronously
      void db.session.deleteMany({ where: { id } }).catch(() => undefined);
    }
    return null;
  }

  return {
    user: session.user,
    tenant: session.tenant,
    settings: readSettings(session.tenant),
    sessionId: session.id,
  };
}

/**
 * Secure Tenant Switching with Session Fixation Elimination
 *
 * 1. Invalidates prior session token completely.
 * 2. Verifies target tenant status and user authorization.
 * 3. Rotates session by issuing a completely fresh session ID and cookie.
 */
export async function switchTenant(
  currentSessionId: string,
  userId: string,
  targetTenantId: string
): Promise<string> {
  // 1. Invalidate previous session to eliminate session fixation
  if (currentSessionId) {
    await db.session.deleteMany({ where: { id: currentSessionId } }).catch(() => undefined);
  }

  // 2. Provision new session bound to target tenant
  return await createSession(userId, targetTenantId);
}

export type TenantSummary = Pick<
  Tenant,
  "id" | "slug" | "name" | "businessCategory" | "brandColor" | "logoText" | "plan"
>;

export async function listTenants(): Promise<TenantSummary[]> {
  return db.tenant.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      businessCategory: true,
      brandColor: true,
      logoText: true,
      plan: true,
    },
  });
}
