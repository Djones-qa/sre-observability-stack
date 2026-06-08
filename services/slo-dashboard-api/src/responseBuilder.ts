import { SloResponse } from './types';

/**
 * Wrap data in a standard SloResponse envelope.
 * @param data             The payload to wrap.
 * @param rollupComputedAt ISO-8601 timestamp of when the underlying rollup was computed.
 */
export function buildResponse<T>(data: T, rollupComputedAt: string): SloResponse<T> {
  return {
    data,
    calculatedAt: new Date().toISOString(),
    dataFreshness: Math.floor((Date.now() - new Date(rollupComputedAt).getTime()) / 1000),
  };
}
