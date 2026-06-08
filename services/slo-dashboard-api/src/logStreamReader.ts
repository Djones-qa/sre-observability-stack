import { Redis } from 'ioredis';
import { LogEntry } from './types';

const STREAM_ERRORS = 'logs:errors';
const DEFAULT_LIMIT = parseInt(process.env.LOG_QUERY_DEFAULT_LIMIT ?? '50', 10);
const MAX_LIMIT = parseInt(process.env.LOG_QUERY_MAX_LIMIT ?? '500', 10);

export class LogStreamReader {
  constructor(private readonly redis: Redis) {}

  /**
   * Read recent ERROR/FATAL log entries for a service from the logs:errors stream.
   * Filters by serviceName. Returns entries newest-first.
   */
  async getRecentErrors(
    serviceName: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<LogEntry[]> {
    const clampedLimit = Math.min(limit, MAX_LIMIT);

    // Read a larger batch from the stream to account for filtering by serviceName
    const fetchCount = clampedLimit * 10;

    // XREVRANGE returns entries newest-first: [id, [field, value, ...]]
    const rawEntries = await this.redis.xrevrange(STREAM_ERRORS, '+', '-', 'COUNT', fetchCount);
    if (!rawEntries) return [];

    const results: LogEntry[] = [];
    for (const [id, fields] of rawEntries) {
      const entry = parseStreamEntry(id, fields);
      if (entry && entry.serviceName === serviceName) {
        results.push(entry);
        if (results.length >= clampedLimit) break;
      }
    }

    return results;
  }
}

/**
 * Parse a Redis Stream entry (flat field/value array) into a LogEntry object.
 */
function parseStreamEntry(id: string, fields: string[]): LogEntry | null {
  if (!fields || fields.length === 0) return null;

  const obj: Record<string, unknown> = { id };
  for (let i = 0; i < fields.length - 1; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    // Attempt JSON parse for nested objects, fall back to string
    try {
      obj[key] = JSON.parse(value);
    } catch {
      obj[key] = value;
    }
  }

  return obj as unknown as LogEntry;
}
