import { cookies } from "next/headers";
import type { Tenant, User } from "@prisma/client";
import { db } from "@/lib/db";
import { readSettings, type TenantSettings } from "@/server/settings";

/**
 * Cookie-backed sessions. The session row binds a user to ONE tenant; every
 * request resolves the tenant from the session (never from user input), which
 * is the application-level equivalent of Postgres RLS session variables.
 */

export const SESSION_COOKIE = "gscf_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionCtx = {
  user: Pick<User, "id" | "email" | "name" | "role" | "isPlatformAdmin">;
  tenant: Tenant;
  settings: TenantSettings;
};

export async function createSession(userId: string, tenantId: string): Promise<string> {
  const session = await db.session.create({
    data: { userId, tenantId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return session.id;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    await db.session.deleteMany({ where: { id } }).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
}

export async function getSessionCtx(): Promise<SessionCtx | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const session = await db.session.findUnique({
    where: { id },
    include: { user: true, tenant: true },
  });
  if (!session || session.expiresAt < new Date() || session.tenant.status !== "active") return null;

  return {
    user: session.user,
    tenant: session.tenant,
    settings: readSettings(session.tenant),
  };
}

/** Platform demo admin can switch tenant context (used by the isolation tester). */
export async function switchTenant(userId: string, tenantId: string): Promise<void> {
  await createSession(userId, tenantId);
}

export type TenantSummary = Pick<
  Tenant,
  "id" | "slug" | "name" | "businessCategory" | "brandColor" | "logoText" | "plan"
>;

export async function listTenants(): Promise<TenantSummary[]> {
  return db.tenant.findMany({
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
