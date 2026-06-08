import { SeverityLevel } from './types';

const SEVERITY_MAP: Record<string, SeverityLevel> = {
  trace: 'debug',
  verbose: 'debug',
  debug: 'debug',
  info: 'info',
  information: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  emerg: 'fatal',
  alert: 'fatal',
  // Numeric syslog-style levels (0=emerg..7=debug)
  '0': 'fatal',
  '1': 'fatal',
  '2': 'fatal',
  '3': 'error',
  '4': 'warn',
  '5': 'info',
  '6': 'info',
  '7': 'debug',
};

/**
 * Normalise any severity string to one of: debug | info | warn | error | fatal.
 * Always returns a valid SeverityLevel — never throws.
 */
export function normaliseSeverity(input: unknown): SeverityLevel {
  if (input === null || input === undefined || input === '') {
    return 'info';
  }
  const str = String(input).toLowerCase().trim();
  return SEVERITY_MAP[str] ?? 'info';
}
