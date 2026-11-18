import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/server/tenancy/guard";
import { rateLimitOrThrow } from "@/server/ratelimit";
import { processGuardianReply } from "@/server/services/attendance";
import { updateMembershipPayment } from "@/server/services/memberships";
import { setAppointmentStatus } from "@/server/services/appointments";
import { timingSafeEqualStrings } from "@/server/lib/encryption";
import crypto from "crypto";

/**
 * Public Inbound Channel Webhook Receiver
 * Handles incoming WhatsApp parent responses, payment gateway callbacks,
 * and automated external confirmations with HMAC verification and rate limiting.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Rate limiting & Arcjet Shield
    await rateLimitOrThrow(req, "webhook-inbound-channel", 120);

    const rawBody = await req.text();
    const signature = req.headers.get("x-gs-signature") || req.headers.get("x-signature-256");
    const webhookSecret = process.env.INBOUND_WEBHOOK_SECRET;

    // 2. Cryptographic signature check if webhook secret is configured
    if (webhookSecret && signature) {
      const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody, "utf8")
        .digest("hex");
      if (!timingSafeEqualStrings(signature, expected)) {
        return jsonError("unauthorized", "Invalid cryptographic signature", 401);
      }
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonError("bad_request", "Invalid JSON payload", 400);
    }

    const tenantId = (payload.tenantId as string) || req.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return jsonError("bad_request", "tenantId parameter or payload property required", 400);
    }

    const type = (payload.type as string) || "whatsapp_reply";

    // Scenario A: Parent replies to coaching attendance WhatsApp message
    if (type === "whatsapp_reply" || type === "attendance_reply") {
      const attendanceId = payload.attendanceId as string;
      const rawText = String(payload.message || payload.text || "").trim();

      if (!attendanceId) {
        return jsonError("bad_request", "attendanceId is required for parent replies", 400);
      }

      // Recognize interactive numbers (1/2) or keyword intent
      let replyType: "LEAVE" | "LATE" | "OTHER" = "OTHER";
      const normalized = rawText.toLowerCase();

      if (normalized === "1" || normalized.includes("leave") || normalized.includes("chutti") || normalized.includes("sick")) {
        replyType = "LEAVE";
      } else if (normalized === "2" || normalized.includes("late") || normalized.includes("running late") || normalized.includes("traffic")) {
        replyType = "LATE";
      }

      const updated = await processGuardianReply(tenantId, attendanceId, replyType, rawText);
      return jsonOk({
        success: true,
        type: "attendance_reply_processed",
        replyType,
        updated,
      });
    }

    // Scenario B: Payment Gateway Callback (Razorpay / Stripe / UPI)
    if (type === "payment_callback" || type === "membership_payment") {
      const membershipId = payload.membershipId as string;
      const status = payload.status === "failed" ? "OVERDUE" : "PAID";

      if (!membershipId) {
        return jsonError("bad_request", "membershipId is required", 400);
      }

      const updated = await updateMembershipPayment(tenantId, membershipId, status);
      return jsonOk({
        success: true,
        type: "membership_payment_processed",
        membership: updated,
      });
    }

    // Scenario C: Appointment Reschedule or Status Change
    if (type === "appointment_update") {
      const appointmentId = payload.appointmentId as string;
      const status = payload.status as string;

      if (!appointmentId || !status) {
        return jsonError("bad_request", "appointmentId and status are required", 400);
      }

      await setAppointmentStatus(tenantId, appointmentId, status);
      return jsonOk({
        success: true,
        type: "appointment_status_updated",
      });
    }

    return jsonOk({ success: true, message: "Webhook acknowledged", type });
  } catch (err) {
    if ((err as Error & { code?: string }).code === "rate_limited") {
      return jsonError("rate_limited", (err as Error).message, 429);
    }
    console.error("[Inbound Webhook Error]:", err);
    return jsonError("internal", "Inbound webhook processing error", 500);
  }
}

export const dynamic = "force-dynamic";
