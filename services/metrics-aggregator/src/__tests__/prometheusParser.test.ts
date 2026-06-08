import * as fc from 'fast-check';
import { parsePrometheusText } from '../prometheusParser';
import { MetricFamily } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const COUNTER_TEXT = `
# HELP http_requests_total The total number of HTTP requests.
# TYPE http_requests_total counter
http_requests_total{method="post",code="200"} 1027
http_requests_total{method="post",code="400"}  3
`.trim();

const GAUGE_TEXT = `
# HELP node_memory_MemFree_bytes Free memory in bytes.
# TYPE node_memory_MemFree_bytes gauge
node_memory_MemFree_bytes 1.234567e+08
`.trim();

const HISTOGRAM_TEXT = `
# HELP http_request_duration_seconds A histogram of the request duration.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.05"} 24054
http_request_duration_seconds_bucket{le="0.1"} 33444
http_request_duration_seconds_bucket{le="+Inf"} 144320
http_request_duration_seconds_sum 53423
http_request_duration_seconds_count 144320
`.trim();

// ── Example-based tests ───────────────────────────────────────────────────────

describe('PrometheusParser — counters', () => {
  it('parses counter metric family', () => {
    const families = parsePrometheusText(COUNTER_TEXT);
    expect(families).toHaveLength(1);
    const [family] = families;
    expect(family.name).toBe('http_requests_total');
    expect(family.type).toBe('counter');
    expect(family.samples).toHaveLength(2);
    expect(family.samples[0].value).toBe(1027);
    expect(family.samples[0].labels).toEqual({ method: 'post', code: '200' });
  });
});

describe('PrometheusParser — gauges', () => {
  it('parses gauge metric family', () => {
    const families = parsePrometheusText(GAUGE_TEXT);
    expect(families).toHaveLength(1);
    const [family] = families;
    expect(family.type).toBe('gauge');
    expect(family.samples[0].value).toBeCloseTo(1.234567e8);
  });
});

describe('PrometheusParser — histograms', () => {
  it('parses histogram metric family', () => {
    const families = parsePrometheusText(HISTOGRAM_TEXT);
    expect(families).toHaveLength(1);
    const [family] = families;
    expect(family.type).toBe('histogram');
    // _bucket, _sum, _count samples
    expect(family.samples.length).toBeGreaterThanOrEqual(3);
  });

  it('handles +Inf bucket label', () => {
    const families = parsePrometheusText(HISTOGRAM_TEXT);
    const infBucket = families[0].samples.find(
      (s) => s.labels['le'] === '+Inf',
    );
    expect(infBucket).toBeDefined();
    expect(infBucket!.value).toBe(144320);
  });
});

describe('PrometheusParser — empty input', () => {
  it('returns empty array for empty string', () => {
    expect(parsePrometheusText('')).toEqual([]);
  });

  it('returns empty array for comment-only input', () => {
    expect(parsePrometheusText('# just a comment\n# another comment')).toEqual([]);
  });
});

describe('PrometheusParser — label parsing', () => {
  it('handles metrics without labels', () => {
    const text = `# TYPE simple_gauge gauge\nsimple_gauge 42`;
    const families = parsePrometheusText(text);
    expect(families[0].samples[0].labels).toEqual({});
    expect(families[0].samples[0].value).toBe(42);
  });

  it('handles escaped quotes in label values', () => {
    const text = `# TYPE x counter\nx{msg="say \\"hello\\""} 1`;
    const families = parsePrometheusText(text);
    expect(families[0].samples[0].labels['msg']).toBe('say "hello"');
  });
});

// ── Property-based tests (Property 3) ─────────────────────────────────────────

describe('PrometheusParser — Property 3: parser completeness', () => {
  /**
   * Property 3: For any valid Prometheus text block containing counter, gauge,
   * or histogram metric families, the parser should produce a non-empty metric
   * family list where each entry has a name, type, and at least one sample.
   */

  const metricNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/).filter(
    (s) => !s.endsWith('_'),
  );
  const labelValueArb = fc.stringMatching(/^[a-zA-Z0-9_\-]{1,10}$/);

  const counterBlockArb = metricNameArb.chain((name) =>
    fc.integer({ min: 1, max: 5 }).map((n) => {
      const lines = [`# HELP ${name} A counter`, `# TYPE ${name} counter`];
      for (let i = 0; i < n; i++) {
        lines.push(`${name}{code="${200 + i}"} ${i * 100}`);
      }
      return lines.join('\n');
    }),
  );

  const gaugeBlockArb = metricNameArb.chain((name) =>
    fc.float({ min: 0, max: Math.fround(1e6), noNaN: true }).map((value) => {
      return [`# HELP ${name} A gauge`, `# TYPE ${name} gauge`, `${name} ${value}`].join('\n');
    }),
  );

  it('counter block always produces a non-empty family with name, type, samples', () => {
    fc.assert(
      fc.property(counterBlockArb, (text) => {
        const families = parsePrometheusText(text);
        expect(families.length).toBeGreaterThan(0);
        for (const f of families) {
          expect(f.name).toBeTruthy();
          expect(f.type).toBe('counter');
          expect(f.samples.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('gauge block always produces a non-empty family with name, type, samples', () => {
    fc.assert(
      fc.property(gaugeBlockArb, (text) => {
        const families = parsePrometheusText(text);
        expect(families.length).toBeGreaterThan(0);
        for (const f of families) {
          expect(typeof f.name).toBe('string');
          expect(f.samples.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
