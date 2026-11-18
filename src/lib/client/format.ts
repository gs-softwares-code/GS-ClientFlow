"use client";

export function formatINR(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(cents / 100);
}

export function formatDate(iso: string | number | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | number | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string | number | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  const time = d.getTime();
  if (isNaN(time)) return "—";
  const sec = Math.floor((Date.now() - time) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function sourceLabel(source: string): string {
  return source
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function statusTone(status: string): "positive" | "negative" | "neutral" | "warning" {
  switch (status) {
    case "delivered":
    case "read":
    case "completed":
    case "active":
    case "confirmed":
    case "done":
    case "yes":
      return "positive";
    case "failed":
    case "dead":
    case "no_show":
    case "cancelled":
      return "negative";
    case "pending":
    case "processing":
    case "scheduled":
    case "queued":
    case "new":
    case "running":
      return "warning";
    default:
      return "neutral";
  }
}
