// ─── Scrape Target ──────────────────────────────────────────────────────────

export interface ScrapeTarget {
  id: string;
  url: string;
  serviceName: string;
  scrapeIntervalSeconds: number;
}

// ─── Prometheus Metrics ─────────────────────────────────────────────────────

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'untyped';

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp?: number;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: MetricType;
  samples: MetricSample[];
}

// ─── Rollup / Burn Rate ──────────────────────────────────────────────────────

export type RollupWindow = '1h' | '6h' | '24h' | '72h';

export const WINDOW_HOURS: Record<RollupWindow, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '72h': 72,
};

export const ROLLUP_TTL_SECONDS: Record<RollupWindow, number> = {
  '1h': 7200,       // 2 hours
  '6h': 43200,      // 12 hours
  '24h': 172800,    // 48 hours
  '72h': 518400,    // 144 hours
};

export interface RollupData {
  burnRate: number;
  errorRate: number;
  requestCount: number;
  errorCount: number;
  sloTarget: number;
  window: RollupWindow;
  serviceName: string;
  computedAt: string; // ISO-8601
}

// ─── SLO Config ──────────────────────────────────────────────────────────────

export interface SloConfig {
  serviceName: string;
  target: number; // 0.0 – 1.0, default 0.999
}
