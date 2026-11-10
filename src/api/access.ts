/**
 * Who may reach the server without a Bearer API key.
 *
 * The web UI (/config, /auth, /logs, restart, update) has no API key in the
 * browser. It is open only to requests that come from this machine and name
 * it in the Host header (blocks DNS rebinding). Anyone else must first
 * unlock it with the API key, which sets an HttpOnly session cookie.
 * State-changing UI requests also reject cross-site browsers (CSRF).
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";

export const UI_SESSION_COOKIE = "lumo_tamer_ui";
export const UI_SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** True for 127.0.0.0/8 and ::1 (IPv4-mapped included). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (LOOPBACK_ADDRESSES.has(address)) return true;
  const v4 = address.replace(/^::ffff:/i, "");
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** Hostname part of a Host header, lowercased, brackets kept for IPv6. */
export function hostnameOf(host: string | undefined): string {
  if (!host) return "";
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    isLoopbackAddress(hostname)
  );
}

/** Request from this machine that also addresses it by a loopback name. */
export function isLocalRequest(req: Request): boolean {
  return (
    isLoopbackAddress(req.socket?.remoteAddress) &&
    isLoopbackHostname(hostnameOf(req.headers.host))
  );
}

export function bearerKey(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : undefined;
}

export function hasValidBearer(req: Request, apiKey: string): boolean {
  const key = bearerKey(req);
  return key !== undefined && safeEqual(key, apiKey);
}

/** Cookie value derived from the API key, so the key itself never sits in a cookie. */
export function uiSessionToken(apiKey: string): string {
  return createHmac("sha256", apiKey)
    .update("lumo-tamer ui session v1")
    .digest("base64url");
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function hasValidUiSession(req: Request, apiKey: string): boolean {
  const value = readCookie(req, UI_SESSION_COOKIE);
  return value !== undefined && safeEqual(value, uiSessionToken(apiKey));
}

export function uiSessionCookie(apiKey: string, secure: boolean): string {
  return [
    `${UI_SESSION_COOKIE}=${uiSessionToken(apiKey)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${UI_SESSION_MAX_AGE_SEC}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Browser-made state changes must come from this server's own pages.
 * Bearer-authenticated API clients are not browsers and are not checked.
 */
export function isCrossSiteWrite(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  if (origin === "null") return true;
  try {
    return (
      new URL(origin).host.toLowerCase() !==
      (req.headers.host ?? "").toLowerCase()
    );
  } catch {
    return true;
  }
}

/** Only a same-origin path, so the unlock page cannot redirect elsewhere. */
export function safeNextPath(next: unknown): string {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return "/config";
  }
  return next;
}
