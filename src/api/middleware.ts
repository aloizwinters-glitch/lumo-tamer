import { Router, type Request, type RequestHandler } from 'express';
import { logger } from '../app/logger.js';
import { getMetrics, type MetricsService } from '../app/metrics.js';
import { AUTH } from '../app/const.js';
import { clientIp, createAttemptGate } from './attempt-limit.js';
import {
  hasValidBearer,
  hasValidUiSession,
  isCrossSiteWrite,
  isLocalRequest,
  safeEqual,
  safeNextPath,
  uiSessionCookie,
} from './access.js';

function isOpenUiPath(path: string): boolean {
  return (
    path === '/health'
    || path === '/metrics'
    || path === '/auth'
    || path.startsWith('/auth/')
    || path === '/config'
    || path === '/v1/config'
    || path === '/v1/config/export'
    || path === '/v1/config/import'
    || path === '/v1/restart'
    || path === '/v1/update'
    || path === '/logs'
    || path === '/v1/logs'
  );
}

function authUrlFromRequest(req: { protocol?: string; get?: (h: string) => string | undefined }): string {
  const host = req.get?.('host');
  if (!host) return '/auth';
  const proto = req.protocol || 'http';
  return `${proto}://${host}/auth`;
}

function wantsHtml(req: Request): boolean {
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
}

/**
 * API routes need the Bearer key. UI routes (/config, /auth, /logs, /health,
 * /metrics, restart, update) are open from this machine only, or to a browser
 * unlocked with the API key at /ui-login. See ./access.ts.
 */
export function setupAuthMiddleware(apiKey: string): RequestHandler {
  return (req, res, next) => {
    if (req.path === UI_LOGIN_PATH) {
      if (isCrossSiteWrite(req)) {
        return res.status(403).json({ error: 'Cross-site request blocked' });
      }
      return next();
    }

    if (hasValidBearer(req, apiKey)) {
      return next();
    }

    if (isOpenUiPath(req.path)) {
      if (isLocalRequest(req) || hasValidUiSession(req, apiKey)) {
        if (isCrossSiteWrite(req)) {
          logger.warn({ path: req.path, origin: req.headers.origin }, 'Blocked cross-site request to the web UI');
          return res.status(403).json({ error: 'Cross-site request blocked' });
        }
        return next();
      }
      getMetrics()?.authFailuresTotal.inc();
      if (wantsHtml(req)) {
        return res.redirect(302, `${UI_LOGIN_PATH}?next=${encodeURIComponent(req.originalUrl)}`);
      }
      return res.status(401).json({
        error: `This page only opens from this machine. From another device, unlock it with the API key at ${UI_LOGIN_PATH}.`,
      });
    }

    getMetrics()?.authFailuresTotal.inc();
    return res.status(401).json({ error: 'Invalid API key' });
  };
}

const UI_LOGIN_PATH = '/ui-login';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function uiLoginPage(next: string, error?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unlock lumo-tamer</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
form { width: 100%; max-width: 22rem; display: grid; gap: 0.75rem; }
h1 { font-size: 1.25rem; margin: 0; }
p { margin: 0; opacity: 0.8; font-size: 0.9rem; }
input, button { font: inherit; padding: 0.6rem 0.75rem; border-radius: 6px; }
.err { color: #d33; opacity: 1; }
</style></head>
<body><form method="post" action="${UI_LOGIN_PATH}">
<h1>Unlock lumo-tamer</h1>
<p>This page is only open from the machine running lumo-tamer. Enter the server API key to use it from this device.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
<input type="password" name="key" autocomplete="current-password" placeholder="API key" required autofocus>
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit">Unlock</button>
</form></body></html>`;
}

/** GET shows the unlock form; POST checks the API key and sets the UI session cookie. */
export function createUiLoginRouter(apiKey: string): Router {
  const router = Router();
  const allowAttempt = createAttemptGate(AUTH.LOGIN_MAX_ATTEMPTS);

  router.get(UI_LOGIN_PATH, (req, res) => {
    res.type('html').send(uiLoginPage(safeNextPath(req.query.next)));
  });

  router.post(UI_LOGIN_PATH, (req, res) => {
    const next = safeNextPath(req.body?.next);
    if (!allowAttempt(clientIp(req))) {
      res.status(429).type('html').send(uiLoginPage(next, 'Too many attempts. Wait a few minutes.'));
      return;
    }
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!safeEqual(key, apiKey)) {
      logger.warn({ ip: clientIp(req) }, 'Wrong API key on the web UI unlock page');
      res.status(401).type('html').send(uiLoginPage(next, 'Wrong API key.'));
      return;
    }
    res.setHeader('Set-Cookie', uiSessionCookie(apiKey, req.secure));
    res.redirect(303, next);
  });

  return router;
}

export function setupReadyMiddleware(isReady: () => boolean): RequestHandler {
  return (req, res, next) => {
    if (isOpenUiPath(req.path) || req.path === UI_LOGIN_PATH || req.path === '/v1/models' || req.path === '/v1/restart' || req.path === '/v1/update' || req.path.startsWith('/v1/models/')) {
      return next();
    }
    if (isReady()) {
      return next();
    }
    return res.status(503).json({
      error: {
        message: `Not authenticated. Open ${authUrlFromRequest(req)} in your browser and log in to Proton.`,
        type: 'auth_required',
      },
    });
  };
}

export function setupLoggingMiddleware(): RequestHandler {
  return (req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  };
}

// Normalize paths to base endpoints for consistent labeling
function normalizeEndpoint(path: string): string {
  if (path.startsWith('/v1/responses')) return '/v1/responses';
  if (path.startsWith('/v1/chat/completions')) return '/v1/chat/completions';
  if (path.startsWith('/v1/models')) return '/v1/models';
  if (path.startsWith('/v1/auth')) return '/v1/auth';
  return path;
}

// Metrics middleware for request tracking
export function setupMetricsMiddleware(metrics: MetricsService): RequestHandler {
  return (req, res, next) => {
    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const endpoint = normalizeEndpoint(req.path);
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;

      // Determine streaming from request body (if available)
      const streaming = req.body?.stream === true ? 'true' : 'false';

      metrics.httpRequestsTotal.inc({
        endpoint,
        method: req.method,
        status: res.statusCode.toString(),
        streaming,
      });

      metrics.httpRequestDuration.observe(
        { endpoint, method: req.method },
        duration
      );
    });

    next();
  };
}

