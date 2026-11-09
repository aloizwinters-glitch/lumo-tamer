import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

function walkUp(maxSteps: number, probe: (dir: string) => unknown): unknown {
  let dir = here;
  for (let i = 0; i < maxSteps; i++) {
    const hit = probe(dir);
    if (hit != null) return hit;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findVersion(): string {
  const found = walkUp(6, (dir) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'lumo-tamer') return pkg.version as string;
    } catch { /* try next */ }
    return null;
  });
  return (found as string) ?? 'unknown';
}

export interface BuildInfo {
  commit: string;
  builtAt: string;
}

function findBuildInfo(): BuildInfo | null {
  const found = walkUp(6, (dir) => {
    try {
      const info = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8'));
      if (typeof info?.commit === 'string' && typeof info?.builtAt === 'string') {
        return { commit: info.commit, builtAt: info.builtAt };
      }
    } catch { /* try next */ }
    return null;
  });
  return found as BuildInfo | null;
}

export const VERSION = findVersion();
export const BUILD_COMMIT = findBuildInfo()?.commit ?? 'unknown';
/** ISO timestamp of the last `npm run build`; null when no build-info.json exists. */
export const BUILD_AT = findBuildInfo()?.builtAt ?? null;

/** True when dist was rebuilt after this process started (restart to serve it). */
export function isBuildNewerThanProcess(): boolean {
  if (!BUILD_AT) return false;
  const startedAt = Date.now() - Math.round(process.uptime() * 1000);
  return new Date(BUILD_AT).getTime() > startedAt;
}
