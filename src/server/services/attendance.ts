import { db } from "@/lib/db";
import { publish } from "@/server/events/outbox";
import { EventTypes } from "@/server/events/contracts";
import { logEvent } from "@/server/logs";

export type AttendanceInput = {
  customerId: string;
  batchOrClass: string;
  date: string; // YYYY-MM-DD
  status: "PRESENT" | "ABSENT" | "LATE" | "ON_LEAVE";
  guardianPhone: string;
};

/**
 * Bulk or single attendance marking service for Coaching Institutes.
 * Automatically initiates parent escalation for absentees.
 */
export async function markAttendance(tenantId: string, inputs: AttendanceInput[]) {
  if (!inputs.length) return [];

  const results: unknown[] = [];

  for (const input of inputs) {
    const student = await db.customer.findFirst({
      where: { id: input.customerId, tenantId },
      select: { id: true, name: true, phone: true },
    });
    if (!student) continue;

    const guardianPhone = input.guardianPhone || student.phone || "9999999999";

    // Find existing log for the student, batch, and date
    const existing = await db.attendanceLog.findFirst({
      where: {
        tenantId,
        customerId: input.customerId,
        batchOrClass: input.batchOrClass,
        date: input.date,
      },
    });

    let logRecord;
    if (existing) {
      logRecord = await db.attendanceLog.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          guardianPhone,
          updatedAt: new Date(),
        },
      });
    } else {
      logRecord = await db.attendanceLog.create({
        data: {
          tenantId,
          customerId: input.customerId,
          batchOrClass: input.batchOrClass,
          date: input.date,
          status: input.status,
          guardianPhone,
          guardianReplyStatus: "PENDING",
        },
      });
    }

    results.push(logRecord);

    // If marked ABSENT, emit domain event to trigger WhatsApp notification & 60-min timer
    if (input.status === "ABSENT") {
      await publish(db, {
        tenantId,
        type: EventTypes.AttendanceMarkedAbsent,
        payload: {
          attendanceId: logRecord.id,
          customerId: student.id,
          studentName: student.name,
          guardianPhone,
          batchOrClass: input.batchOrClass,
          date: input.date,
        },
        dedupeKey: `absent:${logRecord.id}:${input.date}`,
      });

      await logEvent(
        "info",
        "attendance",
        `Student ${student.name} marked ABSENT in ${input.batchOrClass}. Parent escalation queued.`,
        { attendanceId: logRecord.id, guardianPhone },
        tenantId
      );
    }
  }

  return results;
}

/**
 * List attendance logs with multi-tenant filtering
 */
export async function listAttendance(
  tenantId: string,
  query: { date?: string; batchOrClass?: string; customerId?: string }
) {
  const where: Record<string, unknown> = { tenantId };
  if (query.date) where.date = query.date;
  if (query.batchOrClass) where.batchOrClass = query.batchOrClass;
  if (query.customerId) where.customerId = query.customerId;

  return db.attendanceLog.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      customer: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });
}

/**
 * Process inbound parent replies (e.g. from WhatsApp webhook)
 */
export async function processGuardianReply(
  tenantId: string,
  attendanceId: string,
  replyType: "LEAVE" | "LATE" | "OTHER",
  rawMessage: string
) {
  const log = await db.attendanceLog.findFirst({
    where: { id: attendanceId, tenantId },
  });
  if (!log) return null;

  const newStatus = replyType === "LEAVE" ? "ON_LEAVE" : replyType === "LATE" ? "LATE" : log.status;
  const replyStatus =
    replyType === "LEAVE"
      ? "ACKNOWLEDGED_LEAVE"
      : replyType === "LATE"
      ? "ACKNOWLEDGED_LATE"
      : "PENDING";

  const updated = await db.attendanceLog.update({
    where: { id: attendanceId },
    data: {
      status: newStatus,
      guardianReplyStatus: replyStatus,
      guardianReplyText: rawMessage,
      updatedAt: new Date(),
    },
  });

  await publish(db, {
    tenantId,
    type: EventTypes.AttendanceGuardianReplied,
    payload: {
      attendanceId: log.id,
      customerId: log.customerId,
      replyType,
      rawMessage,
    },
    dedupeKey: `guardian_reply:${log.id}:${Date.now()}`,
  });

  return updated;
}

/**
 * List pending staff follow-up calls
 */
export async function listStaffFollowUpTasks(
  tenantId: string,
  opts?: { status?: string; taskType?: string }
) {
  const where: Record<string, unknown> = { tenantId };
  if (opts?.status) where.status = opts.status;
  if (opts?.taskType) where.taskType = opts.taskType;

  return db.staffFollowUpTask.findMany({
    where,
    orderBy: { dueAt: "asc" },
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
      assignedToUser: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

/**
 * Resolve staff follow-up task
 */
export async function resolveFollowUpTask(
  tenantId: string,
  taskId: string,
  resolutionNotes?: string
) {
  const task = await db.staffFollowUpTask.findFirst({
    where: { id: taskId, tenantId },
  });
  if (!task) return null;

  return db.staffFollowUpTask.update({
    where: { id: taskId },
    data: {
      status: "RESOLVED",
      notes: resolutionNotes ? `${task.notes ?? ""}\n[Resolved]: ${resolutionNotes}`.trim() : task.notes,
      updatedAt: new Date(),
    },
  });
}
