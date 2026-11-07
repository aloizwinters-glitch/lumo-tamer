/**
 * Bare-process self-update via git.
 *
 * Docker deployments recreate a container; a bare `node dist/...` process
 * has no such machinery. When it runs from a CLEAN git checkout, the update
 * flow is: fetch the release tag, check it out, then restart — the respawn
 * staleness chain (src/api/server.ts) notices package.json/src newer than
 * node_modules/dist and rebuilds before serving again.
 *
 * A dirty or missing checkout is never touched: git checkout would fail or
 * clobber local edits. Those installs get an honest hint instead.
 */

import { spawn } from 'child_process';
import { logger } from './logger.js';
import { PROJECT_ROOT } from './paths.js';

export interface GitUpdateStatus {
  /** Inside a git worktree with git on PATH. */
  isGit: boolean;
  /** No modified tracked files (untracked files do not block a checkout). */
  clean: boolean;
  /** isGit && clean — Apply may use the git flow. */
  ok: boolean;
}

function git(args: string[], cwd = PROJECT_ROOT): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c; });
    child.stderr?.on('data', (c) => { stderr += c; });
    child.on('error', () => resolve({ code: -1, stdout, stderr: 'git not found' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Fast capability probe for the status chip (no throw, no checkout). */
export async function isGitUpdateable(cwd = PROJECT_ROOT): Promise<boolean> {
  const status = await gitUpdateStatus(cwd);
  return status.ok;
}

export async function gitUpdateStatus(cwd = PROJECT_ROOT): Promise<GitUpdateStatus> {
  const inside = await git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { isGit: false, clean: false, ok: false };
  }
  const dirty = await git(['status', '--porcelain', '--untracked-files=no'], cwd);
  if (dirty.code !== 0) {
    return { isGit: false, clean: false, ok: false };
  }
  const clean = dirty.stdout.trim() === '';
  return { isGit: true, clean, ok: clean };
}

/**
 * Fetch and check out a release tag (detached). Leaves the working tree on the
 * new code; the caller must restart the process so the respawn rebuild chain
 * picks it up. Throws on git failure — the caller converts that into a toast.
 */
export async function applyGitUpdate(tag: string, cwd = PROJECT_ROOT): Promise<void> {
  const fetched = await git(['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`, '--force'], cwd);
  if (fetched.code !== 0) {
    throw new Error(`git fetch failed for ${tag}: ${fetched.stderr.trim() || fetched.stdout.trim()}`);
  }
  const checkedOut = await git(['checkout', '--detach', tag], cwd);
  if (checkedOut.code !== 0) {
    throw new Error(`git checkout ${tag} failed: ${checkedOut.stderr.trim() || checkedOut.stdout.trim()}`);
  }
  logger.info({ tag, cwd }, 'Checked out release tag; restart will rebuild');
}
