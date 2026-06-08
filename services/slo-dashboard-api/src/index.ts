import express from 'express';
import { getRedisClient, closeRedis } from './redis';
import { RollupReader } from './rollupReader';
import { TrendAnalyser } from './trendAnalyser';
import { LogStreamReader } from './logStreamReader';
import { createRouter } from './routes';

const PORT = parseInt(process.env.DASHBOARD_PORT ?? process.env.PORT ?? '4002', 10);

async function main(): Promise<void> {
  const redis = getRedisClient();
  await redis.connect();
  console.log('[slo-dashboard-api] connected to Redis');

  const rollupReader = new RollupReader(redis);
  const trendAnalyser = new TrendAnalyser(rollupReader);
  const logStreamReader = new LogStreamReader(redis);

  const app = express();
  app.use(express.json());
  app.use(createRouter(redis, rollupReader, trendAnalyser, logStreamReader));

  const server = app.listen(PORT, () => {
    console.log(`[slo-dashboard-api] listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('[slo-dashboard-api] shutting down...');
    server.close(async () => {
      await closeRedis();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[slo-dashboard-api] fatal error:', err);
  process.exit(1);
});
