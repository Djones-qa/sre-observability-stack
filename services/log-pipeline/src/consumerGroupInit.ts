import { Redis } from 'ioredis';
import { STREAM_ERRORS, CONSUMER_GROUP } from './types';

/**
 * Create the alert-consumers consumer group on the logs:errors stream.
 * Uses MKSTREAM so the stream is created if it doesn't exist yet.
 * Idempotent — safe to call on every startup.
 */
export async function initConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM_ERRORS, CONSUMER_GROUP, '$', 'MKSTREAM');
    console.log(`[log-pipeline] consumer group '${CONSUMER_GROUP}' created on '${STREAM_ERRORS}'`);
  } catch (err: unknown) {
    // BUSYGROUP error means it already exists — that's fine
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('BUSYGROUP')) {
      console.log(`[log-pipeline] consumer group '${CONSUMER_GROUP}' already exists`);
    } else {
      throw err;
    }
  }
}
