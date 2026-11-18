import type { Tenant } from "@prisma/client";
import { parseJson } from "@/server/lib/json";

/** Typed tenant settings (stored as JSON text on Tenant.settings). */

export type RegistrationField = {
  key: string; // name | email | phone | birthday | address | concern | referral
  label: string;
  required: boolean;
  active: boolean;
};

export type ChannelConfig = { enabled: boolean; label: string; fromName?: string; fromEmail?: string };

export type LoyaltyRules = {
  enabled: boolean;
  pointsPerVisit: number;
  pointsPerFeedback: number;
  pointsPerReferral: number;
  pointsPerHundredRupees: number;
  referralBonus: number;
  redemptionMinimum: number;
};

export type TenantSettings = {
  modules: {
    appointments: boolean;
    loyalty: boolean;
    campaigns: boolean;
    feedback: boolean;
    whiteLabel: boolean;
  };
  channels: Record<"email" | "sms" | "whatsapp", ChannelConfig>;
  registrationFields: RegistrationField[];
  loyalty: LoyaltyRules;
  retention: {
    archiveInactiveDays: number;
    feedbackRetentionMonths: number;
    eventRetentionDays: number;
  };
  birthdayLeadDays: number;
  inactiveDays: number;
  emailFrom: string;
};

const BASE_REGISTRATION: RegistrationField[] = [
  { key: "name", label: "Full name", required: true, active: true },
  { key: "email", label: "Email", required: true, active: true },
  { key: "phone", label: "Phone", required: false, active: true },
  { key: "birthday", label: "Birthday", required: false, active: true },
  { key: "referral", label: "Referral code (optional)", required: false, active: true },
  { key: "concern", label: "What can we help you with?", required: false, active: false },
];

const CATEGORY_PRESETS: Record<string, Partial<TenantSettings>> = {
  salon_spa: {
    registrationFields: BASE_REGISTRATION.map((f) => (f.key === "concern" ? { ...f, label: "Which service are you most interested in?", active: true } : f)),
  },
  dental: {
    registrationFields: BASE_REGISTRATION.map((f) => (f.key === "concern" ? { ...f, label: "When was your last check-up?", active: true } : f)),
  },
  clinic: {
    registrationFields: BASE_REGISTRATION.map((f) => (f.key === "concern" ? { ...f, label: "Primary health concern", active: true } : f)),
  },
  retail: { modules: { appointments: false, loyalty: true, campaigns: true, feedback: true, whiteLabel: true } },
  services: {},
  food: {},
};

export function defaultSettings(businessCategory: string): TenantSettings {
  const base: TenantSettings = {
    modules: { appointments: true, loyalty: true, campaigns: true, feedback: true, whiteLabel: true },
    channels: {
      email: { enabled: true, label: "Email", fromName: "Team", fromEmail: "hello@gsclientflow.app" },
      sms: { enabled: true, label: "SMS" },
      whatsapp: { enabled: false, label: "WhatsApp" },
    },
    registrationFields: BASE_REGISTRATION,
    loyalty: {
      enabled: true,
      pointsPerVisit: 10,
      pointsPerFeedback: 25,
      pointsPerReferral: 100,
      pointsPerHundredRupees: 5,
      referralBonus: 100,
      redemptionMinimum: 200,
    },
    retention: { archiveInactiveDays: 365, feedbackRetentionMonths: 24, eventRetentionDays: 90 },
    birthdayLeadDays: 7,
    inactiveDays: 45,
    emailFrom: "hello@gsclientflow.app",
  };
  const preset = CATEGORY_PRESETS[businessCategory];
  return preset ? deepMerge(base, preset) : base;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const current = out[k];
    out[k] = isPlainObject(v) && isPlainObject(current) ? deepMerge(current, v) : v;
  }
  return out as T;
}

export function readSettings(tenant: Pick<Tenant, "settings" | "businessCategory">): TenantSettings {
  const defaults = defaultSettings(tenant.businessCategory);
  return deepMerge(defaults, parseJson<Record<string, unknown>>(tenant.settings, {}));
}
