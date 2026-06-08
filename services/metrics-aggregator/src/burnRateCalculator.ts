import { RollupData, RollupWindow, WINDOW_HOURS } from './types';

/**
 * Compute the burn rate for a given observed error rate and SLO target.
 *
 * burn_rate = observed_error_rate / allowed_error_rate
 * allowed_error_rate = 1 - slo_target
 *
 * A burn_rate > 1 means budget is being consumed faster than allowed.
 * Returns 0 if total requests is 0 (no data = no burn).
 */
export function computeBurnRate(
  observedErrorRate: number,
  sloTarget: number,
): number {
  if (sloTarget <= 0 || sloTarget >= 1) {
    throw new RangeError('sloTarget must be in (0, 1)');
  }
  if (observedErrorRate < 0 || observedErrorRate > 1) {
    throw new RangeError('observedErrorRate must be in [0, 1]');
  }
  const allowedErrorRate = 1 - sloTarget;
  if (allowedErrorRate === 0) return Infinity;
  return observedErrorRate / allowedErrorRate;
}

/**
 * Compute an error rate from raw request/error counts.
 * Returns 0 if requestCount is 0.
 */
export function computeErrorRate(requestCount: number, errorCount: number): number {
  if (requestCount <= 0) return 0;
  const rate = errorCount / requestCount;
  // Clamp to [0, 1]
  return Math.min(1, Math.max(0, rate));
}

/**
 * Compute uptime percentage from error rate.
 */
export function computeUptimePct(errorRate: number): number {
  return Math.max(0, (1 - errorRate) * 100);
}

/**
 * Build a RollupData object for a given window.
 */
export function buildRollup(params: {
  serviceName: string;
  window: RollupWindow;
  requestCount: number;
  errorCount: number;
  sloTarget: number;
}): RollupData {
  const { serviceName, window, requestCount, errorCount, sloTarget } = params;
  const errorRate = computeErrorRate(requestCount, errorCount);
  const burnRate = computeBurnRate(errorRate, sloTarget);
  return {
    serviceName,
    window,
    requestCount,
    errorCount,
    errorRate,
    burnRate,
    sloTarget,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Compute the error budget remaining for a given window.
 *
 * allowed_downtime_minutes = window_hours * 60 * (1 - slo_target)
 * budget_consumed_minutes  = burn_rate * allowed_downtime_minutes
 * budget_remaining_minutes = max(0, allowed_downtime_minutes - budget_consumed_minutes)
 */
export function computeErrorBudget(
  burnRate: number,
  sloTarget: number,
  window: RollupWindow,
): {
  allowedDowntimeMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  consumedPct: number;
} {
  const windowHours = WINDOW_HOURS[window];
  const windowMinutes = windowHours * 60;
  const allowedDowntimeMinutes = windowMinutes * (1 - sloTarget);
  const consumedMinutes = burnRate * allowedDowntimeMinutes;
  const remainingMinutes = Math.max(0, allowedDowntimeMinutes - consumedMinutes);
  const consumedPct = allowedDowntimeMinutes > 0
    ? Math.min(100, (consumedMinutes / allowedDowntimeMinutes) * 100)
    : 100;

  return {
    allowedDowntimeMinutes,
    consumedMinutes,
    remainingMinutes,
    consumedPct,
  };
}
