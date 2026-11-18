import { db } from "@/lib/db";
import { readSettings } from "@/server/settings";
import { toJson, parseJson } from "@/server/lib/json";
import { uuid } from "@/server/lib/ids";
import { audit } from "@/server/tenancy/guard";
import type { SessionCtx } from "@/server/tenancy/session";
import DOMPurify from "isomorphic-dompurify";

/** White-label service: branding, domains, registration form, widget, email config. */

export async function updateBranding(
  ctx: SessionCtx,
  patch: {
    name?: string;
    brandColor?: string;
    logoText?: string;
    businessCategory?: string;
    plan?: string;
  }
) {
  const sanitizedName = patch.name ? DOMPurify.sanitize(patch.name.trim(), { ALLOWED_TAGS: [] }) : undefined;
  const sanitizedLogo = patch.logoText ? DOMPurify.sanitize(patch.logoText.trim(), { ALLOWED_TAGS: [] }).slice(0, 3).toUpperCase() : undefined;

  const tenant = await db.tenant.update({
    where: { id: ctx.tenant.id },
    data: {
      ...(sanitizedName ? { name: sanitizedName } : {}),
      ...(patch.brandColor && /^#[0-9a-fA-F]{6}$/.test(patch.brandColor) ? { brandColor: patch.brandColor } : {}),
      ...(sanitizedLogo ? { logoText: sanitizedLogo } : {}),
      ...(patch.businessCategory ? { businessCategory: patch.businessCategory } : {}),
      ...(patch.plan ? { plan: patch.plan } : {}),
    },
  });
  await audit(ctx, "tenant.branding_updated", "tenant", tenant.id, patch);
  return tenant;
}

export async function updateModules(ctx: SessionCtx, modules: Record<string, boolean>) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant) return null;
  const settings = readSettings(tenant);
  const merged = { ...settings, modules: { ...settings.modules, ...modules } };
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { settings: toJson(merged) } });
  await audit(ctx, "tenant.modules_updated", "tenant", tenant.id, modules);
  return updated;
}

export async function updateChannelConfig(ctx: SessionCtx, channel: string, config: { enabled: boolean; fromName?: string; fromEmail?: string }) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant) return null;
  const settings = readSettings(tenant);
  if (!(channel in settings.channels)) return null;
  const merged = {
    ...settings,
    channels: {
      ...settings.channels,
      [channel]: { ...settings.channels[channel as keyof typeof settings.channels], ...config },
    },
  };
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { settings: toJson(merged) } });
  await audit(ctx, "tenant.channel_updated", "tenant", tenant.id, { channel, config });
  return updated;
}

export async function updateRegistrationFields(ctx: SessionCtx, fields: { key: string; label: string; required: boolean; active: boolean }[]) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant) return null;
  const settings = readSettings(tenant);
  const merged = { ...settings, registrationFields: fields };
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { settings: toJson(merged) } });
  await audit(ctx, "tenant.registration_fields_updated", "tenant", tenant.id, { count: fields.length });
  return updated;
}

export async function updateRetention(ctx: SessionCtx, retention: { archiveInactiveDays: number; feedbackRetentionMonths: number; eventRetentionDays: number }) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant) return null;
  const settings = readSettings(tenant);
  const merged = { ...settings, retention };
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { settings: toJson(merged) } });
  await audit(ctx, "tenant.retention_updated", "tenant", tenant.id, retention);
  return updated;
}

export async function updateLoyaltyRules(ctx: SessionCtx, rules: Record<string, number | boolean>) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant) return null;
  const settings = readSettings(tenant);
  const merged = { ...settings, loyalty: { ...settings.loyalty, ...rules } };
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { settings: toJson(merged) } });
  await audit(ctx, "tenant.loyalty_rules_updated", "tenant", tenant.id, rules);
  return updated;
}

export async function updateAutomationConfig(ctx: SessionCtx, patch: { birthdayLeadDays?: number; inactiveDays?: number }) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant) return null;
  const settings = readSettings(tenant);
  const merged = { ...settings, ...patch };
  const updated = await db.tenant.update({ where: { id: tenant.id }, data: { settings: toJson(merged) } });
  await audit(ctx, "tenant.automation_config_updated", "tenant", tenant.id, patch);
  return updated;
}

export async function configureDomain(ctx: SessionCtx, domain: string) {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
    throw Object.assign(new Error("Invalid domain"), { code: "invalid_domain" });
  }
  const clash = await db.tenant.findFirst({ where: { customDomain: clean, id: { not: ctx.tenant.id } } });
  if (clash) throw Object.assign(new Error("Domain already claimed by another business"), { code: "domain_taken" });
  const token = `gscf-verify-${uuid().slice(0, 13)}`;
  const tenant = await db.tenant.update({
    where: { id: ctx.tenant.id },
    data: { customDomain: clean, domainVerifiedAt: null, domainVerifyToken: token },
  });
  await audit(ctx, "tenant.domain_configured", "tenant", tenant.id, { domain: clean });
  return { domain: clean, token, verified: false, instructions: `Add this TXT record: _gscf-verify.${clean} = ${token}` };
}

export async function verifyDomain(ctx: SessionCtx) {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenant.id } });
  if (!tenant || !tenant.customDomain || !tenant.domainVerifyToken) {
    throw Object.assign(new Error("Configure a domain first"), { code: "no_domain" });
  }
  // Sandbox: DNS resolution is simulated deterministically — the exact
  // production check performs a live TXT lookup for the token.
  const simulatedOk = tenant.domainVerifyToken.startsWith("gscf-verify-");
  if (!simulatedOk) throw Object.assign(new Error("TXT record not found yet"), { code: "dns_not_found" });
  await db.tenant.update({ where: { id: tenant.id }, data: { domainVerifiedAt: new Date() } });
  await audit(ctx, "tenant.domain_verified", "tenant", tenant.id, { domain: tenant.customDomain });
  return { domain: tenant.customDomain, verified: true };
}

export function widgetSnippet(tenant: { slug: string; name: string; brandColor: string }) {
  return `<!-- GS ClientFlow widget for ${tenant.name} -->
<div id="gscf-widget" data-tenant="${tenant.slug}"></div>
<script>
(function(d, s, id) {
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) return;
  js = d.createElement(s); js.id = id;
  js.src = "https://cdn.gsclientflow.app/widget.js";
  js.async = true; js.dataset.tenant = "${tenant.slug}";
  js.dataset.brand = "${tenant.name}";
  js.dataset.color = "${tenant.brandColor}";
  fjs.parentNode.insertBefore(js, fjs);
})(document, "script", "gscf-widget-js");
</script>`;
}

export async function backupSnapshot(tenantId: string) {
  const [tenant, customers, visits, feedback, appointments, services, staff, offers, coupons, redemptions, rewardTxs, referralCodes, campaigns, workflows] =
    await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId } }),
      db.customer.findMany({ where: { tenantId } }),
      db.visit.findMany({ where: { tenantId }, orderBy: { occurredAt: "asc" } }),
      db.feedback.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
      db.appointment.findMany({ where: { tenantId }, orderBy: { startAt: "asc" } }),
      db.service.findMany({ where: { tenantId } }),
      db.staff.findMany({ where: { tenantId } }),
      db.offer.findMany({ where: { tenantId } }),
      db.coupon.findMany({ where: { tenantId } }),
      db.offerRedemption.findMany({ where: { tenantId } }),
      db.rewardTransaction.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
      db.referralCode.findMany({ where: { tenantId } }),
      db.campaign.findMany({ where: { tenantId } }),
      db.workflow.findMany({ where: { tenantId } }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    format: "gscf-tenant-snapshot/1",
    tenant: tenant ? { ...tenant, settings: parseJson(tenant.settings, {}) } : null,
    counts: {
      customers: customers.length, visits: visits.length, feedback: feedback.length,
      appointments: appointments.length, services: services.length, staff: staff.length,
      offers: offers.length, coupons: coupons.length, redemptions: redemptions.length,
      rewardTransactions: rewardTxs.length, referralCodes: referralCodes.length,
      campaigns: campaigns.length, workflows: workflows.length,
    },
    data: {
      customers, visits, feedback, appointments, services, staff, offers,
      coupons, redemptions, rewardTransactions: rewardTxs, referralCodes, campaigns, workflows,
    },
  };
}
