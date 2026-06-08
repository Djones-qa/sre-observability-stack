import { Router, Request, Response } from 'express';
import { enrichLogEntry, validateRawEntry } from './logEnricher';
import { StreamWriter } from './streamWriter';
import { RawLogEntry } from './types';

export function createRouter(streamWriter: StreamWriter): Router {
  const router = Router();

  // ── Health ─────────────────────────────────────────────────────────────────

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // ── Single log ingestion ───────────────────────────────────────────────────

  router.post('/ingest', async (req: Request, res: Response) => {
    const raw = req.body;
    const validationError = validateRawEntry(raw);

    if (validationError) {
      await streamWriter.writeToDLQ(JSON.stringify(raw));
      return res.status(422).json({ error: validationError });
    }

    const serviceNameOverride = req.headers['x-service-name'] as string | undefined;
    const enriched = enrichLogEntry(raw as RawLogEntry, serviceNameOverride);
    await streamWriter.route(enriched);

    return res.status(202).json({ accepted: true, traceId: enriched.traceId });
  });

  // ── Batch log ingestion ────────────────────────────────────────────────────

  router.post('/ingest/batch', async (req: Request, res: Response) => {
    const body = req.body;

    if (!Array.isArray(body)) {
      return res.status(422).json({ error: 'Batch endpoint expects a JSON array' });
    }

    const serviceNameOverride = req.headers['x-service-name'] as string | undefined;
    const results = await Promise.allSettled(
      body.map(async (raw: unknown) => {
        const validationError = validateRawEntry(raw);
        if (validationError) {
          await streamWriter.writeToDLQ(JSON.stringify(raw));
          return { accepted: false, error: validationError };
        }
        const enriched = enrichLogEntry(raw as RawLogEntry, serviceNameOverride);
        await streamWriter.route(enriched);
        return { accepted: true, traceId: enriched.traceId };
      }),
    );

    const summary = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { accepted: false, error: String(r.reason) },
    );

    const accepted = summary.filter((s) => s.accepted).length;
    const rejected = summary.length - accepted;

    return res.status(202).json({ total: body.length, accepted, rejected, results: summary });
  });

  return router;
}
