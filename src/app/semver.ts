/**
 * Semver ordering for release tags - the single comparator behind update
 * channel checks and config-import migrations. Bare or v-prefixed versions,
 * arbitrary prerelease identifiers (-dev.N, -rc.1, ...).
 */

export function parseVersion(raw: string): {
  core: number[];
  pre: Array<string | number>;
} {
  const t = raw.trim().replace(/^v/i, "");
  const [corePart, ...preParts] = t.split("-");
  const core = corePart.split(".").map((n) => {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  });
  while (core.length < 3) core.push(0);
  const pre = preParts
    .join("-")
    .split(".")
    .filter(Boolean)
    .map((p) => {
      const n = Number(p);
      return Number.isFinite(n) && String(n) === p ? n : p;
    });
  return { core: core.slice(0, 3), pre };
}

function compareRaw(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const av = pa.pre[i];
    const bv = pb.pre[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (typeof av === "number" && typeof bv === "number") {
      if (av !== bv) return av - bv;
      continue;
    }
    const as = String(av);
    const bs = String(bv);
    if (as !== bs) return as < bs ? -1 : 1;
  }
  return 0;
}

/** -1 | 0 | 1 (normalized). Release beats prerelease of the same core. */
export function compareVersions(a: string, b: string): number {
  const r = compareRaw(a, b);
  return r < 0 ? -1 : r > 0 ? 1 : 0;
}
