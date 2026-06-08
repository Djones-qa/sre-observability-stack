import * as fc from 'fast-check';
import { TargetRegistry } from '../targetRegistry';
import { ScrapeTarget } from '../types';

// ── Mock Redis ────────────────────────────────────────────────────────────────

function makeMockRedis() {
  const store = new Map<string, string>();

  return {
    hset: jest.fn(async (key: string, field: string, value: string) => {
      store.set(`${key}:${field}`, value);
      return 1;
    }),
    hdel: jest.fn(async (key: string, field: string) => {
      const existed = store.has(`${key}:${field}`);
      store.delete(`${key}:${field}`);
      return existed ? 1 : 0;
    }),
    hgetall: jest.fn(async (key: string) => {
      const result: Record<string, string> = {};
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${key}:`)) {
          const field = k.slice(key.length + 1);
          result[field] = v;
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    }),
    hget: jest.fn(async (key: string, field: string) => {
      return store.get(`${key}:${field}`) ?? null;
    }),
    hlen: jest.fn(async (key: string) => {
      let count = 0;
      for (const k of store.keys()) {
        if (k.startsWith(`${key}:`)) count++;
      }
      return count;
    }),
    _store: store,
    _clear: () => store.clear(),
  };
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const targetArb = fc.record<ScrapeTarget>({
  id: fc.stringMatching(/^[a-z][a-z0-9-]{3,15}$/),
  url: fc.constantFrom(
    'http://service-a:9090/metrics',
    'http://service-b:9090/metrics',
    'http://localhost:8080/metrics',
  ),
  serviceName: fc.stringMatching(/^[a-z][a-z0-9-]{3,15}$/),
  scrapeIntervalSeconds: fc.integer({ min: 1, max: 300 }),
});

// ── Example-based tests ───────────────────────────────────────────────────────

describe('TargetRegistry — example tests', () => {
  let mockRedis: ReturnType<typeof makeMockRedis>;
  let registry: TargetRegistry;

  beforeEach(() => {
    mockRedis = makeMockRedis();
    registry = new TargetRegistry(mockRedis as unknown as import('ioredis').Redis);
  });

  it('registers a valid target', async () => {
    const target: ScrapeTarget = {
      id: 'svc-1',
      url: 'http://localhost:9090/metrics',
      serviceName: 'my-service',
      scrapeIntervalSeconds: 15,
    };
    const result = await registry.register(target);
    expect(result).toEqual(target);
    expect(mockRedis.hset).toHaveBeenCalledTimes(1);
  });

  it('deregisters an existing target', async () => {
    const target: ScrapeTarget = {
      id: 'svc-1',
      url: 'http://localhost:9090/metrics',
      serviceName: 'my-service',
      scrapeIntervalSeconds: 15,
    };
    await registry.register(target);
    const existed = await registry.deregister('svc-1');
    expect(existed).toBe(true);
  });

  it('returns false when deregistering non-existent target', async () => {
    const existed = await registry.deregister('does-not-exist');
    expect(existed).toBe(false);
  });

  it('throws on missing id', async () => {
    await expect(
      registry.register({ id: '', url: 'http://x/metrics', serviceName: 'x', scrapeIntervalSeconds: 10 }),
    ).rejects.toThrow('Missing required field: id');
  });

  it('throws on invalid URL', async () => {
    await expect(
      registry.register({ id: 'x', url: 'not-a-url', serviceName: 'x', scrapeIntervalSeconds: 10 }),
    ).rejects.toThrow('Invalid URL');
  });

  it('throws on zero scrapeIntervalSeconds', async () => {
    await expect(
      registry.register({ id: 'x', url: 'http://x/metrics', serviceName: 'x', scrapeIntervalSeconds: 0 }),
    ).rejects.toThrow('scrapeIntervalSeconds');
  });
});

// ── Property-based tests (Property 1 & 2) ─────────────────────────────────────

describe('TargetRegistry — Property 1: registration round-trip', () => {
  /**
   * Property 1: For any valid scrape target, registering it and listing all
   * targets should include that target with all fields preserved.
   */

  it('registered target appears in list with all fields', () => {
    fc.assert(
      fc.asyncProperty(targetArb, async (target) => {
        const mockRedis = makeMockRedis();
        const reg = new TargetRegistry(mockRedis as unknown as import('ioredis').Redis);

        await reg.register(target);
        const list = await reg.list();
        const found = list.find((t) => t.id === target.id);
        expect(found).toBeDefined();
        expect(found).toEqual(target);
      }),
      { numRuns: 100 },
    );
  });
});

describe('TargetRegistry — Property 2: invalid registration rejected', () => {
  /**
   * Property 2: For any target object with one or more required fields missing,
   * registration should throw and the target should not appear in the registry.
   */

  const missingFieldTargetArb = fc
    .record<Partial<ScrapeTarget>>({
      id: fc.option(fc.constant('svc-test'), { nil: undefined }),
      url: fc.option(fc.constant('http://x/metrics'), { nil: undefined }),
      serviceName: fc.option(fc.constant('test-svc'), { nil: undefined }),
      scrapeIntervalSeconds: fc.option(fc.constant(15), { nil: undefined }),
    })
    .filter(
      (t) =>
        t.id === undefined ||
        t.url === undefined ||
        t.serviceName === undefined ||
        t.scrapeIntervalSeconds === undefined,
    );

  it('always throws for incomplete targets', () => {
    fc.assert(
      fc.asyncProperty(missingFieldTargetArb, async (partial) => {
        const mockRedis = makeMockRedis();
        const reg = new TargetRegistry(mockRedis as unknown as import('ioredis').Redis);

        await expect(
          reg.register(partial as ScrapeTarget),
        ).rejects.toThrow();

        const list = await reg.list();
        expect(list).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
