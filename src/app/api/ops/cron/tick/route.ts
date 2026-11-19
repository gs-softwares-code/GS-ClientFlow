import { NextRequest, NextResponse } from "next/server";
import { drainOutboxBatch } from "@/server/events/worker";
import { evaluateScheduledTriggers } from "@/server/events/scheduler";
import { getSessionCtx } from "@/server/tenancy/session";

/**
 * Enterprise Cron Execution Endpoint
 *
 * Securing scheduled background workers in Vercel Serverless environment:
 * 1. Authenticated via Vercel Cron header: Authorization: Bearer ${process.env.CRON_SECRET}
 * 2. Authenticated via active OWNER / ADMIN ops session
 */
export async function GET(req: NextRequest) {
  return handleCronTick(req);
}

export async function POST(req: NextRequest) {
  return handleCronTick(req);
}

async function handleCronTick(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  let authorized = false;

  // 1. Check Bearer token matching CRON_SECRET if configured
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true;
  }

  // 2. Fall back to active owner/admin session check
  if (!authorized) {
    const session = await getSessionCtx();
    if (session && (session.user.role === "owner" || session.user.role === "admin" || session.user.isPlatformAdmin)) {
      authorized = true;
    }
  }

  // 3. Fall back to Vercel internal cron header check (x-vercel-cron header)
  if (!authorized && req.headers.get("x-vercel-cron") === "1" && !cronSecret) {
    authorized = true;
  }

  if (!authorized) {
    return NextResponse.json(
      { error: "Unauthorized: Missing or invalid CRON_SECRET or administrative session" },
      { status: 401 }
    );
  }

  try {
    const [workerResult, schedulerResult] = await Promise.all([
      drainOutboxBatch({ limit: 50 }),
      evaluateScheduledTriggers(),
    ]);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      worker: workerResult,
      scheduler: schedulerResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Cron execution crashed", message },
      { status: 500 }
    );
  }
}

export const dynamic = "force-dynamic";
