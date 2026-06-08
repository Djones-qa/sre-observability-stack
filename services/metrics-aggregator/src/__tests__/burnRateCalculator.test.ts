import * as fc from 'fast-check';
import {
  computeBurnRate,
  computeErrorRate,
  computeUptimePct,
  buildRollup,
  computeErrorBudget,
} from '../burnRateCalculator';
import { RollupWindow, WINDOW_HOURS } from '../types';

// ── Example-based tests ───────────────────────────────────────────────────────

describe('computeBurnRate — examples', () => {
  it('returns 0 when error rate is 0', () => {
    expect(computeBurnRate(0, 0.999)).toBe(0);
  });

  it('returns 1 when error rate exactly equals allowed error rate', () => {
    // allowed = 1 - 0.999 = 0.001; observed = 0.001 → burn = 1
    expect(computeBurnRate(0.001, 0.999)).toBeCloseTo(1, 5);
  });

  it('returns >1 when consuming budget faster than allowed', () => {
    // observed = 0.01 (10x allowed), allowed = 0.001 → burn = 10
    expect(computeBurnRate(0.01, 0.999)).toBeCloseTo(10, 5);
  });

  it('returns <1 when consuming budget slower than allowed', () => {
    // observed = 0.0001 → burn = 0.1
    expect(computeBurnRate(0.0001, 0.999)).toBeCloseTo(0.1, 5);
  });

  it('throws on invalid sloTarget=0', () => {
    expect(() => computeBurnRate(0, 0)).toThrow(RangeError);
  });

  it('throws on invalid sloTarget=1', () => {
    expect(() => computeBurnRate(0, 1)).toThrow(RangeError);
  });

  it('throws on negative error rate', () => {
    expect(() => computeBurnRate(-0.1, 0.999)).toThrow(RangeError);
  });
});

describe('computeErrorRate', () => {
  it('returns 0 for zero requests', () => {
    expect(computeErrorRate(0, 0)).toBe(0);
  });

  it('correctly computes error rate', () => {
    expect(computeErrorRate(1000, 10)).toBeCloseTo(0.01, 5);
  });

  it('clamps to 1 when errors > requests', () => {
    expect(computeErrorRate(10, 20)).toBe(1);
  });
});

describe('computeUptimePct', () => {
  it('returns 100 for 0 error rate', () => {
    expect(computeUptimePct(0)).toBe(100);
  });

  it('returns 99.9 for 0.001 error rate', () => {
    expect(computeUptimePct(0.001)).toBeCloseTo(99.9, 3);
  });
});

describe('computeErrorBudget', () => {
  it('computes 1h budget correctly at burn rate 1', () => {
    // allowed = 1h * 60 * 0.001 = 0.06 minutes
    const budget = computeErrorBudget(1, 0.999, '1h');
    expect(budget.remainingMinutes).toBeCloseTo(0, 2);
    expect(budget.consumedPct).toBeCloseTo(100, 0);
  });

  it('computes 24h budget with burn rate 0', () => {
    const budget = computeErrorBudget(0, 0.999, '24h');
    // allowed = 24 * 60 * 0.001 = 1.44 minutes
    expect(budget.allowedDowntimeMinutes).toBeCloseTo(1.44, 2);
    expect(budget.remainingMinutes).toBeCloseTo(1.44, 2);
    expect(budget.consumedPct).toBe(0);
  });

  it('floors remaining budget at 0 for high burn rates', () => {
    const budget = computeErrorBudget(100, 0.999, '1h');
    expect(budget.remainingMinutes).toBe(0);
  });
});

// ── Property-based tests (Property 4) ─────────────────────────────────────────

describe('BurnRateCalculator — Property 4: burn rate formula correctness', () => {
  /**
   * Property 4: For any observed error rate in [0,1] and SLO target in (0,1),
   * the computed burn rate should equal error_rate / (1 - slo_target),
   * be non-negative, and be >1 when error_rate > (1 - slo_target).
   */

  const errorRateArb = fc.float({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
  const sloTargetArb = fc.float({ min: 0.001, max: 0.9999, noNaN: true, noDefaultInfinity: true });

  it('burn rate formula holds for all valid inputs', () => {
    fc.assert(
      fc.property(errorRateArb, sloTargetArb, (errorRate, sloTarget) => {
        const burnRate = computeBurnRate(errorRate, sloTarget);
        const expected = errorRate / (1 - sloTarget);
        expect(burnRate).toBeCloseTo(expected, 5);
      }),
      { numRuns: 200 },
    );
  });

  it('burn rate is always non-negative for valid inputs', () => {
    fc.assert(
      fc.property(errorRateArb, sloTargetArb, (errorRate, sloTarget) => {
        const burnRate = computeBurnRate(errorRate, sloTarget);
        expect(burnRate).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it('burn rate >1 iff observed error rate > allowed error rate', () => {
    fc.assert(
      fc.property(sloTargetArb, (sloTarget) => {
        const allowedErrorRate = 1 - sloTarget;
        const observedErrorRate = allowedErrorRate * 2; // 2x allowed = burn rate should be 2
        if (observedErrorRate > 1) return; // skip if clamped
        const burnRate = computeBurnRate(observedErrorRate, sloTarget);
        expect(burnRate).toBeGreaterThan(1);
      }),
      { numRuns: 200 },
    );
  });

  it('burn rate equals 1 when observed equals allowed', () => {
    fc.assert(
      fc.property(sloTargetArb, (sloTarget) => {
        const allowedErrorRate = 1 - sloTarget;
        if (allowedErrorRate > 1 || allowedErrorRate < 0) return;
        const burnRate = computeBurnRate(allowedErrorRate, sloTarget);
        expect(burnRate).toBeCloseTo(1, 5);
      }),
      { numRuns: 200 },
    );
  });

  it('error budget remaining is always non-negative (Property 8)', () => {
    const windows: RollupWindow[] = ['1h', '6h', '24h', '72h'];
    const burnRateArb = fc.float({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true });

    fc.assert(
      fc.property(burnRateArb, sloTargetArb, fc.constantFrom(...windows), (burnRate, sloTarget, window) => {
        const budget = computeErrorBudget(burnRate, sloTarget, window);
        expect(budget.remainingMinutes).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
});
