/** Runtime (in-memory) operational state surfaced by the Ops console.
 *  Single-process dev server -> simple global counters are accurate here. */

export type WorkerStats = {
  startedAt: number;
  ticks: number;
  processed: number;
  failed: number;
  dead: number;
  retried: number;
  scheduledRun: number;
  lastTickAt: number | null;
  lastError: string | null;
  running: boolean;
};

export type RateLimitStats = { total429: number; recent: { key: string; at: number }[] };

type OpsGlobal = {
  worker?: WorkerStats;
  rateLimit?: RateLimitStats;
  workerStarted?: boolean;
};

const g = globalThis as unknown as { __gscfOps?: OpsGlobal };

export function ops(): OpsGlobal {
  g.__gscfOps ??= {};
  return g.__gscfOps;
}

export function workerStats(): WorkerStats {
  const o = ops();
  o.worker ??= {
    startedAt: Date.now(),
    ticks: 0,
    processed: 0,
    failed: 0,
    dead: 0,
    retried: 0,
    scheduledRun: 0,
    lastTickAt: null,
    lastError: null,
    running: false,
  };
  return o.worker;
}

export function rateLimitStats(): RateLimitStats {
  const o = ops();
  o.rateLimit ??= { total429: 0, recent: [] };
  return o.rateLimit;
}

export function track429(key: string): void {
  const s = rateLimitStats();
  s.total429 += 1;
  s.recent.unshift({ key, at: Date.now() });
  s.recent = s.recent.slice(0, 25);
}
