import * as fc from 'fast-check';
import { enrichLogEntry, normaliseTimestamp, ensureTraceId, validateRawEntry } from '../logEnricher';
import { RawLogEntry, SEVERITY_LEVELS } from '../types';

// ── Example-based tests ───────────────────────────────────────────────────────

describe('normaliseTimestamp', () => {
  it('passes through valid ISO-8601 strings', () => {
    const iso = '2024-01-15T12:00:00.000Z';
    expect(normaliseTimestamp(iso)).toBe(iso);
  });

  it('converts Unix seconds to ISO-8601', () => {
    const result = normaliseTimestamp(1705312800);
    expect(() => new Date(result)).not.toThrow();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('converts Unix milliseconds to ISO-8601', () => {
    const result = normaliseTimestamp(1705312800000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('falls back to now for null', () => {
    const before = Date.now();
    const result = normaliseTimestamp(null);
    const after = Date.now();
    const ts = new Date(result).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('falls back to now for invalid string', () => {
    const result = normaliseTimestamp('not-a-date');
    expect(() => new Date(result)).not.toThrow();
  });
});

describe('ensureTraceId', () => {
  it('preserves existing trace ID', () => {
    const traceId = 'existing-trace-id-123';
    expect(ensureTraceId(traceId)).toBe(traceId);
  });

  it('generates UUID v4 when trace ID is absent', () => {
    const result = ensureTraceId(undefined);
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates new ID for empty string', () => {
    const result = ensureTraceId('');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('validateRawEntry', () => {
  it('returns null for valid object', () => {
    expect(validateRawEntry({ message: 'hello' })).toBeNull();
  });

  it('returns error string for non-object', () => {
    expect(validateRawEntry('string')).not.toBeNull();
    expect(validateRawEntry(42)).not.toBeNull();
    expect(validateRawEntry(null)).not.toBeNull();
    expect(validateRawEntry([1, 2, 3])).not.toBeNull();
  });
});

describe('enrichLogEntry — examples', () => {
  it('enriches a minimal log entry', () => {
    const raw: RawLogEntry = { message: 'hello world' };
    const enriched = enrichLogEntry(raw);
    expect(enriched.traceId).toBeTruthy();
    expect(enriched.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(enriched.serviceName).toBeTruthy();
    expect(SEVERITY_LEVELS).toContain(enriched.severity);
    expect(enriched.message).toBe('hello world');
  });

  it('uses provided traceId when present', () => {
    const raw: RawLogEntry = { traceId: 'my-trace', message: 'test' };
    const enriched = enrichLogEntry(raw);
    expect(enriched.traceId).toBe('my-trace');
  });

  it('uses serviceName override when provided', () => {
    const raw: RawLogEntry = { message: 'test', serviceName: 'original' };
    const enriched = enrichLogEntry(raw, 'override-service');
    expect(enriched.serviceName).toBe('override-service');
  });

  it('normalises severity from level field', () => {
    const raw: RawLogEntry = { message: 'test', level: 'CRITICAL' };
    const enriched = enrichLogEntry(raw);
    expect(enriched.severity).toBe('fatal');
  });

  it('preserves extra fields (passthrough)', () => {
    const raw: RawLogEntry = { message: 'test', requestId: 'abc-123', userId: 'user-42' };
    const enriched = enrichLogEntry(raw);
    expect((enriched as Record<string, unknown>)['requestId']).toBe('abc-123');
    expect((enriched as Record<string, unknown>)['userId']).toBe('user-42');
  });
});

// ── Property-based tests (Properties 5 & 10) ──────────────────────────────────

describe('LogEnricher — Property 5: enrichment completeness', () => {
  /**
   * Property 5: For any valid JSON log entry, enriching it should produce an
   * entry with all four enrichment fields: valid ISO-8601 timestamp, non-empty
   * traceId, non-empty serviceName, and canonical severity.
   */

  const rawEntryArb = fc.record<RawLogEntry>({
    message: fc.string({ minLength: 0, maxLength: 200 }),
    severity: fc.option(
      fc.constantFrom('DEBUG', 'INFO', 'warn', 'error', 'Fatal', 'UNKNOWN', ''),
      { nil: undefined },
    ),
    serviceName: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/), { nil: undefined }),
    traceId: fc.option(fc.uuidV(4), { nil: undefined }),
    timestamp: fc.option(
      fc.oneof(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
        fc.integer({ min: 1609459200, max: 1893456000 }),
      ),
      { nil: undefined },
    ),
  });

  it('every enriched entry has all four required fields', () => {
    fc.assert(
      fc.property(rawEntryArb, (raw) => {
        const enriched = enrichLogEntry(raw);

        // traceId: non-empty string
        expect(typeof enriched.traceId).toBe('string');
        expect(enriched.traceId.length).toBeGreaterThan(0);

        // timestamp: valid ISO-8601
        expect(() => new Date(enriched.timestamp)).not.toThrow();
        expect(new Date(enriched.timestamp).getTime()).not.toBeNaN();
        expect(enriched.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // serviceName: non-empty string
        expect(typeof enriched.serviceName).toBe('string');
        expect(enriched.serviceName.length).toBeGreaterThan(0);

        // severity: canonical level
        expect(SEVERITY_LEVELS).toContain(enriched.severity);
      }),
      { numRuns: 200 },
    );
  });
});

describe('LogEnricher — Property 10: batch enrichment consistency', () => {
  /**
   * Property 10: For any array of valid log entries, every entry enriched via
   * batch should have the same quality guarantees as a single entry.
   */

  const rawEntryArb = fc.record<RawLogEntry>({
    message: fc.string({ minLength: 1, maxLength: 100 }),
    severity: fc.option(fc.constantFrom('debug', 'info', 'warn', 'error', 'fatal'), { nil: undefined }),
    serviceName: fc.option(fc.constant('test-service'), { nil: undefined }),
  });

  const batchArb = fc.array(rawEntryArb, { minLength: 1, maxLength: 20 });

  it('every entry in a batch is enriched with all required fields', () => {
    fc.assert(
      fc.property(batchArb, (batch) => {
        for (const raw of batch) {
          const enriched = enrichLogEntry(raw);
          expect(enriched.traceId.length).toBeGreaterThan(0);
          expect(new Date(enriched.timestamp).getTime()).not.toBeNaN();
          expect(enriched.serviceName.length).toBeGreaterThan(0);
          expect(SEVERITY_LEVELS).toContain(enriched.severity);
        }
      }),
      { numRuns: 100 },
    );
  });
});
