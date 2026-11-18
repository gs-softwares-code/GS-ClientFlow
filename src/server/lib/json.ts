/** Safe JSON helpers — JSON is stored as TEXT (SQLite) and typed on read. */

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "{}";
  }
}
