import { ErrorBudget, RollupWindow, WINDOW_HOURS } from './types';

/**
 * Derive SLO status label from burn rate.
 */
export function deriveSloStatus(burnRate: number): 'healthy' | 'at-risk' | 'breached' {
  if (burnRate >= 14.4) return 'breached';   // 1h burn rate exhausts 30-day budget
  if (burnRate >= 1) return 'at-risk';
  return 'healthy';
}

/**
 * Compute uptime percentage from error rate.
 */
export function computeUptimePct(errorRate: number): number {
  return Math.max(0, Math.min(100, (1 - errorRate) * 100));
}

/**
 * Compute error budget details for a given window.
 *
 * allowed_downtime_minutes = window_hours × 60 × (1 - slo_target)
 * consumed_minutes         = burn_rate × allowed_downtime_minutes
 * remaining_minutes        = max(0, allowed - consumed)
 */
export function computeErrorBudget(
  burnRate: number,
  sloTarget: number,
  window: RollupWindow,
): ErrorBudget {
  const windowHours = WINDOW_HOURS[window];
  const windowMinutes = windowHours * 60;
  const allowedDowntimeMinutes = windowMinutes * (1 - sloTarget);
  const consumedMinutes = burnRate * allowedDowntimeMinutes;
  const remainingMinutes = Math.max(0, allowedDowntimeMinutes - consumedMinutes);
  const consumedPct =
    allowedDowntimeMinutes > 0
      ? Math.min(100, (consumedMinutes / allowedDowntimeMinutes) * 100)
      : 100;

  return {
    window,
    burnRate,
    allowedDowntimeMinutes,
    consumedMinutes,
    remainingMinutes,
    consumedPct,
  };
}

/**
 * Compute error budget remaining in estimated request count.
 * Requires total request count for the window period.
 */
export function computeBudgetRequests(
  burnRate: number,
  sloTarget: number,
  requestCount: number,
): number {
  const allowedErrorRate = 1 - sloTarget;
  const allowedErrors = requestCount * allowedErrorRate;
  const consumedErrors = burnRate * allowedErrors;
  return Math.max(0, Math.floor(allowedErrors - consumedErrors));
}
