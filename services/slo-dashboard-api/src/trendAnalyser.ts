import { RollupReader } from './rollupReader';
import { TrendPoint, RollupWindow } from './types';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class TrendAnalyser {
  constructor(private readonly rollupReader: RollupReader) {}

  /**
   * Build 7-day burn rate trend data points for a service.
   * Uses 1h window rollups as the resolution.
   */
  async getTrend(
    serviceName: string,
    window: RollupWindow = '1h',
  ): Promise<TrendPoint[]> {
    const toMs = Date.now();
    const fromMs = toMs - SEVEN_DAYS_MS;

    const rollups = await this.rollupReader.readRange(serviceName, window, fromMs, toMs);

    return rollups.map((r) => ({
      timestamp: r.computedAt,
      burnRate: r.burnRate,
      errorRate: r.errorRate,
    }));
  }
}
