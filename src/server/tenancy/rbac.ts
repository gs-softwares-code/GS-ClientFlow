import { ApiError } from "@/server/tenancy/guard";

/**
 * Enterprise Role-Based Access Control (RBAC) System
 * Defines standard hierarchy, granular permissions, and authorization check helpers.
 */

export type Role = "owner" | "admin" | "manager" | "staff" | "auditor";

export const Permissions = {
  // Tenancy & Enterprise Org
  MANAGE_TENANT: "tenant:manage",
  MANAGE_BILLING: "billing:manage",
  MANAGE_USERS: "users:manage",
  VIEW_AUDIT_LOGS: "audit:view",

  // Customers & CRM
  VIEW_CUSTOMERS: "customers:view",
  CREATE_CUSTOMERS: "customers:create",
  EDIT_CUSTOMERS: "customers:edit",
  DELETE_CUSTOMERS: "customers:delete",
  EXPORT_DATA: "data:export",

  // Operations & Appointments
  BOOK_APPOINTMENTS: "appointments:book",
  MANAGE_APPOINTMENTS: "appointments:manage",
  RECORD_VISITS: "visits:record",
  MANAGE_FEEDBACK: "feedback:manage",

  // Growth & Automation
  MANAGE_CAMPAIGNS: "campaigns:manage",
  MANAGE_WORKFLOWS: "workflows:manage",
  MANAGE_LOYALTY: "loyalty:manage",
  MANAGE_OFFERS: "offers:manage",

  // System & Infrastructure
  VIEW_OPS_METRICS: "ops:view",
  TRIGGER_BACKUP: "backup:trigger",
  EXECUTE_MAINTENANCE: "maintenance:execute",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * Role Permission Mapping Matrix
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: Object.values(Permissions), // Full system access

  admin: [
    Permissions.MANAGE_TENANT,
    Permissions.MANAGE_USERS,
    Permissions.VIEW_AUDIT_LOGS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.CREATE_CUSTOMERS,
    Permissions.EDIT_CUSTOMERS,
    Permissions.DELETE_CUSTOMERS,
    Permissions.EXPORT_DATA,
    Permissions.BOOK_APPOINTMENTS,
    Permissions.MANAGE_APPOINTMENTS,
    Permissions.RECORD_VISITS,
    Permissions.MANAGE_FEEDBACK,
    Permissions.MANAGE_CAMPAIGNS,
    Permissions.MANAGE_WORKFLOWS,
    Permissions.MANAGE_LOYALTY,
    Permissions.MANAGE_OFFERS,
    Permissions.VIEW_OPS_METRICS,
    Permissions.TRIGGER_BACKUP,
  ],

  manager: [
    Permissions.VIEW_AUDIT_LOGS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.CREATE_CUSTOMERS,
    Permissions.EDIT_CUSTOMERS,
    Permissions.EXPORT_DATA,
    Permissions.BOOK_APPOINTMENTS,
    Permissions.MANAGE_APPOINTMENTS,
    Permissions.RECORD_VISITS,
    Permissions.MANAGE_FEEDBACK,
    Permissions.MANAGE_CAMPAIGNS,
    Permissions.MANAGE_LOYALTY,
    Permissions.MANAGE_OFFERS,
    Permissions.VIEW_OPS_METRICS,
  ],

  staff: [
    Permissions.VIEW_CUSTOMERS,
    Permissions.CREATE_CUSTOMERS,
    Permissions.EDIT_CUSTOMERS,
    Permissions.BOOK_APPOINTMENTS,
    Permissions.RECORD_VISITS,
    Permissions.MANAGE_FEEDBACK,
  ],

  auditor: [
    Permissions.VIEW_AUDIT_LOGS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_OPS_METRICS,
    Permissions.EXPORT_DATA,
  ],
};

/**
 * Check if a role possesses a required permission
 */
export function hasPermission(role: string, requiredPermission: Permission): boolean {
  const normalizedRole = (role.toLowerCase() as Role) || "staff";
  const permissions = ROLE_PERMISSIONS[normalizedRole] ?? ROLE_PERMISSIONS.staff;
  return permissions.includes(requiredPermission);
}

/**
 * Guard that enforces permission check or throws a 403 ApiError
 */
export function requirePermission(role: string, requiredPermission: Permission): void {
  if (!hasPermission(role, requiredPermission)) {
    throw new ApiError(
      "forbidden",
      `Insufficient permissions: '${requiredPermission}' required.`,
      403
    );
  }
}
