import { NextRequest } from "next/server";
import { setFeedbackStatus, markFollowUpDone } from "@/server/services/feedback";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

export async function PATCH(req: NextRequest) {
  return withRoute(async (ctx, request, params) => {
    const body = (await request.json().catch(() => ({}))) as { status?: string; followUpDone?: boolean };
    if (body.followUpDone) {
      const ok = await markFollowUpDone(ctx.tenant.id, params.id);
      if (!ok) return jsonError("not_found", "Feedback not found", 404);
      await audit(ctx, "feedback.followup_done", "feedback", params.id);
      return jsonOk({ ok: true });
    }
    if (body.status) {
      const ok = await setFeedbackStatus(ctx.tenant.id, params.id, body.status);
      if (!ok) return jsonError("not_found", "Feedback not found", 404);
      await audit(ctx, "feedback.status_changed", "feedback", params.id, { status: body.status });
      return jsonOk({ ok: true });
    }
    return jsonError("bad_request", "Nothing to update", 400);
  }, { name: "feedback-update" })(req);
}

export const dynamic = "force-dynamic";
