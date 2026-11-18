import { NextResponse } from "next/server";
import { destroySession } from "@/server/tenancy/session";

export async function POST(): Promise<NextResponse> {
  await destroySession();
  return NextResponse.json({ ok: true });
}
