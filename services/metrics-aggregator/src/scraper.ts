import axios from 'axios';
import { Redis } from 'ioredis';
import { TargetRegistry } from './targetRegistry';
import { RollupStore } from './rollupStore';
import { parsePrometheusText } from './prometheusParser';
import { buildRollup, computeErrorRate } from './burnRateCalculator';
import { RollupWindow, MetricFamily } from './types';

const SCRAPE_TIMEOUT_MS = parseInt(process.env.SCRAPE_TIMEOUT_MS ?? '10000', 10);
const DEFAULT_SLO_TARGET = parseFloat(process.env.DEFAULT_SLO_TARGET ?? '0.999');
const WINDOWS: RollupWindow[] = ['1h', '6h', '24h', '72h'];

// In-memory scrape error counters
const errorCounters = new Map<string, number>();

// Track interval handles for cleanup
const intervals = new Map<string, NodeJS.Timeout>();

export class Scraper {
  constructor(
    private readonly registry: TargetRegistry,
    private readonly rollupStore: RollupStore,
    private readonly redis: Redis,
  ) {}

  /**
   * Start scraping all currently registered targets and watch for new ones.
   */
  async start(): Promise<void> {
    const targets = await this.registry.list();
    for (const target of targets) {
      this.scheduleTarget(target.id, target.scrapeIntervalSeconds);
    }
    console.log(`[scraper] started ${targets.length} scrape schedules`);
  }

  /**
   * Schedule periodic scraping for a single target.
   */
  scheduleTarget(targetId: string, intervalSeconds: number): void {
    if (intervals.has(targetId)) {
      clearInterval(intervals.get(targetId)!);
    }
    const handle = setInterval(async () => {
      await this.scrapeTarget(targetId);
    }, intervalSeconds * 1000);
    intervals.set(targetId, handle);
    // Run an initial scrape immediately
    setImmediate(() => this.scrapeTarget(targetId));
  }

  /**
   * Unschedule a target.
   */
  unscheduleTarget(targetId: string): void {
    const handle = intervals.get(targetId);
    if (handle) {
      clearInterval(handle);
      intervals.delete(targetId);
    }
  }

  /**
   * Stop all scrape schedules.
   */
  stop(): void {
    for (const [id, handle] of intervals) {
      clearInterval(handle);
      console.log(`[scraper] stopped schedule for ${id}`);
    }
    intervals.clear();
  }

  /**
   * Perform a single scrape for the given target ID.
   */
  async scrapeTarget(targetId: string): Promise<void> {
    const target = await this.registry.get(targetId);
    if (!target) return;

    try {
      const response = await axios.get<string>(target.url, {
        timeout: SCRAPE_TIMEOUT_MS,
        responseType: 'text',
        headers: { Accept: 'text/plain; version=0.0.4' },
      });

      const families = parsePrometheusText(response.data);
      const { requestCount, errorCount } = extractCounts(families);

      // Look up per-service SLO target
      const sloTarget = await this.getSloTarget(target.serviceName);

      // Compute rollup for all windows and store
      for (const window of WINDOWS) {
        const rollup = buildRollup({
          serviceName: target.serviceName,
          window,
          requestCount,
          errorCount,
          sloTarget,
        });
        await this.rollupStore.writeRollup(rollup);
      }

      // Reset error counter on success
      errorCounters.set(targetId, 0);
    } catch (err: unknown) {
      const current = errorCounters.get(targetId) ?? 0;
      errorCounters.set(targetId, current + 1);
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[scraper] failed to scrape ${target.url}: ${message} (errors: ${current + 1})`);
    }
  }

  private async getSloTarget(serviceName: string): Promise<number> {
    const raw = await this.redis.hget(`slo:config:${serviceName}`, 'target');
    if (raw) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) return parsed;
    }
    return DEFAULT_SLO_TARGET;
  }

  getErrorCount(targetId: string): number {
    return errorCounters.get(targetId) ?? 0;
  }
}

/**
 * Extract request and error counts from parsed metric families.
 * Looks for common Prometheus patterns:
 *   - http_requests_total{status=~"5.."} for errors
 *   - http_requests_total for totals
 */
function extractCounts(families: MetricFamily[]): {
  requestCount: number;
  errorCount: number;
} {
  let requestCount = 0;
  let errorCount = 0;

  for (const family of families) {
    const name = family.name.toLowerCase();

    if (
      name.includes('http_requests_total') ||
      name.includes('requests_total') ||
      name.includes('http_request_duration_seconds_count')
    ) {
      for (const sample of family.samples) {
        const status = sample.labels['status'] ?? sample.labels['code'] ?? '';
        if (!isNaN(sample.value) && isFinite(sample.value)) {
          requestCount += sample.value;
          if (/^5\d\d$/.test(status)) {
            errorCount += sample.value;
          }
        }
      }
    }
  }

  return { requestCount, errorCount };
}
