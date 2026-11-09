import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createConfigRouter } from '../../src/api/routes/config.js';

/**
 * The /config page embeds its UI as inline <script> blocks built from a TS
 * template literal. Template evaluation turns \n into a real newline, which
 * is a syntax error inside a single-quoted JS string once served (the import
 * report shipped broken this way). Compile every served block so a broken
 * page can never pass the suite again.
 */
describe('/config inline scripts', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ));
  });

  it('every script block parses as valid JavaScript', async () => {
    const app = express();
    app.use(express.json());
    app.use('/', createConfigRouter({ isAuthenticated: () => true } as never, {}));
    const server = app.listen(0) as Server;
    servers.push(server);
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');

    const res = await fetch(`http://127.0.0.1:${addr.port}/config`);
    const html = await res.text();
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    blocks.forEach((code, i) => {
      expect(() => new Function(code), `script block #${i}`).not.toThrow();
    });
  });
});
