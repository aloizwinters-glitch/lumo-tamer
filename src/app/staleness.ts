/**
 * Staleness checks for self-respawn.
 *
 * Deployments that sync source code without rebuilding (rsync-style, git pull
 * on a running copy) leave dist/ older than src/. A respawning server must
 * detect that and rebuild first, or it keeps serving the previous build
 * indefinitely — the restart button would restart the same stale code.
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function mtimeOf(p: string): number {
    try {
        return statSync(p).mtimeMs;
    } catch {
        return 0;
    }
}

function newestMtime(dir: string, suffixes: string[], depth = 0): number {
    if (depth > 8) return 0;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    let newest = 0;
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            newest = Math.max(newest, newestMtime(full, suffixes, depth + 1));
        } else if (entry.isFile() && suffixes.some((s) => entry.name.endsWith(s))) {
            newest = Math.max(newest, mtimeOf(full));
        }
    }
    return newest;
}

/** True when package.json / package-lock.json changed after node_modules/. */
export function isInstallStale(root: string): boolean {
    const nodeModules = mtimeOf(join(root, 'node_modules'));
    if (nodeModules === 0) return true;
    return Math.max(
        mtimeOf(join(root, 'package.json')),
        mtimeOf(join(root, 'package-lock.json')),
    ) > nodeModules;
}

/** True when dist is missing or any source file under src is newer than the built entrypoint. */
export function isBuildStale(root: string): boolean {
    const distEntry = mtimeOf(join(root, 'dist', 'src', 'tamer.js'));
    if (distEntry === 0) return true;
    return newestMtime(join(root, 'src'), ['.ts', '.js']) > distEntry;
}
