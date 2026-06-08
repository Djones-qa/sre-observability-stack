import { Redis } from 'ioredis';
import { ScrapeTarget } from './types';

const REGISTRY_KEY = 'targets:registry';

export class TargetRegistry {
  constructor(private readonly redis: Redis) {}

  /**
   * Register a scrape target. Returns the registered target.
   * Throws if any required field is missing.
   */
  async register(target: ScrapeTarget): Promise<ScrapeTarget> {
    this.validate(target);
    await this.redis.hset(REGISTRY_KEY, target.id, JSON.stringify(target));
    return target;
  }

  /**
   * Remove a target by ID. Returns true if it existed.
   */
  async deregister(id: string): Promise<boolean> {
    const count = await this.redis.hdel(REGISTRY_KEY, id);
    return count > 0;
  }

  /**
   * Return all registered targets.
   */
  async list(): Promise<ScrapeTarget[]> {
    const data = await this.redis.hgetall(REGISTRY_KEY);
    if (!data) return [];
    return Object.values(data).map((v) => JSON.parse(v) as ScrapeTarget);
  }

  /**
   * Return a single target by ID, or null if not found.
   */
  async get(id: string): Promise<ScrapeTarget | null> {
    const raw = await this.redis.hget(REGISTRY_KEY, id);
    if (!raw) return null;
    return JSON.parse(raw) as ScrapeTarget;
  }

  /**
   * Return true if no targets are registered.
   */
  async isEmpty(): Promise<boolean> {
    const count = await this.redis.hlen(REGISTRY_KEY);
    return count === 0;
  }

  private validate(target: ScrapeTarget): void {
    const required: Array<keyof ScrapeTarget> = [
      'id',
      'url',
      'serviceName',
      'scrapeIntervalSeconds',
    ];
    for (const field of required) {
      const value = target[field];
      if (value === undefined || value === null || value === '') {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    if (typeof target.scrapeIntervalSeconds !== 'number' || target.scrapeIntervalSeconds <= 0) {
      throw new Error('scrapeIntervalSeconds must be a positive number');
    }
    try {
      new URL(target.url);
    } catch {
      throw new Error(`Invalid URL: ${target.url}`);
    }
  }
}
