import { Redis } from 'ioredis';
import { RollupData, RollupWindow, ROLLUP_TTL_SECONDS } from './types';

export class RollupStore {
  constructor(private readonly redis: Redis) {}

  rollupKey(serviceName: string, window: RollupWindow): string {
    return `rollup:${serviceName}:${window}`;
  }

  /**
   * Write a rollup entry to the sorted set keyed by timestamp.
   * Applies TTL by pruning entries older than the TTL threshold.
   */
  async writeRollup(rollup: RollupData): Promise<void> {
    const key = this.rollupKey(rollup.serviceName, rollup.window);
    const score = Date.now();
    const member = JSON.stringify(rollup);

    await this.redis.zadd(key, score, member);

    // Prune entries older than TTL
    const ttlMs = ROLLUP_TTL_SECONDS[rollup.window] * 1000;
    const cutoff = score - ttlMs;
    await this.redis.zremrangebyscore(key, '-inf', cutoff);
  }

  /**
   * Read the most recent rollup entry for a service+window pair.
   * Returns null if no data exists.
   */
  async readLatestRollup(
    serviceName: string,
    window: RollupWindow,
  ): Promise<RollupData | null> {
    const key = this.rollupKey(serviceName, window);
    // ZRANGE with REV returns highest scores first
    const results = await this.redis.zrange(key, 0, 0, 'REV');
    if (!results || results.length === 0) return null;
    try {
      return JSON.parse(results[0]) as RollupData;
    } catch {
      return null;
    }
  }

  /**
   * Read all rollup entries within a time range (for trend data).
   * Returns entries sorted by timestamp ascending.
   */
  async readRollupRange(
    serviceName: string,
    window: RollupWindow,
    fromMs: number,
    toMs: number,
  ): Promise<RollupData[]> {
    const key = this.rollupKey(serviceName, window);
    const results = await this.redis.zrangebyscore(key, fromMs, toMs);
    return results
      .map((r) => {
        try {
          return JSON.parse(r) as RollupData;
        } catch {
          return null;
        }
      })
      .filter((r): r is RollupData => r !== null);
  }
}
