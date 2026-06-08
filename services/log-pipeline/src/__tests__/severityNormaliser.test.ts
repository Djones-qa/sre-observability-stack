import * as fc from 'fast-check';
import { normaliseSeverity } from '../severityNormaliser';
import { SEVERITY_LEVELS, SeverityLevel } from '../types';

// ── Example-based tests ───────────────────────────────────────────────────────

describe('SeverityNormaliser — examples', () => {
  const cases: [unknown, SeverityLevel][] = [
    ['debug', 'debug'],
    ['DEBUG', 'debug'],
    ['TRACE', 'debug'],
    ['verbose', 'debug'],
    ['info', 'info'],
    ['INFO', 'info'],
    ['information', 'info'],
    ['warn', 'warn'],
    ['WARNING', 'warn'],
    ['error', 'error'],
    ['ERROR', 'error'],
    ['err', 'error'],
    ['fatal', 'fatal'],
    ['FATAL', 'fatal'],
    ['critical', 'fatal'],
    ['crit', 'fatal'],
    // Defaults
    ['', 'info'],
    [null, 'info'],
    [undefined, 'info'],
    ['UNKNOWN_LEVEL', 'info'],
    ['random-junk', 'info'],
  ];

  test.each(cases)('normalises %p → %s', (input, expected) => {
    expect(normaliseSeverity(input)).toBe(expected);
  });
});

// ── Property-based tests (Property 6) ─────────────────────────────────────────

describe('SeverityNormaliser — Property 6: severity normalisation totality', () => {
  /**
   * Property 6: For any string input for severity (including empty string,
   * null-like values, or arbitrary casing), the normaliser should return
   * exactly one of: debug | info | warn | error | fatal.
   */

  it('always returns a valid severity for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = normaliseSeverity(input);
        expect(SEVERITY_LEVELS).toContain(result);
      }),
      { numRuns: 500 },
    );
  });

  it('always returns a valid severity for null/undefined', () => {
    expect(SEVERITY_LEVELS).toContain(normaliseSeverity(null));
    expect(SEVERITY_LEVELS).toContain(normaliseSeverity(undefined));
  });

  it('always returns a valid severity for numbers', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (n) => {
        const result = normaliseSeverity(n);
        expect(SEVERITY_LEVELS).toContain(result);
      }),
      { numRuns: 100 },
    );
  });

  it('is case-insensitive for known values', () => {
    const knownMappings: [string, SeverityLevel][] = [
      ['debug', 'debug'], ['DEBUG', 'debug'], ['Debug', 'debug'],
      ['info', 'info'], ['INFO', 'info'],
      ['warn', 'warn'], ['WARN', 'warn'],
      ['error', 'error'], ['ERROR', 'error'],
      ['fatal', 'fatal'], ['FATAL', 'fatal'],
    ];
    for (const [input, expected] of knownMappings) {
      expect(normaliseSeverity(input)).toBe(expected);
    }
  });
});
