import { v4 as uuidv4 } from 'uuid';
import { normaliseSeverity } from './severityNormaliser';
import { RawLogEntry, EnrichedLogEntry } from './types';

const DEFAULT_SERVICE = process.env.DEFAULT_SERVICE_NAME ?? 'unknown';

/**
 * Normalise a timestamp value to an ISO-8601 UTC string.
 * Falls back to current time if the value is missing or invalid.
 */
export function normaliseTimestamp(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString();
  }
  if (typeof value === 'number') {
    // Handle Unix seconds (< 1e10) vs milliseconds
    const ms = value < 1e10 ? value * 1000 : value;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Generate a trace ID (UUID v4) if one is not already present.
 */
export function ensureTraceId(value: unknown): string {
  if (value && typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return uuidv4();
}

/**
 * Enrich a raw log entry with normalised fields.
 */
export function enrichLogEntry(
  raw: RawLogEntry,
  serviceNameOverride?: string,
): EnrichedLogEntry {
  const message = String(raw.message ?? raw.msg ?? '');
  const serviceName =
    serviceNameOverride ??
    (raw.serviceName ? String(raw.serviceName) : DEFAULT_SERVICE);

  return {
    ...raw,
    traceId: ensureTraceId(raw.traceId),
    timestamp: normaliseTimestamp(raw.timestamp),
    serviceName,
    severity: normaliseSeverity(raw.severity ?? raw.level),
    message,
  };
}

/**
 * Validate that a raw log entry has the minimum required fields.
 * Returns null if valid, or an error string describing the issue.
 */
export function validateRawEntry(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'Log entry must be a JSON object';
  }
  return null;
}
