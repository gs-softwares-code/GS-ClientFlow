"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarPlus, Coffee, Download, Music, Plus, Scissors, Search, Sparkles, Tablet } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPatch, apiPost, downloadFile } from "@/lib/client/api";
import { formatDate, formatDateTime, formatINR, initials, timeAgo } from "@/lib/client/format";
import type { AppCtx, CustomerListItem, CustomerListResponse } from "@/lib/client/types";

// ---------------------------------------------------------------------------
// Local DTOs (mirrors of the API responses)
// ---------------------------------------------------------------------------

type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
type StatusFilter = "" | AppointmentStatus;

type Appointment = {
  id: string;
  startAt: string;
  durationMin: number;
  status: AppointmentStatus;
  note: string | null;
  reminderSentAt: string | null;
  followUpAt: string | null;
  createdAt: string;
  customer: { id: string; name: string; email: string; phone: string | null };
  service: { id: string; name: string } | null;
  staff: { id: string; name: string } | null;
  assignedStaff?: { id: string; name: string; role: string } | null;
  checkInStatus?: string | null;
  checkedInAt?: string | null;
  preferences?: string | Record<string, unknown> | null;
};

type ServiceRow = { id: string; name: string; durationMin: number; priceCents: number; active: boolean };
type StaffRow = { id: string; name: string; role: string; active: boolean };
type ServicesPayload = { services: ServiceRow[]; staff: StaffRow[] };

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];

const STAFF_ROLES = ["owner", "manager", "staff"] as const;

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoDateTime(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Badge
      role="button"
      tabIndex={0}
      aria-pressed={active}
      variant={active ? "default" : "outline"}
      className={`cursor-pointer select-none px-3 py-1.5 text-xs ${
        active ? "border-transparent bg-[var(--brand)] text-white" : "text-muted-foreground hover:bg-accent"
      }`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  switch (status) {
    case "scheduled":
      return <Badge variant="outline" className="border-amber-600 bg-amber-600/10 text-[10px] text-amber-700">Scheduled</Badge>;
    case "confirmed":
      return <Badge variant="outline" className="border-emerald-600 text-[10px] text-emerald-700">Confirmed</Badge>;
    case "completed":
      return <Badge variant="outline" className="border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700">Completed</Badge>;
    case "cancelled":
      return <Badge variant="secondary" className="text-[10px] text-muted-foreground">Cancelled</Badge>;
    case "no_show":
      return <Badge variant="outline" className="border-rose-600 bg-rose-600/10 text-[10px] text-rose-700">No-show</Badge>;
  }
}

function RoleBadge({ role }: { role: string }) {
  if (role === "owner") return <Badge className="border-transparent bg-[var(--brand)] text-[10px] text-white">{role}</Badge>;
  if (role === "manager") return <Badge variant="secondary" className="text-[10px] capitalize">{role}</Badge>;
  return <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">{role}</Badge>;
}

// ---------------------------------------------------------------------------
// Main view — day-grouped calendar with filters, booking dialog, side cards
// ---------------------------------------------------------------------------

export default function AppointmentsView({ ctx }: { ctx: AppCtx }) {
  const { toast } = useToast();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [servicesPayload, setServicesPayload] = useState<ServicesPayload | null>(null);

  // Book dialog state
  const [bookOpen, setBookOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<CustomerListItem[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [picked, setPicked] = useState<CustomerListItem | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [bookDate, setBookDate] = useState(() => isoDay(1));
  const [bookTime, setBookTime] = useState("11:00");
  const [bookNote, setBookNote] = useState("");
  const [booking, setBooking] = useState(false);

  // Add service / staff dialog state
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [svcName, setSvcName] = useState("");
  const [svcDuration, setSvcDuration] = useState("30");
  const [svcPrice, setSvcPrice] = useState("");
  const [savingService, setSavingService] = useState(false);
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<(typeof STAFF_ROLES)[number]>("staff");
  const [savingStaff, setSavingStaff] = useState(false);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: isoDateTime(-7), to: isoDateTime(21) });
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiGet<{ appointments: Appointment[] }>(`/api/appointments?${params.toString()}`);
      setAppointments(res.appointments);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
      toast({ title: "Could not load appointments", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  const loadServices = useCallback(async () => {
    try {
      const res = await apiGet<ServicesPayload>("/api/services");
      setServicesPayload(res);
    } catch (err) {
      toast({ title: "Could not load services", description: (err as Error).message, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const services = servicesPayload?.services ?? [];
  const staff = servicesPayload?.staff ?? [];

  // Group appointments by local day (Today / Tomorrow / formatted date).
  const dayGroups = useMemo(() => {
    const rows = appointments ?? [];
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const byKey = new Map<string, { key: string; label: string; date: Date; items: Appointment[] }>();
    for (const a of rows) {
      const d = new Date(a.startAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          label: sameLocalDay(d, today) ? "Today" : sameLocalDay(d, tomorrow) ? "Tomorrow" : formatDate(d),
          date: d,
          items: [],
        };
        byKey.set(key, group);
      }
      group.items.push(a);
    }
    return [...byKey.values()].sort((x, y) => x.date.getTime() - y.date.getTime());
  }, [appointments]);

  // Reminders due: next 24h, reminder not yet sent (client-computed).
  const remindersDue = useMemo(() => {
    const rows = appointments ?? [];
    const now = Date.now();
    return rows
      .filter((a) => {
        if (a.reminderSentAt || a.status === "cancelled") return false;
        const t = new Date(a.startAt).getTime();
        return t >= now && t <= now + 24 * 3600_000;
      })
      .sort((x, y) => new Date(x.startAt).getTime() - new Date(y.startAt).getTime());
  }, [appointments]);

  const patchAppointment = async (
    a: Appointment,
    patch: Record<string, unknown>,
    success: { title: string; description?: string }
  ) => {
    setBusyId(a.id);
    try {
      await apiPatch(`/api/appointments?id=${encodeURIComponent(a.id)}`, patch);
      toast(success);
      await loadAppointments();
    } catch (err) {
      toast({ title: "Could not update appointment", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const [receptionMode, setReceptionMode] = useState(false);

  const handleCheckIn = async (a: Appointment) => {
    setBusyId(a.id);
    try {
      await apiPost(`/api/appointments/${encodeURIComponent(a.id)}/check-in`, {});
      toast({
        title: "Guest Checked In!",
        description: `Ambient preferences dispatched to stylist station for ${a.customer.name}.`,
      });
      await loadAppointments();
    } catch (err) {
      toast({
        title: "Check-in failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const resetBookForm = () => {
    setPickerQuery("");
    setPickerResults(null);
    setPicked(null);
    setServiceId("");
    setStaffId("");
    setBookDate(isoDay(1));
    setBookTime("11:00");
    setBookNote("");
  };

  // Debounced customer picker search
  useEffect(() => {
    if (!bookOpen) return;
    const q = pickerQuery.trim();
    setPickerLoading(true);
    const t = setTimeout(() => {
      apiGet<CustomerListResponse>(`/api/customers?limit=20&search=${encodeURIComponent(q)}`)
        .then((res) => setPickerResults(res.items))
        .catch(() => setPickerResults([]))
        .finally(() => setPickerLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [bookOpen, pickerQuery]);

  const submitBooking = async () => {
    if (!picked) {
      toast({ title: "Pick a customer first", variant: "destructive" });
      return;
    }
    if (!serviceId) {
      toast({ title: "Pick a service first", variant: "destructive" });
      return;
    }
    if (!bookDate || !bookTime) {
      toast({ title: "Pick a date and time", variant: "destructive" });
      return;
    }
    // Local timezone start — the API stores the ISO instant.
    const startAt = new Date(`${bookDate}T${bookTime}`).toISOString();
    setBooking(true);
    try {
      await apiPost("/api/appointments", {
        customerId: picked.id,
        serviceId,
        ...(staffId ? { staffId } : {}),
        startAt,
        note: bookNote.trim() || null,
      });
      toast({ title: "Booked", description: "Confirmation + 24h reminder queued automatically." });
      setBookOpen(false);
      resetBookForm();
      await loadAppointments();
    } catch (err) {
      toast({ title: "Could not book appointment", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBooking(false);
    }
  };

  const submitService = async () => {
    if (!svcName.trim()) {
      toast({ title: "Service name is required", variant: "destructive" });
      return;
    }
    setSavingService(true);
    try {
      await apiPost("/api/services", {
        kind: "service",
        name: svcName.trim(),
        durationMin: Number(svcDuration) || 30,
        priceRupees: Number(svcPrice) || 0,
      });
      toast({ title: "Service added", description: `${svcName.trim()} is now bookable.` });
      setServiceDialogOpen(false);
      setSvcName("");
      setSvcDuration("30");
      setSvcPrice("");
      await loadServices();
    } catch (err) {
      toast({ title: "Could not add service", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingService(false);
    }
  };

  const submitStaff = async () => {
    if (!staffName.trim()) {
      toast({ title: "Staff name is required", variant: "destructive" });
      return;
    }
    setSavingStaff(true);
    try {
      await apiPost("/api/services", { kind: "staff", name: staffName.trim(), role: staffRole });
      toast({ title: "Staff added", description: `${staffName.trim()} can now take appointments.` });
      setStaffDialogOpen(false);
      setStaffName("");
      setStaffRole("staff");
      await loadServices();
    } catch (err) {
      toast({ title: "Could not add staff", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingStaff(false);
    }
  };

  if (loading && !appointments) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!appointments) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Appointments are unavailable</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span className="flex-1">{loadError ?? "Could not load appointments."}</span>
          <Button size="sm" variant="outline" className="h-9" onClick={() => void loadAppointments()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground">The past 7 days and the coming 3 weeks.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant={receptionMode ? "default" : "outline"}
            className={`h-10 gap-1.5 ${receptionMode ? "bg-teal-600 text-white" : ""}`}
            onClick={() => setReceptionMode((v) => !v)}
          >
            <Tablet className="h-4 w-4" />
            {receptionMode ? "Tablet Kiosk: ON" : "Reception Tablet Mode"}
          </Button>
          <Button
            variant="outline"
            className="h-10 gap-1.5"
            onClick={() => downloadFile("/api/export/appointments", `appointments-${ctx.tenant.slug}.csv`)}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button className="h-10 gap-1.5 bg-[var(--brand)] text-white hover:opacity-90" onClick={() => setBookOpen(true)}>
            <CalendarPlus className="h-4 w-4" /> Book appointment
          </Button>
        </div>
      </div>

      {receptionMode && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tablet className="h-4 w-4 text-teal-600" />
            <div>
              <span className="text-xs font-semibold text-teal-900 dark:text-teal-200">Reception Tablet Check-In Mode</span>
              <p className="text-[11px] text-teal-800/80 dark:text-teal-300/80">
                1-click guest check-in will broadcast guest music, haircut style, and beverage preferences straight to stylist mirror stations.
              </p>
            </div>
          </div>
          <Badge className="bg-teal-600 text-white text-[10px]">Ambient IoT Enabled</Badge>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Calendar column */}
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <Chip key={f.value || "all"} label={f.label} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)} />
            ))}
          </div>

          <div className={`max-h-[520px] space-y-4 overflow-y-auto pr-1 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {dayGroups.length === 0 ? (
              <div className="rounded-xl border py-12 text-center text-sm text-muted-foreground">
                No appointments in this window — book one or adjust the filters.
              </div>
            ) : (
              dayGroups.map((g) => (
                <section key={g.key} className="space-y-2" aria-label={`${g.label} appointments`}>
                  <div className="flex items-baseline gap-2 px-1">
                    <h2 className="text-sm font-semibold">{g.label}</h2>
                    <span className="text-xs text-muted-foreground">{formatDate(g.date)}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                      {g.items.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {g.items.map((a) => (
                      <AppointmentRow
                        key={a.id}
                        a={a}
                        busy={busyId === a.id}
                        onCheckIn={() => void handleCheckIn(a)}
                        onConfirm={() =>
                          void patchAppointment(a, { status: "confirmed" }, {
                            title: "Appointment confirmed",
                            description: `${a.customer.name} · ${timeLabel(a.startAt)}`,
                          })
                        }
                        onComplete={() =>
                          void patchAppointment(a, { status: "completed" }, {
                            title: "Marked completed",
                            description: "Feedback follow-up scheduled.",
                          })
                        }
                        onNoShow={() =>
                          void patchAppointment(a, { status: "no_show" }, {
                            title: "Marked as no-show",
                            description: `${a.customer.name} · ${formatDate(a.startAt)}`,
                          })
                        }
                        onCancel={() =>
                          void patchAppointment(a, { cancel: true }, {
                            title: "Cancelled",
                            description: "Reminder actions cancelled, cancellation notice queued.",
                          })
                        }
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>

        {/* Side cards */}
        <div className="space-y-4">
          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                Services
                <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setServiceDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add service
                </Button>
              </CardTitle>
              <CardDescription>Duration and price shown to clients at booking.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[220px] overflow-y-auto">
                {services.length ? (
                  services.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 border-b px-4 py-2.5 last:border-b-0">
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-medium ${s.active ? "" : "text-muted-foreground"}`}>{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.durationMin} min</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!s.active && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                        <span className="text-sm font-medium tabular-nums">{formatINR(s.priceCents)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">No services yet — add one to take bookings.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                Staff
                <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setStaffDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add staff
                </Button>
              </CardTitle>
              <CardDescription>Staff powers assignment and slot-conflict checks.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[180px] overflow-y-auto">
                {staff.length ? (
                  staff.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 border-b px-4 py-2.5 last:border-b-0">
                      <p className={`truncate text-sm font-medium ${s.active ? "" : "text-muted-foreground"}`}>{s.name}</p>
                      <RoleBadge role={s.role} />
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">No staff yet — add teammates to assign bookings.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Reminders due</CardTitle>
              <CardDescription>Next 24 hours, reminder not yet sent.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[260px] overflow-y-auto">
                {remindersDue.length ? (
                  remindersDue.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 border-b px-4 py-2.5 last:border-b-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.customer.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(a.startAt)} · {timeLabel(a.startAt)}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-amber-600 bg-amber-600/10 text-[10px] text-amber-700">
                        Reminder pending
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing pending — everything is covered.</p>
                )}
              </div>
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                The worker sends these automatically 24h before each visit.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Book appointment dialog */}
      <Dialog
        open={bookOpen}
        onOpenChange={(o) => {
          setBookOpen(o);
          if (!o) resetBookForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Book appointment</DialogTitle>
            <DialogDescription>Confirmation and a 24-hour reminder are queued automatically once you save.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-[var(--brand)]/10 text-xs font-semibold text-[var(--brand)]">
                      {initials(picked.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{picked.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {picked.email}
                      {picked.phone ? ` · ${picked.phone}` : ""}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => setPicked(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="book-customer">Customer</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="book-customer"
                    className="h-10 pl-9"
                    placeholder="Search by name, email or phone"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border">
                  {pickerLoading && !pickerResults ? (
                    <div className="space-y-2 p-2">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : pickerResults?.length ? (
                    pickerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent"
                        onClick={() => setPicked(c)}
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="bg-[var(--brand)]/10 text-[11px] font-semibold text-[var(--brand)]">
                            {initials(c.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{c.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">No customers found.</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="book-service">Service</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger id="book-service" className="h-10 w-full">
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.filter((s) => s.active).length ? (
                    services
                      .filter((s) => s.active)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} — {s.durationMin} min — {formatINR(s.priceCents)}
                        </SelectItem>
                      ))
                  ) : (
                    <SelectItem value="no-services" disabled>
                      No active services — add one first
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="book-staff">Staff (optional)</Label>
                {staffId && (
                  <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setStaffId("")}>
                    clear
                  </button>
                )}
              </div>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger id="book-staff" className="h-10 w-full">
                  <SelectValue placeholder="Any staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.filter((s) => s.active).length ? (
                    staff
                      .filter((s) => s.active)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} — {s.role}
                        </SelectItem>
                      ))
                  ) : (
                    <SelectItem value="no-staff" disabled>
                      No active staff — add one first
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Slot conflicts are checked per staff member.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="book-date">Date</Label>
                <Input id="book-date" type="date" className="h-10" value={bookDate} onChange={(e) => setBookDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="book-time">Time</Label>
                <Input id="book-time" type="time" className="h-10" value={bookTime} onChange={(e) => setBookTime(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="book-note">Note (optional)</Label>
              <Input id="book-note" className="h-10" placeholder="e.g. first visit — patch test" value={bookNote} onChange={(e) => setBookNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => {
                setBookOpen(false);
                resetBookForm();
              }}
            >
              Cancel
            </Button>
            <Button
              className="h-10 bg-[var(--brand,#0f766e)] text-white hover:opacity-90 shadow-sm"
              disabled={booking}
              onClick={() => void submitBooking()}
            >
              {booking ? "Booking…" : "Book appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add service dialog */}
      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add service</DialogTitle>
            <DialogDescription>Services set booking duration and price on the public page and portal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="svc-name">Name</Label>
              <Input id="svc-name" className="h-10" placeholder="e.g. Signature haircut" value={svcName} onChange={(e) => setSvcName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitService(); }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="svc-duration">Duration (min)</Label>
                <Input id="svc-duration" type="number" min={5} className="h-10" value={svcDuration} onChange={(e) => setSvcDuration(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="svc-price">Price (₹)</Label>
                <Input id="svc-price" type="number" min={0} className="h-10" placeholder="0" value={svcPrice} onChange={(e) => setSvcPrice(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:flex-row">
            <Button variant="outline" className="h-10 flex-1 sm:flex-none" onClick={() => setServiceDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="h-10 flex-1 sm:flex-none bg-[var(--brand,#0f766e)] text-white hover:opacity-90 shadow-sm"
              disabled={savingService}
              onClick={() => void submitService()}
            >
              {savingService ? "Adding…" : "Save service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add staff dialog */}
      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add staff</DialogTitle>
            <DialogDescription>Staff can be assigned to appointments and get conflict-checked slots.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name</Label>
              <Input id="staff-name" className="h-10" placeholder="e.g. Priya Sharma" value={staffName} onChange={(e) => setStaffName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-role">Role</Label>
              <Select value={staffRole} onValueChange={(v) => setStaffRole(v as (typeof STAFF_ROLES)[number])}>
                <SelectTrigger id="staff-role" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-10" onClick={() => setStaffDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="h-10 bg-[var(--brand,#0f766e)] text-white hover:opacity-90 shadow-sm"
              disabled={savingStaff}
              onClick={() => void submitStaff()}
            >
              {savingStaff ? "Adding…" : "Add staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appointment row: time, customer, service/staff, status, reminder, actions
// ---------------------------------------------------------------------------

function AppointmentRow({
  a,
  busy,
  onCheckIn,
  onConfirm,
  onComplete,
  onNoShow,
  onCancel,
}: {
  a: Appointment;
  busy: boolean;
  onCheckIn?: () => void;
  onConfirm: () => void;
  onComplete: () => void;
  onNoShow: () => void;
  onCancel: () => void;
}) {
  const active = a.status === "scheduled" || a.status === "confirmed";

  let prefs: Record<string, unknown> | null = null;
  if (typeof a.preferences === "string") {
    try {
      prefs = JSON.parse(a.preferences);
    } catch {}
  } else if (a.preferences && typeof a.preferences === "object") {
    prefs = a.preferences as Record<string, unknown>;
  }

  const isCheckedIn = a.checkInStatus === "CHECKED_IN" || a.checkInStatus === "checked_in";

  return (
    <div className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 lg:w-20">
          <p className="font-mono text-sm font-medium tabular-nums">{timeLabel(a.startAt)}</p>
          <p className="text-xs text-muted-foreground">{a.durationMin} min</p>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{a.customer.name}</p>
            <StatusBadge status={a.status} />
            {isCheckedIn && (
              <Badge className="bg-teal-600/15 text-teal-700 dark:text-teal-300 border-teal-600/30 text-[10px]">
                Checked In
              </Badge>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default">
                  <Bell className={`h-4 w-4 ${a.reminderSentAt ? "text-emerald-600" : "text-muted-foreground/70"}`} aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {a.reminderSentAt ? `Reminder sent ${formatDateTime(a.reminderSentAt)}` : "Reminder pending — sends 24h before the visit"}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {a.customer.phone ?? "no phone on file"} · {a.service ? `${a.service.name} (${a.durationMin} min)` : "no service"} ·{" "}
            {a.assignedStaff ? (
              <span className="font-medium text-foreground">Stylist: {a.assignedStaff.name}</span>
            ) : a.staff ? (
              a.staff.name
            ) : (
              "unassigned"
            )}
          </p>
          {a.note ? <p className="truncate text-xs italic text-muted-foreground">{a.note}</p> : null}
          {prefs && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-muted/80 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-teal-600" />
              {prefs.haircutStyle ? <span>Style: <strong className="text-foreground">{String(prefs.haircutStyle)}</strong></span> : null}
              {prefs.musicGenre ? <span className="flex items-center gap-1"><Music className="h-3 w-3" /> {String(prefs.musicGenre)}</span> : null}
              {prefs.beverage ? <span className="flex items-center gap-1"><Coffee className="h-3 w-3" /> {String(prefs.beverage)}</span> : null}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">booked {timeAgo(a.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {active && !isCheckedIn && onCheckIn && (
            <Button size="sm" className="h-9 gap-1.5 bg-teal-600 text-white hover:bg-teal-700" disabled={busy} onClick={onCheckIn}>
              <Tablet className="h-3.5 w-3.5" /> Check In
            </Button>
          )}
          {a.status === "scheduled" && (
            <Button variant="outline" size="sm" className="h-9" disabled={busy} onClick={onConfirm}>
              Confirm
            </Button>
          )}
          {active && (
            <>
              <Button variant="outline" size="sm" className="h-9" disabled={busy} onClick={onComplete}>
                Complete
              </Button>
              <Button variant="outline" size="sm" className="h-9 text-rose-600" disabled={busy} onClick={onNoShow}>
                No-show
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 text-rose-600" disabled={busy}>
                    Cancel
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {a.customer.name} · {timeLabel(a.startAt)}. Reminder actions are cancelled and a cancellation notice is
                      queued. This cannot be undone from here.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction onClick={onCancel}>Cancel appointment</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {a.status === "completed" && a.followUpAt && (
            <Badge variant="outline" className="border-emerald-600 bg-emerald-600/10 text-[10px] text-emerald-700">
              Feedback follow-up sent
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
