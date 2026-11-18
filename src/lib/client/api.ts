"use client";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });

  if (res.status === 204) return undefined as T;

  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(err?.code ?? `http_${res.status}`, err?.message ?? `Request failed (${res.status})`, res.status);
  }
  return (body ?? {}) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

/** Downloads a CSV/JSON attachment produced by the export endpoints. */
export function downloadFile(path: string, fallbackName: string): void {
  const a = document.createElement("a");
  a.href = path;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
