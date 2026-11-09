import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, readdirSync, lstatSync, realpathSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeVault } from '../../src/auth/vault/vault.js';
import { clearKeyCache } from '../../src/auth/vault/key-provider.js';

/**
 * Shared-vault regression: slot homes commonly symlink sessions/vault.enc to
 * a master copy (dev-opencode.sh slot pool). The atomic write must follow the
 * symlink instead of replacing it — otherwise the login lands in the slot and
 * every restart loses the session.
 */
describe('writeVault across symlinks', () => {
  const dirs: string[] = [];

  afterEach(() => {
    clearKeyCache();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'lumo-vault-symlink-'));
    dirs.push(dir);
    return dir;
  }

  function keyConfigFor(dir: string) {
    const keyFile = join(dir, 'vault-key');
    writeFileSync(keyFile, Buffer.alloc(32, 1), { mode: 0o600 });
    return {
      keychain: { service: 'lumo-tamer-test-no-such-service', account: 'vault-key' },
      keyFilePath: keyFile,
    };
  }

  it('follows a symlink instead of replacing it (shared vault)', async () => {
    const dir = scratch();
    const masterSessions = join(dir, 'master', 'sessions');
    const slotSessions = join(dir, 'slot', 'sessions');
    mkdirSync(masterSessions, { recursive: true });
    mkdirSync(slotSessions, { recursive: true });
    const masterVault = join(masterSessions, 'vault.enc');
    writeFileSync(masterVault, Buffer.from('stale'));
    const slotVault = join(slotSessions, 'vault.enc');
    symlinkSync(masterVault, slotVault);

    await writeVault(slotVault, { accessToken: 'tok-1' } as never, keyConfigFor(dir));

    expect(lstatSync(slotVault).isSymbolicLink()).toBe(true);
    expect(realpathSync(slotVault)).toBe(realpathSync(masterVault));
    expect(readFileSync(masterVault).length).toBeGreaterThan(0);
    expect(readFileSync(masterVault)).not.toEqual(Buffer.from('stale'));
    expect(readdirSync(slotSessions)).toEqual(['vault.enc']);
  });

  it('still writes a plain file when no symlink is involved', async () => {
    const dir = scratch();
    const sessionsDir = join(dir, 'sessions');
    mkdirSync(sessionsDir);
    const vaultPath = join(sessionsDir, 'vault.enc');

    await writeVault(vaultPath, { accessToken: 'tok-2' } as never, keyConfigFor(dir));

    expect(lstatSync(vaultPath).isFile()).toBe(true);
    expect(readFileSync(vaultPath).length).toBeGreaterThan(0);
    expect(readdirSync(sessionsDir)).toEqual(['vault.enc']);
  });
});
