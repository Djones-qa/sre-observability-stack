import { MetricFamily, MetricSample, MetricType } from './types';

/**
 * Parse Prometheus text exposition format into MetricFamily objects.
 * Supports counter, gauge, histogram, summary, and untyped metric families.
 */
export function parsePrometheusText(text: string): MetricFamily[] {
  const families = new Map<string, MetricFamily>();
  const lines = text.split('\n');

  let currentHelp = '';
  let currentType: MetricType = 'untyped';
  let currentName = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      if (line.startsWith('# HELP ')) {
        const rest = line.slice(7);
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx === -1) {
          currentName = rest;
          currentHelp = '';
        } else {
          currentName = rest.slice(0, spaceIdx);
          currentHelp = rest.slice(spaceIdx + 1);
        }
        if (!families.has(currentName)) {
          families.set(currentName, {
            name: currentName,
            help: currentHelp,
            type: 'untyped',
            samples: [],
          });
        } else {
          // Update help text
          families.get(currentName)!.help = currentHelp;
        }
      } else if (line.startsWith('# TYPE ')) {
        const rest = line.slice(7);
        const parts = rest.split(/\s+/);
        if (parts.length >= 2) {
          currentName = parts[0];
          currentType = parts[1] as MetricType;
          if (!families.has(currentName)) {
            families.set(currentName, {
              name: currentName,
              help: '',
              type: currentType,
              samples: [],
            });
          } else {
            families.get(currentName)!.type = currentType;
          }
        }
      }
      continue;
    }

    // Metric sample line: name{labels} value [timestamp]
    const sample = parseSampleLine(line);
    if (!sample) continue;

    // Determine the family name for this sample
    const familyName = resolveFamilyName(sample.name, families);
    if (!families.has(familyName)) {
      families.set(familyName, {
        name: familyName,
        help: '',
        type: 'untyped',
        samples: [],
      });
    }
    families.get(familyName)!.samples.push(sample);
  }

  return Array.from(families.values()).filter((f) => f.samples.length > 0);
}

function parseSampleLine(line: string): MetricSample | null {
  // Format: metric_name{label="value",...} value [timestamp]
  // Or:     metric_name value [timestamp]
  const braceOpen = line.indexOf('{');
  const braceClose = line.indexOf('}');

  let name: string;
  let labels: Record<string, string> = {};
  let rest: string;

  if (braceOpen !== -1 && braceClose !== -1) {
    name = line.slice(0, braceOpen).trim();
    const labelStr = line.slice(braceOpen + 1, braceClose);
    labels = parseLabels(labelStr);
    rest = line.slice(braceClose + 1).trim();
  } else {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) return null;
    name = line.slice(0, spaceIdx).trim();
    rest = line.slice(spaceIdx + 1).trim();
  }

  if (!name) return null;

  const parts = rest.split(/\s+/);
  if (parts.length === 0) return null;

  const valueStr = parts[0];
  let value: number;

  if (valueStr === '+Inf' || valueStr === 'Inf') {
    value = Infinity;
  } else if (valueStr === '-Inf') {
    value = -Infinity;
  } else if (valueStr === 'NaN') {
    value = NaN;
  } else {
    value = parseFloat(valueStr);
    if (isNaN(value)) return null;
  }

  const sample: MetricSample = { name, labels, value };
  if (parts.length >= 2) {
    const ts = parseInt(parts[1], 10);
    if (!isNaN(ts)) sample.timestamp = ts;
  }

  return sample;
}

function parseLabels(labelStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!labelStr.trim()) return labels;

  // Regex to match key="value" pairs, handling escaped quotes
  const regex = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(labelStr)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

/**
 * Given a sample name, find the best matching family name.
 * Histogram samples end in _bucket, _count, _sum.
 * Summary samples end in _count, _sum.
 */
function resolveFamilyName(
  sampleName: string,
  families: Map<string, MetricFamily>,
): string {
  if (families.has(sampleName)) return sampleName;

  const suffixes = ['_bucket', '_count', '_sum', '_total', '_created'];
  for (const suffix of suffixes) {
    if (sampleName.endsWith(suffix)) {
      const base = sampleName.slice(0, sampleName.length - suffix.length);
      if (families.has(base)) return base;
    }
  }

  return sampleName;
}
