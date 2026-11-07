/* Writes build-info.json (git commit + timestamp) next to package.json.
 * Read at runtime by src/app/version.ts; surfaces in /health and the UI
 * so you can see WHICH build a process runs — a process older than this
 * file predates the deployed dist and needs a restart. */
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

function shortCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return 'unknown'; // no git in the build context (tarball, some CI)
  }
}

const info = { commit: shortCommit(), builtAt: new Date().toISOString() };
writeFileSync(new URL('../build-info.json', import.meta.url), JSON.stringify(info, null, 2) + '\n');
console.log(`build-info: ${info.commit} @ ${info.builtAt}`);
