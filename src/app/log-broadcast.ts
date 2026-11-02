/**
 * Live-log broadcast for the /logs web UI.
 *
 * Wraps the pino logger's level methods and pushes redacted entries to a
 * ring buffer plus any subscribers (SSE clients of GET /v1/logs).
 * Entries leave this module already redacted; keep it that way.
 */

import type pino from 'pino';
import { redactValue, redactString } from './log-redact.js';

export interface LogEntry {
  seq: number;
  time: string;
  level: string;
  msg: string;
  fields?: Record<string, unknown>;
}

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LEVELS)[number];
export const LOG_LEVELS = LEVELS;

const RING_SIZE = 500;
const ring: LogEntry[] = [];
let seq = 0;
const subscribers = new Set<(entry: LogEntry) => void>();

export function subscribe(fn: (entry: LogEntry) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function recentEntries(max = 250): LogEntry[] {
  return ring.slice(-max);
}

function toEntry(level: string, args: unknown[]): LogEntry {
  let msg = '';
  const fields: Record<string, unknown> = {};
  for (const arg of args) {
    if (typeof arg === 'string') {
      msg += (msg ? ' ' : '') + arg;
    } else if (arg instanceof Error) {
      fields.error = { name: arg.name, message: redactString(arg.message) };
    } else {
      const value = redactValue(arg);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(fields, value);
      } else if (value !== undefined) {
        fields.value = value;
      }
    }
  }
  const entry: LogEntry = {
    seq: ++seq,
    time: new Date().toISOString(),
    level,
    msg,
  };
  if (Object.keys(fields).length > 0) entry.fields = fields;
  return entry;
}

function push(entry: LogEntry): void {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  for (const fn of [...subscribers]) {
    try {
      fn(entry);
    } catch {
      // Broken consumer: drop it so one dead tab cannot stall logging.
      subscribers.delete(fn);
    }
  }
}

// Level number → name per pino's default levels.
export function levelNumToName(num: number): string {
  const names: Record<number, string> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
  return names[num] ?? 'info';
}

/** Push one redacted entry into the ring buffer / to subscribers. */
export function broadcastEntry(level: string, args: unknown[]): void {
  push(toEntry(level, args));
}
