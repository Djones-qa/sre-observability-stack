import { Router, Request, Response } from 'express';
import { Redis } from 'ioredis';
import { TargetRegistry } from './targetRegistry';
import { RollupStore } from './rollupStore';
import { Scraper } from './scraper';
import { RollupWindow } from './types';

const VALID_WINDOWS: RollupWindow[] = ['1h', '6h', '24h', '72h'];

export function createRouter(
  redis: Redis,
  registry: TargetRegistry,
  rollupStore: RollupStore,
  scraper: Scraper,
): Router {
  const router = Router();

  // ── Health & Readiness ────────────────────────────────────────────────────

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      await redis.ping();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not ready', reason: 'Redis unavailable' });
    }
  });

  // ── Targets ────────────────────────────────────────────────────────────────

  router.post('/targets', async (req: Request, res: Response) => {
    try {
      const target = req.body;
      const registered = await registry.register(target);
      // Schedule scraping for the new target
      scraper.scheduleTarget(registered.id, registered.scrapeIntervalSeconds);
      res.status(201).json(registered);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid target';
      res.status(400).json({ error: message });
    }
  });

  router.get('/targets', async (_req: Request, res: Response) => {
    const targets = await registry.list();
    res.json(targets);
  });

  router.delete('/targets/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const existed = await registry.deregister(id);
    scraper.unscheduleTarget(id);
    if (existed) {
      res.json({ message: `Target ${id} deregistered` });
    } else {
      res.status(404).json({ error: `Target ${id} not found` });
    }
  });

  // ── Metrics Query ──────────────────────────────────────────────────────────

  router.get('/metrics/query', async (req: Request, res: Response) => {
    const { serviceName, window } = req.query as {
      serviceName?: string;
      window?: string;
    };

    if (!serviceName) {
      return res.status(400).json({ error: 'serviceName query parameter is required' });
    }
    if (!window || !VALID_WINDOWS.includes(window as RollupWindow)) {
      return res.status(400).json({
        error: `window must be one of: ${VALID_WINDOWS.join(', ')}`,
      });
    }

    const rollup = await rollupStore.readLatestRollup(serviceName, window as RollupWindow);
    if (!rollup) {
      return res.status(404).json({
        error: `No rollup data found for service=${serviceName} window=${window}`,
      });
    }

    return res.json(rollup);
  });

  return router;
}
