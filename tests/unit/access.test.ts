import { describe, it, expect } from 'vitest';
import { hostnameOf, isLoopbackAddress, isLoopbackHostname, safeNextPath } from '../../src/api/access.js';
import { contentForLog } from '../../src/app/log-content.js';

describe('access helpers', () => {
  it('recognises loopback addresses only', () => {
    for (const a of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a), a).toBe(true);
    for (const a of ['192.168.1.20', '10.0.0.1', '172.17.0.1', '::ffff:192.168.1.2', '', undefined]) expect(isLoopbackAddress(a), String(a)).toBe(false);
  });

  it('parses Host headers', () => {
    expect(hostnameOf('LocalHost:3003')).toBe('localhost');
    expect(hostnameOf('[::1]:3003')).toBe('[::1]');
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('localhost.evil.example')).toBe(false);
    expect(isLoopbackHostname('127.0.0.1.nip.io')).toBe(false);
  });

  it('keeps unlock redirects on this server', () => {
    expect(safeNextPath('/logs')).toBe('/logs');
    expect(safeNextPath('//evil.example')).toBe('/config');
    expect(safeNextPath('https://evil.example')).toBe('/config');
    expect(safeNextPath(undefined)).toBe('/config');
  });
});

describe('contentForLog', () => {
  it('hides conversation content unless log.messageContent is on', () => {
    // No config loaded in unit tests: treated as messageContent=false.
    expect(contentForLog('my secret prompt')).toBe('[hidden: 16 chars]');
    expect(contentForLog({ query: 'weather in Paris' })).toMatch(/^\[hidden: \d+ chars\]$/);
  });
});
