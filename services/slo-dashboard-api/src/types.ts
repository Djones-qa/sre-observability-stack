export type RollupWindow = '1h' | '6h' | '24h' | '72h';

export const WINDOW_HOURS: Record<RollupWindow, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '72h': 72,
};

export interface RollupData {
  burnRate: number;
  errorRate: number;
  requestCount: number;
  errorCount: number;
  sloTarget: number;
  window: RollupWindow;
  serviceName: string;
  computedAt: string;
}

export interface SloStatus {
  serviceName: string;
  sloTarget: number;
  currentErrorRate: number;
  uptimePct: number;
  burnRate: number;
  status: 'healthy' | 'at-risk' | 'breached';
}

export interface ErrorBudget {
  window: RollupWindow;
  burnRate: number;
  allowedDowntimeMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  consumedPct: number;
}

export interface TrendPoint {
  timestamp: string;
  burnRate: number;
  errorRate: number;
}

export interface SloResponse<T> {
  data: T;
  calculatedAt: string;    // ISO-8601
  dataFreshness: number;   // seconds since last rollup
}

export interface LogEntry {
  id: string;
  traceId: string;
  timestamp: string;
  serviceName: string;
  severity: string;
  message: string;
  [key: string]: unknown;
}
