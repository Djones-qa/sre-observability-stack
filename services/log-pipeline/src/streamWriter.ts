import { Redis } from 'ioredis';
import {
  EnrichedLogEntry,
  STREAM_ALL,
  STREAM_ERRORS,
  STREAM_DLQ,
} from './types';

const LOG_MAX_STREAM_LENGTH = parseInt(
  process.env.LOG_MAX_STREAM_LENGTH ?? '1000000',
  10,
);
const LOG_ERROR_MAX_STREAM_LENGTH = parseInt(
  process.env.LOG_ERROR_MAX_STREAM_LENGTH ?? '100000',
  10,
);

/**
 * Determines if a log entry should be routed to the error stream.
 */
export function isErrorSeverity(entry: EnrichedLogEntry): boolean {
  return entry.severity === 'error' || entry.severity === 'fatal';
}

export class StreamWriter {
  constructor(private readonly redis: Redis) {}

  /**
   * Route an enriched log entry to the appropriate streams.
   * error/fatal → both logs:all and logs:errors
   * others      → logs:all only
   */
  async route(entry: EnrichedLogEntry): Promise<void> {
    const serialised = flattenEntry(entry);

    // Always write to logs:all
    await this.redis.xadd(
      STREAM_ALL,
      'MAXLEN',
      '~',
      String(LOG_MAX_STREAM_LENGTH),
      '*',
      ...serialised,
    );

    // Conditionally write to logs:errors
    if (isErrorSeverity(entry)) {
      await this.redis.xadd(
        STREAM_ERRORS,
        'MAXLEN',
        '~',
        String(LOG_ERROR_MAX_STREAM_LENGTH),
        '*',
        ...serialised,
      );
    }
  }

  /**
   * Write a raw (malformed) entry to the dead-letter queue.
   */
  async writeToDLQ(raw: string): Promise<void> {
    await this.redis.rpush(STREAM_DLQ, raw);
  }
}

/**
 * Flatten an enriched log entry into a flat key-value array for XADD.
 * Redis Streams require alternating key/value strings.
 */
function flattenEntry(entry: EnrichedLogEntry): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (value !== undefined && value !== null) {
      result.push(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }
  return result;
}
