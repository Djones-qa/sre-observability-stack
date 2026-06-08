import express from 'express';
import { getRedisClient, closeRedis } from './redis';
import { StreamWriter } from './streamWriter';
import { initConsumerGroup } from './consumerGroupInit';
import { createRouter } from './routes';

const PORT = parseInt(process.env.LOG_PORT ?? process.env.PORT ?? '4001', 10);

async function main(): Promise<void> {
  const redis = getRedisClient();
  await redis.connect();
  console.log('[log-pipeline] connected to Redis');

  // Initialise consumer group
  await initConsumerGroup(redis);

  const streamWriter = new StreamWriter(redis);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(createRouter(streamWriter));

  const server = app.listen(PORT, () => {
    console.log(`[log-pipeline] listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('[log-pipeline] shutting down...');
    server.close(async () => {
      await closeRedis();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[log-pipeline] fatal error:', err);
  process.exit(1);
});
