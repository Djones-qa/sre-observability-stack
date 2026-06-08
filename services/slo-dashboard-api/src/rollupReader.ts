import { Redis } from 'ioredis';
import { RollupData, RollupWindow } from './types';

export class RollupReader {
  constructor(private readonly redis: Redis) {}

  rollupKey(serviceName: string, window: RollupWindow): string {
    return `rollup:${serviceName}:${window}`;
  }

  /**
   * Read the most recent rollup entry for a service+window pair.
   */
  async readLatest(serviceName: string, window: RollupWindow): Promise<RollupData | null> {
    const key = this.rollupKey(serviceName, window);
    const results = await this.redis.zrange(key, 0, 0, 'REV');
    if (!results || results.length === 0) return null;
    try {
      return JSON.parse(results[0]) as RollupData;
    } catch {
      return null;
    }
  }

  /**
   * Read rollup entries within a time range (ascending by timestamp).
   */
  async readRange(
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

  /**
   * Get all service names from the targets:registry hash.
   */
  async listServices(): Promise<string[]> {
    const data = await this.redis.hgetall('targets:registry');
    if (!data) return [];
    return Object.values(data)
      .map((v) => {
        try {
          const parsed = JSON.parse(v) as { serviceName?: string };
          return parsed.serviceName ?? '';
        } catch {
          return '';
        }
      })
      .filter((s) => s.length > 0);
  }
}
