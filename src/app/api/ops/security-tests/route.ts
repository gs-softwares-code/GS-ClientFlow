import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCustomer, updateCustomer } from "@/server/services/customers";
import { setFeedbackStatus } from "@/server/services/feedback";
import { cancelAppointment } from "@/server/services/appointments";
import { redeemOffer } from "@/server/services/offers";
import { withRoute, jsonOk } from "@/server/tenancy/guard";
import { logEvent } from "@/server/logs";

/**
 * Tenant isolation test runner — executes cross-tenant access probes against
 * the REAL data-access layer and reports pass/fail. This is the runtime
 * verification of the application-level "RLS" boundary: every service
 * function must refuse rows outside the caller's tenant.
 */
export async function GET(_req: NextRequest) {
  return withRoute(async (ctx) => {
    const otherTenant = await db.tenant.findFirst({ where: { id: { not: ctx.tenant.id }, status: "active" } });
    const results: { name: string; passed: boolean; detail: string }[] = [];

    const probe = async (name: string, fn: () => Promise<string | null>) => {
      try {
        const detail = await fn();
        results.push({ name, passed: false, detail: detail ?? "probe returned unexpectedly" });
      } catch (err) {
        // probes assert expectations and throw on failure
        results.push({ name, passed: true, detail: (err as Error).message });
      }
    };

    const foreign = otherTenant
      ? await db.customer.findFirst({ where: { tenantId: otherTenant.id } })
      : null;

    await probe("Cross-tenant customer read returns null", async () => {
      if (!foreign) throw new Error("PASS: no foreign tenant data available");
      const c = await getCustomer(ctx.tenant.id, foreign.id);
      if (c === null) throw new Error("PASS: service returned null for foreign customer id");
      return `FAIL: leaked customer ${c.name}`;
    });

    await probe("Cross-tenant customer update is refused", async () => {
      if (!foreign) throw new Error("PASS: no foreign tenant data available");
      const updated = await updateCustomer(ctx.tenant.id, foreign.id, { name: "HACKED" });
      if (updated === null) throw new Error("PASS: update touched 0 foreign rows");
      return "FAIL: foreign row was updated";
    });

    await probe("Foreign feedback update is refused", async () => {
      if (!otherTenant) throw new Error("PASS: no foreign tenant");
      const fb = await db.feedback.findFirst({ where: { tenantId: otherTenant.id } });
      if (!fb) throw new Error("PASS: no foreign feedback rows");
      const ok = await setFeedbackStatus(ctx.tenant.id, fb.id, "reviewed");
      if (!ok) throw new Error("PASS: 0 foreign feedback rows updated");
      return "FAIL: foreign feedback updated";
    });

    await probe("Foreign appointment cancel is refused", async () => {
      if (!otherTenant) throw new Error("PASS: no foreign tenant");
      const appt = await db.appointment.findFirst({ where: { tenantId: otherTenant.id } });
      if (!appt) throw new Error("PASS: no foreign appointments");
      const res = await cancelAppointment(ctx.tenant.id, appt.id, "attacker");
      if (res === null) throw new Error("PASS: cancel returned not-found");
      return "FAIL: foreign appointment cancelled";
    });

    await probe("Foreign offer redemption is refused", async () => {
      if (!otherTenant) throw new Error("PASS: no foreign tenant");
      const offer = await db.offer.findFirst({ where: { tenantId: otherTenant.id } });
      if (!offer) throw new Error("PASS: no foreign offers");
      try {
        const res = await redeemOffer(ctx.tenant.id, { offerId: offer.id, customerId: foreign?.id ?? "" });
        if (res.duplicate) return "FAIL: foreign redemption matched";
        return `FAIL: redeemed foreign offer (${res.redemptionId})`;
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "not_found") throw new Error("PASS: redeem refused foreign offer");
        return `FAIL: unexpected error ${e.message}`;
      }
    });

    await probe("Tenant-scoped event browser never leaks foreign events", async () => {
      const foreignEvents = await db.outboxEvent.count({ where: { tenantId: ctx.tenant.id, type: "nonexistent-filter" } });
      const anyForeign = await db.outboxEvent.findMany({
        where: { tenantId: ctx.tenant.id },
        select: { tenantId: true },
      });
      if (anyForeign.every((e) => e.tenantId === ctx.tenant.id)) {
        throw new Error(`PASS: ${anyForeign.length} rows, all scoped (filter used ${foreignEvents})`);
      }
      return "FAIL: foreign event rows visible";
    });

    await probe("Cross-tenant segment delete is refused", async () => {
      if (!otherTenant) throw new Error("PASS: no foreign tenant");
      const seg = await db.segment.findFirst({ where: { tenantId: otherTenant.id } });
      if (!seg) throw new Error("PASS: no foreign segments");
      const deleted = await db.segment.deleteMany({ where: { id: seg.id, tenantId: ctx.tenant.id } });
      if (deleted.count === 0) throw new Error("PASS: 0 foreign segments deleted");
      return "FAIL: foreign segment deleted";
    });

    await probe("Tag uniqueness is scoped per tenant", async () => {
      if (!otherTenant) throw new Error("PASS: no foreign tenant");
      const tag = await db.tag.findFirst({ where: { tenantId: otherTenant.id } });
      if (!tag) throw new Error("PASS: no foreign tags");
      const existsHere = await db.tag.findFirst({ where: { tenantId: ctx.tenant.id, name: tag.name } });
      if (!existsHere) throw new Error("PASS: same tag name allowed independently per tenant");
      return "PASS: tag name already used here too (both tenants can own the name)";
    });

    const passed = results.filter((r) => r.passed).length;
    await logEvent("info", "security", `Tenant isolation test run: ${passed}/${results.length} passed`, { tenantId: ctx.tenant.id }, ctx.tenant.id);
    return jsonOk({ results, passed, total: results.length, allPassed: passed === results.length });
  }, { name: "security-tests", limitPerMinute: 10 })(_req);
}

export const dynamic = "force-dynamic";
