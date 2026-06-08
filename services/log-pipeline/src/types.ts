export type SeverityLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const SEVERITY_LEVELS: SeverityLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

export interface RawLogEntry {
  timestamp?: string | number;
  traceId?: string;
  serviceName?: string;
  severity?: string;
  level?: string;     // alternative field name for severity
  message?: string;
  msg?: string;       // alternative field name for message
  [key: string]: unknown;
}

export interface EnrichedLogEntry {
  traceId: string;
  timestamp: string;        // ISO-8601 UTC
  serviceName: string;
  severity: SeverityLevel;
  message: string;
  [key: string]: unknown;
}

export const STREAM_ALL = 'logs:all';
export const STREAM_ERRORS = 'logs:errors';
export const STREAM_DLQ = 'logs:dlq';
export const CONSUMER_GROUP = 'alert-consumers';
