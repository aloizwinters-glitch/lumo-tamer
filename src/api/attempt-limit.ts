import type { Request } from "express";
import { AUTH } from "../app/const.js";

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Sliding window: first hit opens a window; further hits count until max. */
export interface AttemptGate {
  /** Counts the request against the limit. */
  allow: (ip: string) => boolean;
  /** Clears the count after a legitimate success, so only failures accumulate. */
  success: (ip: string) => void;
}

export function createAttemptGate(
  maxAttempts: number,
  windowMs = AUTH.ATTEMPT_WINDOW_MS,
): AttemptGate {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return {
    allow: (ip: string): boolean => {
      const now = Date.now();
      const cur = attempts.get(ip);
      if (!cur || now > cur.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (cur.count >= maxAttempts) return false;
      cur.count += 1;
      return true;
    },
    success: (ip: string): void => {
      attempts.delete(ip);
    },
  };
}
