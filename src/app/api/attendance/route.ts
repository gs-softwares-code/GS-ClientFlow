import { NextRequest } from "next/server";
import { withRoute, jsonOk, jsonError, audit } from "@/server/tenancy/guard";
import {
  markAttendance,
  listAttendance,
  listStaffFollowUpTasks,
  resolveFollowUpTask,
  type AttendanceInput,
} from "@/server/services/attendance";
import { z } from "zod";

const AttendanceItemSchema = z.object({
  customerId: z.string().min(1),
  batchOrClass: z.string().min(1),
  date: z.string().min(4),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "ON_LEAVE"]),
  guardianPhone: z.string().optional().default(""),
});

const PostAttendanceSchema = z.object({
  logs: z.array(AttendanceItemSchema).optional(),
  action: z.enum(["mark", "resolve_task"]).optional().default("mark"),
  taskId: z.string().optional(),
  notes: z.string().optional(),
  // Single entry support
  customerId: z.string().optional(),
  batchOrClass: z.string().optional(),
  date: z.string().optional(),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "ON_LEAVE"]).optional(),
  guardianPhone: z.string().optional(),
});

export async function GET(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? undefined;
    const batchOrClass = url.searchParams.get("batchOrClass") ?? undefined;
    const customerId = url.searchParams.get("customerId") ?? undefined;
    const includeTasks = url.searchParams.get("includeTasks") === "true";

    const logs = await listAttendance(ctx.tenant.id, { date, batchOrClass, customerId });
    const tasks = includeTasks ? await listStaffFollowUpTasks(ctx.tenant.id, { status: "OPEN" }) : [];

    return jsonOk({
      logs,
      tasks,
      totalCount: logs.length,
    });
  }, { name: "attendance-get" })(req);
}

export async function POST(req: NextRequest) {
  return withRoute(async (ctx, request) => {
    const raw = await request.json().catch(() => ({}));
    const parsed = PostAttendanceSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError("bad_request", parsed.error.issues?.[0]?.message ?? "Invalid input", 400);
    }

    const { action, taskId, notes } = parsed.data;

    // Sub-action: Resolve a pending escalation call task
    if (action === "resolve_task" && taskId) {
      const resolved = await resolveFollowUpTask(ctx.tenant.id, taskId, notes);
      if (!resolved) return jsonError("not_found", "Task not found", 404);
      await audit(ctx, "attendance.task_resolved", "staff_follow_up_task", taskId, { notes });
      return jsonOk({ success: true, task: resolved });
    }

    // Main action: Mark attendance
    let itemsToProcess: AttendanceInput[] = [];

    if (parsed.data.logs && parsed.data.logs.length > 0) {
      itemsToProcess = parsed.data.logs.map((item) => ({
        ...item,
        guardianPhone: item.guardianPhone || "",
      }));
    } else if (parsed.data.customerId && parsed.data.batchOrClass && parsed.data.date && parsed.data.status) {
      itemsToProcess = [
        {
          customerId: parsed.data.customerId,
          batchOrClass: parsed.data.batchOrClass,
          date: parsed.data.date,
          status: parsed.data.status,
          guardianPhone: parsed.data.guardianPhone || "",
        },
      ];
    } else {
      return jsonError("bad_request", "Provide 'logs' array or single attendance fields", 400);
    }

    const saved = await markAttendance(ctx.tenant.id, itemsToProcess);
    await audit(ctx, "attendance.marked", "attendance_log", undefined, { count: saved.length });

    return jsonOk({
      success: true,
      count: saved.length,
      logs: saved,
    });
  }, { name: "attendance-post", limitPerMinute: 60 })(req);
}

export const dynamic = "force-dynamic";
