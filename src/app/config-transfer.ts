/**
 * Config export/import: portable JSON snapshots of user overrides.
 *
 * A snapshot captures every field that differs from the defaults, shaped like
 * ConfigEdits.changes so imports run through the same validation pipeline as
 * the /config form (planEdits -> coerceFieldValue -> applyEditsToDocument).
 * Import merges: paths absent from the snapshot keep their local values.
 */

import {
  coerceFieldValue,
  getAt,
  isPlainObject,
  sameValue,
  walkConfigFields,
} from './config-editor.js';

export const CONFIG_EXPORT_FORMAT = 'lumo-tamer-config';

/** Forward migrations, oldest first. Applied when the snapshot predates
 * `since`. Extend as paths get renamed. */
const CONFIG_MIGRATIONS: ReadonlyArray<{
  since: string;
  renames: Record<string, string>;
}> = [];

export interface ConfigSnapshot {
  $format: string;
  version: string;
  exportedAt: string;
  changes: Record<string, unknown>;
}

export interface ImportEntry {
  path: string;
  /** Value currently set locally; undefined = not set (falls back to default). */
  from: unknown;
  to: unknown;
}

export interface ImportReport {
  imported: string[];
  /** Paths whose local value changes: from !== to after coercion. */
  overwrites: ImportEntry[];
  /** Paths already holding the incoming value locally (no-ops). */
  unchanged: string[];
  migrated: Array<{ from: string; to: string }>;
  dropped: string[];
  warnings: string[];
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/;

function parseVersion(v: string): number[] {
  const m = VERSION_RE.exec(v.trim());
  if (!m) return [-1, 0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? Infinity)];
}

/** -1 | 0 | 1. A -dev.N prerelease sorts below its final release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Snapshot of every user override. includeSecrets requires the caller to
 * have loaded the raw user config; walkConfigFields never exposes them. */
export function buildConfigSnapshot(
  defaults: Record<string, unknown>,
  user: Record<string, unknown>,
  version: string,
  includeSecrets: boolean,
  secretPaths: Set<string>,
): ConfigSnapshot {
  const changes: Record<string, unknown> = {};
  for (const field of walkConfigFields(defaults, user)) {
    if (!field.overridden) continue;
    const value = getAt(user, field.path);
    if (value === undefined) continue;
    if (!includeSecrets && secretPaths.has(field.path)) continue;
    changes[field.path] = value;
  }
  return {
    $format: CONFIG_EXPORT_FORMAT,
    version,
    exportedAt: new Date().toISOString(),
    changes,
  };
}

/** Parse and validate a snapshot string. Throws Error with a user-facing
 * message on malformed JSON or wrong $format. */
export function parseConfigSnapshot(raw: string): ConfigSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Not valid JSON: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) throw new Error('Expected a JSON object.');
  if (parsed.$format !== CONFIG_EXPORT_FORMAT) {
    throw new Error(`Unknown format: expected "$${CONFIG_EXPORT_FORMAT}".`);
  }
  if (!isPlainObject(parsed.changes)) throw new Error('Missing "changes" object.');
  if (typeof parsed.version !== 'string' || !parsed.version) {
    throw new Error('Missing "version" field.');
  }
  return parsed as unknown as ConfigSnapshot;
}

/** Apply version migrations to a snapshot's changes (renames), then resolve
 * every path against the defaults. Unknown paths without a migration are
 * dropped (reported), values are type-checked via coerceFieldValue; a type
 * mismatch drops the path with a warning instead of failing the import. */
export function planConfigImport(
  snapshot: ConfigSnapshot,
  defaults: Record<string, unknown>,
  currentVersion: string,
  user: Record<string, unknown>,
  secretPaths: Set<string>,
  migrations: ReadonlyArray<{ since: string; renames: Record<string, string> }> = CONFIG_MIGRATIONS,
): { edits: { changes: Record<string, unknown>; resets: string[] }; report: ImportReport } {
  const report: ImportReport = {
    imported: [], overwrites: [], unchanged: [], migrated: [], dropped: [], warnings: [],
  };

  const renames = new Map<string, string>();
  for (const entry of migrations) {
    if (compareVersions(snapshot.version, entry.since) < 0) {
      for (const [from, to] of Object.entries(entry.renames)) renames.set(from, to);
    }
  }

  const known = new Set(walkConfigFields(defaults, {}).map((f) => f.path));
  const changes: Record<string, unknown> = {};
  const resets: string[] = [];

  for (const [path, raw] of Object.entries(snapshot.changes)) {
    let target = path;
    if (renames.has(path)) {
      target = renames.get(path)!;
      report.migrated.push({ from: path, to: target });
    }
    if (!known.has(target)) {
      report.dropped.push(target);
      continue;
    }
    if (secretPaths.has(target) && (raw === null || raw === undefined || raw === '')) {
      report.warnings.push(`${target}: empty secret skipped.`);
      continue;
    }
    try {
      const defaultValue = getAt(defaults, target);
      const value = coerceFieldValue(target, defaultValue, raw);
      changes[target] = value;
      report.imported.push(target);
      const from = getAt(user, target);
      if (from === undefined || !sameValue(from, value)) {
        report.overwrites.push({ path: target, from, to: value });
      } else {
        report.unchanged.push(target);
      }
    } catch (error) {
      report.warnings.push(`${target}: ${(error as Error).message}`);
    }
  }

  if (compareVersions(snapshot.version, currentVersion) > 0) {
    report.warnings.push(
      `Snapshot was made by a newer version (${snapshot.version}) than this server (${currentVersion}).`,
    );
  }

  return { edits: { changes, resets }, report };
}
