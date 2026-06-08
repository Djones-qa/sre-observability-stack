import express from 'express';
import { getRedisClient, closeRedis } from './redis';
import { TargetRegistry } from './targetRegistry';
import { RollupStore } from './rollupStore';
import { Scraper } from './scraper';
import { seedIfEmpty } from './seedService';
import { createRouter } from './routes';

const PORT = parseInt(process.env.METRICS_PORT ?? process.env.PORT ?? '4000', 10);

async function main(): Promise<void> {
  const redis = getRedisClient();

  // Ensure Redis connection before starting
  await redis.connect();
  console.log('[metrics-aggregator] connected to Redis');

  const registry = new TargetRegistry(redis);
  const rollupStore = new RollupStore(redis);
  const scraper = new Scraper(registry, rollupStore, redis);

  // Seed example data on first boot
  await seedIfEmpty(redis, registry);

  // Start scrape schedules
  await scraper.start();

  const app = express();
  app.use(express.json());
  app.use(createRouter(redis, registry, rollupStore, scraper));

  const server = app.listen(PORT, () => {
    console.log(`[metrics-aggregator] listening on port ${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[metrics-aggregator] shutting down...');
    scraper.stop();
    server.close(async () => {
      await closeRedis();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[metrics-aggregator] fatal error:', err);
  process.exit(1);
});
