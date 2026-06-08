import { Router, Request, Response } from 'express';
import { Redis } from 'ioredis';
import { RollupReader } from './rollupReader';
import { TrendAnalyser } from './trendAnalyser';
import { LogStreamReader } from './logStreamReader';
import { buildResponse } from './responseBuilder';
import {
  computeErrorBudget,
  deriveSloStatus,
  computeUptimePct,
  computeBudgetRequests,
} from './budgetCalculator';
import { RollupWindow, SloStatus } from './types';

export function createRouter(
  _redis: Redis,
  rollupReader: RollupReader,
  trendAnalyser: TrendAnalyser,
  logStreamReader: LogStreamReader,
): Router {
  const router = Router();

  // GET /health
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // GET /slo/summary — fleet snapshot for all services
  router.get('/slo/summary', async (_req: Request, res: Response) => {
    try {
      const services = await rollupReader.listServices();

      const results: { status: SloStatus; computedAt: string }[] = [];

      await Promise.all(
        services.map(async (serviceName) => {
          const rollup = await rollupReader.readLatest(serviceName, '1h');
          if (!rollup) return;
          const status: SloStatus = {
            serviceName: rollup.serviceName,
            sloTarget: rollup.sloTarget,
            currentErrorRate: rollup.errorRate,
            uptimePct: computeUptimePct(rollup.errorRate),
            burnRate: rollup.burnRate,
            status: deriveSloStatus(rollup.burnRate),
          };
          results.push({ status, computedAt: rollup.computedAt });
        }),
      );

      const statuses = results.map((r) => r.status);

      // Use the earliest computedAt; fall back to now if no results
      let computedAt: string;
      if (results.length > 0) {
        const earliest = results.reduce((min, r) =>
          new Date(r.computedAt) < new Date(min.computedAt) ? r : min,
        );
        computedAt = earliest.computedAt;
      } else {
        computedAt = new Date().toISOString();
      }

      res.json(buildResponse(statuses, computedAt));
    } catch (err) {
      console.error('[routes] /slo/summary error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /slo/:service — single service SLO status
  router.get('/slo/:service', async (req: Request, res: Response) => {
    try {
      const { service } = req.params;
      const rollup = await rollupReader.readLatest(service, '1h');

      if (!rollup) {
        res.status(404).json({ error: `No rollup data found for service: ${service}` });
        return;
      }

      const sloStatus: SloStatus = {
        serviceName: rollup.serviceName,
        sloTarget: rollup.sloTarget,
        currentErrorRate: rollup.errorRate,
        uptimePct: computeUptimePct(rollup.errorRate),
        burnRate: rollup.burnRate,
        status: deriveSloStatus(rollup.burnRate),
      };

      res.json(buildResponse(sloStatus, rollup.computedAt));
    } catch (err) {
      console.error('[routes] /slo/:service error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /slo/:service/budget — error budget per window
  router.get('/slo/:service/budget', async (req: Request, res: Response) => {
    try {
      const { service } = req.params;
      const windows: RollupWindow[] = ['1h', '6h', '24h', '72h'];

      const budgets = await Promise.all(
        windows.map(async (window) => {
          const rollup = await rollupReader.readLatest(service, window);
          if (!rollup) return null;

          const budget = computeErrorBudget(rollup.burnRate, rollup.sloTarget, window);
          const budgetRequests = computeBudgetRequests(
            rollup.burnRate,
            rollup.sloTarget,
            rollup.requestCount,
          );

          return { ...budget, budgetRequests };
        }),
      );

      const validBudgets = budgets.filter((b) => b !== null);

      // Use the computedAt from the first available rollup for freshness; fall back to now
      const firstRollup = await rollupReader.readLatest(service, '1h');
      const computedAt = firstRollup ? firstRollup.computedAt : new Date().toISOString();

      res.json(buildResponse(validBudgets, computedAt));
    } catch (err) {
      console.error('[routes] /slo/:service/budget error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /slo/:service/trend — 7-day burn rate trend
  router.get('/slo/:service/trend', async (req: Request, res: Response) => {
    try {
      const { service } = req.params;
      const trend = await trendAnalyser.getTrend(service);
      // No single rollup to anchor freshness — use now
      res.json(buildResponse(trend, new Date().toISOString()));
    } catch (err) {
      console.error('[routes] /slo/:service/trend error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /logs/:service/errors — recent error log entries
  router.get('/logs/:service/errors', async (req: Request, res: Response) => {
    try {
      const { service } = req.params;
      const limitParam = req.query['limit'];
      const limit = limitParam ? parseInt(String(limitParam), 10) : 50;
      const entries = await logStreamReader.getRecentErrors(service, limit);
      res.json(buildResponse(entries, new Date().toISOString()));
    } catch (err) {
      console.error('[routes] /logs/:service/errors error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
