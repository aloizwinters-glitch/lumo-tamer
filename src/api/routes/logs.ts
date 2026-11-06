/**
 * Live log broadcast for the /logs web UI.
 *
 * GET  /logs      - HTML page
 * GET  /v1/logs   - SSE stream (text/event-stream)
 */

import { Router } from 'express';
import { subscribe, recentEntries, type LogEntry, LOG_LEVELS } from '../../app/log-broadcast.js';
import { htmlPage } from '../web-ui.js';
import { VERSION } from '../../app/version.js';
import { redactString } from '../../app/log-redact.js';

export function createLogsRouter() {
  const router = Router();

  // SSE endpoint: /v1/logs
  router.get('/v1/logs', (req, res) => {
    const levelFilter = (req.query.level as string)?.toLowerCase();
    if (levelFilter && !LOG_LEVELS.includes(levelFilter as any)) {
      return res.status(400).send('Invalid level. Allowed: ' + LOG_LEVELS.join(', '));
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send recent entries first
    for (const entry of recentEntries()) {
      if (levelFilter && entry.level !== levelFilter) continue;
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    // Keep alive ping every 25s
    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    const cleanup = (entry: LogEntry) => {
      if (levelFilter && entry.level !== levelFilter) return;
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    const unsubscribe = subscribe(cleanup);

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });

    req.on('error', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // HTML page: /logs
  router.get('/logs', (_req, res) => {
    const extraCss = `
      .log-pane {
        display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 0.75rem;
        height: calc(100vh - 12rem);
      }
      .log-toolbar {
        display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;
        padding: 0.7rem 0.9rem; background: var(--card); border: 1px solid var(--line);
        border-radius: var(--radius); box-shadow: var(--shadow);
      }
      .log-toolbar select, .log-toolbar input[type=text] {
        padding: 0.45rem 0.6rem; border-radius: 8px; border: 1px solid var(--line);
        background: var(--input); color: inherit; font: inherit; font-size: 0.82rem;
      }
      .log-toolbar button {
        height: 2rem; padding: 0 0.7rem; font-size: 0.82rem;
      }
      .log-feed {
        background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
        box-shadow: var(--shadow); overflow-y: auto; padding: 0.7rem; min-height: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem;
      }
      .log-entry {
        display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 0.8rem;
        padding: 0.35rem 0; border-bottom: 1px dashed var(--line);
      }
      .log-entry:last-child { border-bottom: 0; }
      .log-meta { color: var(--muted); white-space: nowrap; }
      .log-level { font-weight: 700; min-width: 3.2rem; }
      .log-level.trace { color: var(--muted); }
      .log-level.debug { color: var(--muted); }
      .log-level.info { color: var(--ok); }
      .log-level.warn { color: var(--warn); }
      .log-level.error { color: var(--err); }
      .log-level.fatal { color: var(--err); font-weight: 900; }
      .log-msg { color: var(--text); word-break: break-word; }
      .log-fields { grid-column: 2; margin-top: 0.2rem; color: var(--muted); font-size: 0.72rem; }
      .log-fields pre { margin: 0.3rem 0 0; white-space: pre-wrap; word-break: break-word; }
      .paused-overlay {
        position: fixed; bottom: 1.5rem; right: 1.5rem; padding: 0.6rem 0.9rem;
        background: var(--warn); color: #fff; border-radius: 999px; font-weight: 600;
        box-shadow: var(--shadow); display: none;
      }
      .paused .paused-overlay { display: block; }
    `;

    const body = `
      <div class="log-pane">
        <div class="log-toolbar">
          <select id="levelFilter">
            <option value="">All levels</option>
            ${LOG_LEVELS.map(l => `<option value="${l}">${l.toUpperCase()}</option>`).join('')}
          </select>
          <input type="text" id="searchBox" placeholder="Search text…" style="min-width: 12rem;">
          <button id="pauseBtn">Pause</button>
          <button id="clearBtn" class="secondary">Clear</button>
          <button id="scrollBtn" class="secondary">Auto-scroll</button>
          <span class="hint muted" style="margin-left:auto;">Live feed from lumo-tamer</span>
        </div>
        <div class="log-feed" id="feed"></div>
      </div>
      <div class="paused-overlay" id="pausedOverlay">Paused</div>
      <script>
        (function(){
          const feed = document.getElementById('feed');
          function esc(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
          }
          const levelFilter = document.getElementById('levelFilter');
          const searchBox = document.getElementById('searchBox');
          const pauseBtn = document.getElementById('pauseBtn');
          const clearBtn = document.getElementById('clearBtn');
          const scrollBtn = document.getElementById('scrollBtn');
          const pausedOverlay = document.getElementById('pausedOverlay');
          let paused = false;
          let autoScroll = true;
          let es = null;
          let filtered = [];

          function renderEntry(e) {
            const div = document.createElement('div');
            div.className = 'log-entry';
            const time = new Date(e.time).toLocaleTimeString();
            let fieldsHtml = '';
            if (e.fields) {
              fieldsHtml = '<div class="log-fields"><pre>' + esc(JSON.stringify(e.fields, null, 2)) + '</pre></div>';
            }
            div.innerHTML = '<div class="log-meta"><span class="log-level log-level-' + e.level + '">' + e.level.toUpperCase() + '</span> ' + time + '</div><div class="log-msg">' + esc(e.msg || '') + '</div>' + fieldsHtml;
            return div;
          }

          function applyFilters() {
            const lvl = levelFilter.value;
            const txt = searchBox.value.toLowerCase();
            const nodes = Array.from(feed.children);
            for (const node of nodes) {
              const msg = node.querySelector('.log-msg').textContent.toLowerCase();
              const lvlVal = node.querySelector('.log-level').textContent.toLowerCase();
              const show = (!lvl || lvlVal === lvl) && (!txt || msg.includes(txt));
              node.style.display = show ? '' : 'none';
            }
          }

          function appendEntry(e) {
            const el = renderEntry(e);
            feed.appendChild(el);
            if (autoScroll && !paused) feed.scrollTop = feed.scrollHeight;
          }

          function connect() {
            if (es) { es.close(); es = null; }
            const url = '/v1/logs' + (levelFilter.value ? '?level=' + encodeURIComponent(levelFilter.value) : '');
            es = new EventSource(url);
            es.onmessage = (ev) => {
              try {
                const e = JSON.parse(ev.data);
                if (paused) return;
                appendEntry(e);
              } catch {}
            };
            es.onerror = () => {
              setTimeout(connect, 2000);
            };
          }

          pauseBtn.addEventListener('click', () => {
            paused = !paused;
            pauseBtn.textContent = paused ? 'Resume' : 'Pause';
            pausedOverlay.style.display = paused ? 'block' : 'none';
            if (!paused && autoScroll) feed.scrollTop = feed.scrollHeight;
          });

          clearBtn.addEventListener('click', () => {
            feed.innerHTML = '';
          });

          scrollBtn.addEventListener('click', () => {
            autoScroll = !autoScroll;
            scrollBtn.textContent = autoScroll ? 'Auto-scroll' : 'Manual';
            scrollBtn.classList.toggle('secondary', !autoScroll);
            if (autoScroll && !paused) feed.scrollTop = feed.scrollHeight;
          });

          levelFilter.addEventListener('change', applyFilters);
          searchBox.addEventListener('input', applyFilters);

          connect();
        })();
      </script>
    `;

    res.send(htmlPage({
      title: 'Live Logs — lumo-tamer',
      body,
      page: 'logs',
      wide: true,
      version: VERSION,
      extraCss,
    }));
  });

  return router;
}
