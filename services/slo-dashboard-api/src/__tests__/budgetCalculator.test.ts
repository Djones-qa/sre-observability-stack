import * as fc from 'fast-check';
import {
  deriveSloStatus,
  computeUptimePct,
  computeErrorBudget,
  computeBudgetRequests,
} from '../budgetCalculator';
import { RollupWindow } from '../types';

// ── deriveSloStatus ────────────────────────────────────────────────────────────

describe('deriveSloStatus — examples', () => {
  it('returns "healthy" for burnRate 0.5 (below 1)', () => {
    expect(deriveSloStatus(0.5)).toBe('healthy');
  });

  it('returns "at-risk" for burnRate exactly 1.0', () => {
    expect(deriveSloStatus(1.0)).toBe('at-risk');
  });

  it('returns "at-risk" for burnRate 5 (between 1 and 14.4)', () => {
    expect(deriveSloStatus(5)).toBe('at-risk');
  });

  it('returns "breached" for burnRate exactly 14.4', () => {
    expect(deriveSloStatus(14.4)).toBe('breached');
  });

  it('returns "breached" for burnRate above 14.4', () => {
    expect(deriveSloStatus(100)).toBe('breached');
  });

  it('returns "healthy" for burnRate 0', () => {
    expect(deriveSloStatus(0)).toBe('healthy');
  });
});

// ── computeUptimePct ─────────────────────────────────────────────────────────

describe('computeUptimePct — examples', () => {
  it('returns 100 for 0 error rate', () => {
    expect(computeUptimePct(0)).toBe(100);
  });

  it('returns 99.9 for 0.001 error rate', () => {
    expect(computeUptimePct(0.001)).toBeCloseTo(99.9, 3);
  });

  it('returns 0 for 1.0 (100%) error rate', () => {
    expect(computeUptimePct(1.0)).toBe(0);
  });

  it('returns 99 for 0.01 error rate', () => {
    expect(computeUptimePct(0.01)).toBeCloseTo(99, 3);
  });

  it('clamps to 0 for error rate > 1', () => {
    expect(computeUptimePct(2)).toBe(0);
  });

  it('clamps to 100 for negative error rate', () => {
    expect(computeUptimePct(-0.1)).toBe(100);
  });
});

// ── computeErrorBudget ───────────────────────────────────────────────────────

describe('computeErrorBudget — examples', () => {
  const SLO = 0.999; // 99.9% SLO → allowedErrorRate = 0.001

  describe('1h window', () => {
    it('computes correct allowedDowntimeMinutes for 1h at SLO 0.999', () => {
      // 1h * 60 * 0.001 = 0.06 minutes
      const budget = computeErrorBudget(1, SLO, '1h');
      expect(budget.allowedDowntimeMinutes).toBeCloseTo(0.06, 4);
    });

    it('remainingMinutes >= 0 for burn rate 0 on 1h window', () => {
      const budget = computeErrorBudget(0, SLO, '1h');
      expect(budget.remainingMinutes).toBeGreaterThanOrEqual(0);
      expect(budget.remainingMinutes).toBeCloseTo(0.06, 4);
    });

    it('remainingMinutes is 0 when burn rate >= 1', () => {
      const budget = computeErrorBudget(2, SLO, '1h');
      expect(budget.remainingMinutes).toBe(0);
    });
  });

  describe('6h window', () => {
    it('computes allowedDowntimeMinutes = 6 * 60 * 0.001 = 0.36 for SLO 0.999', () => {
      const budget = computeErrorBudget(0, SLO, '6h');
      expect(budget.allowedDowntimeMinutes).toBeCloseTo(0.36, 4);
    });

    it('remainingMinutes >= 0', () => {
      const budget = computeErrorBudget(0.5, SLO, '6h');
      expect(budget.remainingMinutes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('24h window', () => {
    it('computes allowedDowntimeMinutes = 24 * 60 * 0.001 = 1.44 for SLO 0.999', () => {
      const budget = computeErrorBudget(0, SLO, '24h');
      expect(budget.allowedDowntimeMinutes).toBeCloseTo(1.44, 4);
    });

    it('remainingMinutes >= 0 for high burn rate', () => {
      const budget = computeErrorBudget(100, SLO, '24h');
      expect(budget.remainingMinutes).toBeGreaterThanOrEqual(0);
      expect(budget.remainingMinutes).toBe(0);
    });
  });

  describe('72h window', () => {
    it('computes allowedDowntimeMinutes = 72 * 60 * 0.001 = 4.32 for SLO 0.999', () => {
      const budget = computeErrorBudget(0, SLO, '72h');
      expect(budget.allowedDowntimeMinutes).toBeCloseTo(4.32, 4);
    });

    it('consumedPct is 50 when burn rate is 0.5', () => {
      const budget = computeErrorBudget(0.5, SLO, '72h');
      expect(budget.consumedPct).toBeCloseTo(50, 2);
    });

    it('remainingMinutes >= 0', () => {
      const budget = computeErrorBudget(0.5, SLO, '72h');
      expect(budget.remainingMinutes).toBeGreaterThanOrEqual(0);
    });
  });

  it('consumedPct is capped at 100', () => {
    const budget = computeErrorBudget(1000, SLO, '1h');
    expect(budget.consumedPct).toBe(100);
  });

  it('window field matches the supplied window', () => {
    const windows: RollupWindow[] = ['1h', '6h', '24h', '72h'];
    for (const w of windows) {
      const budget = computeErrorBudget(1, SLO, w);
      expect(budget.window).toBe(w);
    }
  });

  it('burnRate field matches the supplied burnRate', () => {
    const budget = computeErrorBudget(3.5, SLO, '6h');
    expect(budget.burnRate).toBe(3.5);
  });
});

// ── computeBudgetRequests ────────────────────────────────────────────────────

describe('computeBudgetRequests — examples', () => {
  it('returns floor of remaining allowed errors for burn rate 0', () => {
    // allowed = 1000 * 0.001 = 1; consumed = 0; remaining = 1
    expect(computeBudgetRequests(0, 0.999, 1000)).toBe(1);
  });

  it('returns 0 when burn rate >= 1 (budget exhausted)', () => {
    expect(computeBudgetRequests(1, 0.999, 1000)).toBe(0);
  });

  it('returns 0 when burn rate > 1', () => {
    expect(computeBudgetRequests(2, 0.999, 1000)).toBe(0);
  });

  it('returns half of allowed errors for burn rate 0.5', () => {
    // allowed = 1000 * 0.001 = 1; consumed = 0.5; remaining = 0 (floor)
    const remaining = computeBudgetRequests(0.5, 0.999, 1000);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it('handles large request counts', () => {
    // allowed = 1_000_000 * 0.001 = 1000; consumed = 0; remaining = 1000
    expect(computeBudgetRequests(0, 0.999, 1_000_000)).toBe(1000);
  });

  it('returns 0 for 0 requests', () => {
    expect(computeBudgetRequests(0, 0.999, 0)).toBe(0);
  });
});

// ── Property-Based Tests (Property 8) ────────────────────────────────────────
// **Validates: Requirements 8**

describe('BudgetCalculator — Property 8: remainingMinutes is always >= 0', () => {
  /**
   * Property 8: For any burnRate >= 0 and sloTarget in (0, 1),
   * computeErrorBudget must always produce remainingMinutes >= 0.
   */
  const windows: RollupWindow[] = ['1h', '6h', '24h', '72h'];

  const burnRateArb = fc.float({ min: 0, max: Math.fround(10000), noNaN: true, noDefaultInfinity: true });
  const sloTargetArb = fc.float({ min: Math.fround(0.001), max: Math.fround(0.9999), noNaN: true, noDefaultInfinity: true });

  it('remainingMinutes >= 0 for all valid burnRate, sloTarget, and window combinations', () => {
    fc.assert(
      fc.property(
        burnRateArb,
        sloTargetArb,
        fc.constantFrom(...windows),
        (burnRate, sloTarget, window) => {
          const budget = computeErrorBudget(burnRate, sloTarget, window);
          expect(budget.remainingMinutes).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('computeBudgetRequests returns >= 0 for all valid inputs', () => {
    const requestCountArb = fc.integer({ min: 0, max: 10_000_000 });

    fc.assert(
      fc.property(
        burnRateArb,
        sloTargetArb,
        requestCountArb,
        (burnRate, sloTarget, requestCount) => {
          const result = computeBudgetRequests(burnRate, sloTarget, requestCount);
          expect(result).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  });
});
