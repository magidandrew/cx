/**
 * Minimal semver range matcher for per-version patch variants.
 *
 * We roll our own instead of pulling in the npm `semver` package
 * because cx's production dependency list is exactly one package
 * (acorn) and adding a second just for one comparison is not worth
 * the weight. The ranges we actually need are trivially parseable:
 *
 *   "2.1.96"         exact match
 *   "=2.1.96"        same as above
 *   ">=2.1.97"       2.1.97 and later
 *   "<=2.1.96"       up to and including 2.1.96
 *   ">2.1.96"        strictly after 2.1.96
 *   "<2.1.97"        strictly before 2.1.97
 *   "*"              matches any version
 *   ">=2.1.96 <2.2"  compound — all whitespace-separated parts must match
 *
 * Prerelease suffixes are ignored: "2.1.96-beta" parses as [2,1,96].
 * Inputs that fail to parse never match — callers should treat that
 * as "range does not apply" rather than a hard error.
 */

/** "1.2.3" → [1,2,3]. Ignores any `-prerelease` suffix. Returns null on parse failure. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Returns a negative, zero, or positive number like Array.sort would. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function matchesSingle(version: string, constraint: string): boolean {
  const c = constraint.trim();
  if (c === '*' || c === '') return true;
  const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(c);
  if (!m) return false;
  const op = m[1] ?? '=';
  const target = m[2];
  if (parseSemver(target) === null) return false;
  const cmp = compareSemver(version, target);
  switch (op) {
    case '=':  return cmp === 0;
    case '>':  return cmp > 0;
    case '>=': return cmp >= 0;
    case '<':  return cmp < 0;
    case '<=': return cmp <= 0;
  }
  return false;
}

/**
 * Test whether a concrete version satisfies a range string. Compound
 * ranges join their parts with AND: every whitespace-separated
 * constraint must match for the whole range to match.
 */
export function matchesRange(version: string, range: string): boolean {
  if (parseSemver(version) === null) return false;
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  for (const part of parts) {
    if (!matchesSingle(version, part)) return false;
  }
  return true;
}
