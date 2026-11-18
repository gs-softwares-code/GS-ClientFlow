import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";

/**
 * AI template assistant — drafts a campaign message using the LLM skill
 * (z-ai-web-dev-sdk, backend-only). Falls back to a graceful error so the
 * composer still works if the AI service is unavailable.
 */
export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string; tone?: string; channel?: string; audience?: string;
    };
    if (!body.goal?.trim()) return jsonError("bad_request", "Describe what the message should achieve", 400);

    const channel = body.channel ?? "email";
    const tone = body.tone ?? "warm";
    const audience = body.audience ?? "existing customers";

    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              `You are a CRM copywriter for a ${ctx.tenant.businessCategory.replace("_", " ")} business called "${ctx.tenant.name}". ` +
              `Write a short ${channel} message (${channel === "sms" ? "under 160 characters" : "2-4 sentences"}), ${tone} tone, addressed with the placeholder {name}. ` +
              `Reply ONLY with the message text — no subject line, no quotes, no explanation.`,
          },
          {
            role: "user",
            content: `Goal: ${body.goal}\nAudience: ${audience}\nChannel: ${channel}`,
          },
        ],
        thinking: { type: "disabled" },
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) return jsonError("ai_empty", "The AI returned an empty draft — try again", 502);
      await audit(ctx, "ai.template_drafted", "campaign", undefined, { goal: body.goal.slice(0, 120) });
      return jsonOk({ draft: text });
    } catch (err) {
      return jsonError("ai_unavailable", `AI drafting is temporarily unavailable (${err instanceof Error ? err.message : "unknown error"})`, 502);
    }
  }, { name: "ai-draft", limitPerMinute: 6 })(req);
}

export const dynamic = "force-dynamic";
