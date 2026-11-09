import { describe, expect, it } from 'vitest';
import {
  buildConfigSnapshot,
  compareVersions,
  parseConfigSnapshot,
  planConfigImport,
} from '../../src/app/config-transfer.js';

const DEFAULTS = {
  server: { enableWebSearch: false, apiKey: 'placeholder', port: 3003, tags: [] },
  updates: { githubToken: '' },
};

const SECRETS = new Set(['server.apiKey', 'updates.githubToken']);

describe('compareVersions', () => {
  it('orders semver with dev prereleases below their release', () => {
    expect(compareVersions('0.7.0-dev.9', '0.7.0')).toBe(-1);
    expect(compareVersions('0.7.0-dev.3', '0.7.0-dev.10')).toBe(-1);
    expect(compareVersions('0.7.0', '0.7.0-dev.10')).toBe(1);
    expect(compareVersions('0.7.1', '0.7.0')).toBe(1);
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('unknown', 'unknown')).toBe(0);
  });
});

describe('buildConfigSnapshot', () => {
  it('captures overrides only, secrets behind opt-in', () => {
    const user = {
      server: { enableWebSearch: true, apiKey: 'sk-real', port: 3003 },
      updates: { githubToken: 'ghp_abc' },
    };
    const without = buildConfigSnapshot(DEFAULTS, user, '1.0.0', false, SECRETS);
    expect(without.changes).toEqual({ 'server.enableWebSearch': true });
    expect(without.$format).toBe('lumo-tamer-config');
    expect(without.version).toBe('1.0.0');

    const withSecrets = buildConfigSnapshot(DEFAULTS, user, '1.0.0', true, SECRETS);
    expect(withSecrets.changes['server.apiKey']).toBe('sk-real');
    expect(withSecrets.changes['updates.githubToken']).toBe('ghp_abc');
  });

  it('skips secrets whose user value equals the default placeholder', () => {
    const user = { server: { apiKey: 'placeholder', enableWebSearch: true } };
    const snap = buildConfigSnapshot(DEFAULTS, user, '1.0.0', true, SECRETS);
    expect(snap.changes['server.apiKey']).toBeUndefined();
  });
});

describe('parseConfigSnapshot', () => {
  it('rejects malformed payloads with clear messages', () => {
    expect(() => parseConfigSnapshot('{oops')).toThrow(/JSON/i);
    expect(() => parseConfigSnapshot('[]')).toThrow(/object/i);
    expect(() => parseConfigSnapshot('{}')).toThrow(/format/i);
    expect(() => parseConfigSnapshot('{"$format":"lumo-tamer-config"}')).toThrow(/changes/i);
    expect(() => parseConfigSnapshot('{"$format":"lumo-tamer-config","changes":{},"version":""}')).toThrow(/version/i);
  });

  it('accepts a well-formed snapshot', () => {
    const snap = parseConfigSnapshot(
      '{"$format":"lumo-tamer-config","version":"0.7.0","exportedAt":"x","changes":{"server.port":3030}}',
    );
    expect(snap.changes['server.port']).toBe(3030);
  });
});

describe('planConfigImport', () => {
  it('imports known paths, coerces types, drops unknown ones', () => {
    const snap = parseConfigSnapshot(JSON.stringify({
      $format: 'lumo-tamer-config',
      version: '0.7.0',
      exportedAt: 'x',
      changes: {
        'server.enableWebSearch': 'true',
        'server.port': 'not-a-number',
        'server.goneForever': 1,
      },
    }));
    const user = { server: { enableWebSearch: true, port: 3003 } };
    const { edits, report } = planConfigImport(snap, DEFAULTS, '0.7.0', user, SECRETS);
    expect(edits.changes['server.enableWebSearch']).toBe(true);
    expect(report.imported).toContain('server.enableWebSearch');
    expect(report.dropped).toContain('server.goneForever');
    expect(report.warnings.some((w) => w.includes('server.port'))).toBe(true);
  });

  it('reports overwrites and no-ops per path', () => {
    const snap = parseConfigSnapshot(JSON.stringify({
      $format: 'lumo-tamer-config',
      version: '0.7.0',
      exportedAt: 'x',
      changes: {
        'server.enableWebSearch': true,   // already true locally -> no-op
        'server.port': 3030,               // differs locally -> overwrite
      },
    }));
    const user = { server: { enableWebSearch: true, port: 3003 } };
    const { report } = planConfigImport(snap, DEFAULTS, '0.7.0', user, SECRETS);
    expect(report.unchanged).toEqual(['server.enableWebSearch']);
    expect(report.overwrites).toEqual([
      { path: 'server.port', from: 3003, to: 3030 },
    ]);
  });

  it('marks settings that only differ from the default as new, not overwrites', () => {
    const snap = parseConfigSnapshot(JSON.stringify({
      $format: 'lumo-tamer-config',
      version: '0.7.0',
      exportedAt: 'x',
      changes: { 'server.port': 3030 },
    }));
    const { report } = planConfigImport(snap, DEFAULTS, '0.7.0', {}, SECRETS);
    expect(report.overwrites).toEqual([
      { path: 'server.port', from: undefined, to: 3030 },
    ]);
  });

  it('applies migrations from older snapshots only', () => {
    const snap = parseConfigSnapshot(JSON.stringify({
      $format: 'lumo-tamer-config',
      version: '0.6.0',
      exportedAt: 'x',
      changes: { 'server.webSearch': true, 'server.enableWebSearch': false },
    }));
    const migrations = [{ since: '0.7.0', renames: { 'server.webSearch': 'server.enableWebSearch' } }];
    const { edits, report } = planConfigImport(snap, DEFAULTS, '0.7.0', {}, SECRETS, migrations);
    expect(report.migrated).toEqual([{ from: 'server.webSearch', to: 'server.enableWebSearch' }]);
    // explicit newer key wins over the migrated one
    expect(edits.changes['server.enableWebSearch']).toBe(false);
  });

  it('skips empty secrets and warns about newer snapshots', () => {
    const snap = parseConfigSnapshot(JSON.stringify({
      $format: 'lumo-tamer-config',
      version: '9.9.9',
      exportedAt: 'x',
      changes: { 'updates.githubToken': '' },
    }));
    const { edits, report } = planConfigImport(snap, DEFAULTS, '0.7.0', {}, SECRETS);
    expect(edits.changes).toEqual({});
    expect(report.warnings.some((w) => w.includes('githubToken'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('newer version'))).toBe(true);
  });
});
