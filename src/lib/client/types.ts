"use client";

/** Shared client-side DTOs (mirrors of the API responses). */

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isPlatformAdmin: boolean;
};

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  businessCategory: string;
  brandColor: string;
  logoText: string;
  plan: string;
};

export type RegistrationField = {
  key: string;
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
  modules: { appointments: boolean; loyalty: boolean; campaigns: boolean; feedback: boolean; whiteLabel: boolean };
  channels: Record<"email" | "sms" | "whatsapp", ChannelConfig>;
  registrationFields: RegistrationField[];
  loyalty: LoyaltyRules;
  retention: { archiveInactiveDays: number; feedbackRetentionMonths: number; eventRetentionDays: number };
  birthdayLeadDays: number;
  inactiveDays: number;
  emailFrom: string;
};

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
  businessCategory: string;
  brandColor: string;
  logoText: string;
  plan: string;
  customDomain?: string | null;
  domainVerifiedAt?: string | null;
  settings: TenantSettings;
};

export type UsageSnapshot = {
  plan: string;
  metrics: {
    metric: string;
    today: number;
    last30d: number;
    limit: number;
    limitLabel: string;
    window: string;
    pct: number;
  }[];
};

export type EventCatalogEntry = { type: string; description: string; source: string };

export type CustomerListItem = {
  id: string;
  publicId: string;
  name: string;
  email: string;
  phone: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  source: string;
  status: string;
  visitCount: number;
  totalSpendCents: number;
  pointsBalance: number;
  lastVisitAt: string | null;
  createdAt: string;
  consents: string;
  tags: { tag: { id: string; name: string; color: string } }[];
};

export type CustomerListResponse = { items: CustomerListItem[]; nextCursor: string | null; hasMore: boolean };

export type Branding = { brandColor: string; logoText: string; name: string };

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  phone?: string | null;
  specialties?: string[] | null;
  isActive: boolean;
};

export type AttendanceLog = {
  id: string;
  customerId: string;
  batchOrClass: string;
  date: string;
  status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
  guardianPhone: string;
  notifiedAt?: string | null;
  guardianReplyStatus: "PENDING" | "ACKNOWLEDGED_LEAVE" | "ACKNOWLEDGED_LATE" | "NO_REPLY";
  guardianReplyText?: string | null;
  followUpTaskId?: string | null;
  createdAt?: string;
  customer?: { id: string; name: string; email: string; phone?: string | null };
};

export type StaffFollowUpTask = {
  id: string;
  customerId: string;
  assignedToUserId?: string | null;
  taskType: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  dueAt: string;
  notes?: string | null;
  createdAt?: string;
  customer?: { id: string; name: string; email: string; phone?: string | null };
};

export type Membership = {
  id: string;
  customerId: string;
  planName: string;
  priceAmount: number;
  startDate: string;
  expiryDate: string;
  paymentStatus: "PAID" | "PENDING" | "OVERDUE";
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "CANCELLED";
  lastReminderSentAt?: string | null;
  autoSyncSheetRowId?: string | null;
  createdAt?: string;
  customer?: { id: string; name: string; email: string; phone?: string | null };
};

export type AppointmentPreference = {
  haircutStyle?: string;
  musicGenre?: string;
  beverage?: string;
  notes?: string;
  [key: string]: unknown;
};

/** Context passed to every view. */
export type AppCtx = {
  user: AppUser;
  tenant: TenantInfo;
  tenants: TenantSummary[];
  usage: UsageSnapshot | null;
  eventCatalog: EventCatalogEntry[];
};
