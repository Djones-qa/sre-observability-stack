import { Redis } from 'ioredis';
import { TargetRegistry } from './targetRegistry';
import { ScrapeTarget } from './types';

const DEFAULT_SLO_TARGET = parseFloat(process.env.DEFAULT_SLO_TARGET ?? '0.999');

const SEED_TARGETS: ScrapeTarget[] = [
  {
    id: 'api-gateway',
    url: 'http://mock-metrics:9090/metrics',
    serviceName: 'api-gateway',
    scrapeIntervalSeconds: 15,
  },
  {
    id: 'checkout-service',
    url: 'http://mock-metrics:9090/metrics',
    serviceName: 'checkout-service',
    scrapeIntervalSeconds: 30,
  },
  {
    id: 'payment-service',
    url: 'http://mock-metrics:9090/metrics',
    serviceName: 'payment-service',
    scrapeIntervalSeconds: 30,
  },
];

export async function seedIfEmpty(
  redis: Redis,
  registry: TargetRegistry,
): Promise<void> {
  const empty = await registry.isEmpty();
  if (!empty) {
    console.log('[seed] targets already registered, skipping seed');
    return;
  }

  console.log('[seed] seeding example targets and SLO configs...');

  for (const target of SEED_TARGETS) {
    await registry.register(target);
    // Seed SLO config hash for each service
    await redis.hset(`slo:config:${target.serviceName}`, {
      target: String(DEFAULT_SLO_TARGET),
      serviceName: target.serviceName,
    });
    console.log(`[seed] registered target: ${target.serviceName}`);
  }
}
