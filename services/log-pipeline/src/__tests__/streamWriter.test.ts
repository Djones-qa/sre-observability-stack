import * as fc from 'fast-check';
import { isErrorSeverity } from '../streamWriter';
import { EnrichedLogEntry, SEVERITY_LEVELS, SeverityLevel, STREAM_ALL, STREAM_ERRORS } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(severity: SeverityLevel, overrides: Partial<EnrichedLogEntry> = {}): EnrichedLogEntry {
  return {
    traceId: 'trace-123',
    timestamp: new Date().toISOString(),
    serviceName: 'test-service',
    severity,
    message: 'test message',
    ...overrides,
  };
}

// ── Example-based tests ───────────────────────────────────────────────────────

describe('isErrorSeverity', () => {
  it('returns true for error severity', () => {
    expect(isErrorSeverity(makeEntry('error'))).toBe(true);
  });

  it('returns true for fatal severity', () => {
    expect(isErrorSeverity(makeEntry('fatal'))).toBe(true);
  });

  it('returns false for debug, info, warn', () => {
    expect(isErrorSeverity(makeEntry('debug'))).toBe(false);
    expect(isErrorSeverity(makeEntry('info'))).toBe(false);
    expect(isErrorSeverity(makeEntry('warn'))).toBe(false);
  });
});

describe('StreamWriter routing — mock Redis', () => {
  function makeMockRedis() {
    const xaddCalls: { stream: string; args: string[] }[] = [];
    const dlqEntries: string[] = [];

    return {
      xadd: jest.fn(async (stream: string, ...args: string[]) => {
        xaddCalls.push({ stream, args });
        return '1234-0';
      }),
      rpush: jest.fn(async (_key: string, value: string) => {
        dlqEntries.push(value);
        return 1;
      }),
      _xaddCalls: xaddCalls,
      _dlqEntries: dlqEntries,
    };
  }

  it('routes info log only to logs:all', async () => {
    const mockRedis = makeMockRedis();
    const { StreamWriter } = require('../streamWriter');
    const writer = new StreamWriter(mockRedis as unknown as import('ioredis').Redis);

    await writer.route(makeEntry('info'));

    const streams = mockRedis._xaddCalls.map((c) => c.stream);
    expect(streams).toContain(STREAM_ALL);
    expect(streams).not.toContain(STREAM_ERRORS);
  });

  it('routes error log to both logs:all and logs:errors', async () => {
    const mockRedis = makeMockRedis();
    const { StreamWriter } = require('../streamWriter');
    const writer = new StreamWriter(mockRedis as unknown as import('ioredis').Redis);

    await writer.route(makeEntry('error'));

    const streams = mockRedis._xaddCalls.map((c) => c.stream);
    expect(streams).toContain(STREAM_ALL);
    expect(streams).toContain(STREAM_ERRORS);
  });

  it('routes fatal log to both logs:all and logs:errors', async () => {
    const mockRedis = makeMockRedis();
    const { StreamWriter } = require('../streamWriter');
    const writer = new StreamWriter(mockRedis as unknown as import('ioredis').Redis);

    await writer.route(makeEntry('fatal'));

    const streams = mockRedis._xaddCalls.map((c) => c.stream);
    expect(streams).toContain(STREAM_ALL);
    expect(streams).toContain(STREAM_ERRORS);
  });

  it('writes malformed entries to DLQ', async () => {
    const mockRedis = makeMockRedis();
    const { StreamWriter } = require('../streamWriter');
    const writer = new StreamWriter(mockRedis as unknown as import('ioredis').Redis);

    await writer.writeToDLQ('invalid json {{{');

    expect(mockRedis._dlqEntries).toHaveLength(1);
    expect(mockRedis._dlqEntries[0]).toBe('invalid json {{{');
  });
});

// ── Property-based tests (Property 7) ─────────────────────────────────────────

describe('StreamWriter — Property 7: error/fatal routing invariant', () => {
  /**
   * Property 7: For any enriched log with severity error or fatal, it should
   * route to both logs:all and logs:errors.
   * For any enriched log with severity debug/info/warn, it should route to
   * logs:all only.
   */

  const nonErrorSeverities: SeverityLevel[] = ['debug', 'info', 'warn'];
  const errorSeverities: SeverityLevel[] = ['error', 'fatal'];

  it('error/fatal always routes to both streams', () => {
    fc.assert(
      fc.property(fc.constantFrom(...errorSeverities), (severity) => {
        const entry = makeEntry(severity);
        expect(isErrorSeverity(entry)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('debug/info/warn never routes to error stream', () => {
    fc.assert(
      fc.property(fc.constantFrom(...nonErrorSeverities), (severity) => {
        const entry = makeEntry(severity);
        expect(isErrorSeverity(entry)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('routing decision covers all valid severity levels', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEVERITY_LEVELS), (severity) => {
        const entry = makeEntry(severity);
        const goesToErrors = isErrorSeverity(entry);
        if (severity === 'error' || severity === 'fatal') {
          expect(goesToErrors).toBe(true);
        } else {
          expect(goesToErrors).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
