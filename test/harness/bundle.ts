/**
 * test/harness/bundle.ts
 *
 * Central fixture layer: downloads a claude-code version exactly once
 * per test run, caches the raw source on disk, and memoizes patched
 * variants in memory so dozens of tests can share the same patched
 * bundle without re-running the transform 30×.
 *
 * All tests should go through getBundle() — never read cli.js directly.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { transform } from '../../src/transform.js';
import * as allPatches from '../../src/patches/index.js';
import type { Patch } from '../../src/types.js';

// ── Target version ────────────────────────────────────────────────────────
// One version per test run. Override with CC_VERSION for regression-testing
// a specific claude-code release. Defaults to the most recent version we
// know our patches work against — bumping this is an explicit code change
// so CI failures from new claude-code versions are attributable.
export const TARGET_VERSION = process.env.CC_VERSION ?? '2.1.111';

// ── Disk cache ────────────────────────────────────────────────────────────
// Kept outside the project root's build/ so it survives `rm -rf dist/`.
// Reuses the scripts/test-patches.ts cache dir to avoid double-downloading.
const CACHE_ROOT = resolve(process.cwd(), '.test-cache');

function ensureTarball(version: string): { cliPath: string; actualVersion: string } {
  const versionedDir = resolve(CACHE_ROOT, `v${version}`);
  const pkgDir = resolve(versionedDir, 'package');
  const cliPath = resolve(pkgDir, 'cli.js');

  if (existsSync(cliPath)) {
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8'));
    return { cliPath, actualVersion: pkg.version };
  }

  mkdirSync(versionedDir, { recursive: true });
  const tarballName = execSync(
    `npm pack @anthropic-ai/claude-code@${version} --pack-destination "${versionedDir}" --silent`,
    { encoding: 'utf-8' },
  ).trim();
  execSync(`tar -xzf "${resolve(versionedDir, tarballName)}" -C "${versionedDir}"`);

  if (!existsSync(cliPath)) {
    throw new Error(`Failed to extract cli.js from ${tarballName}`);
  }
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8'));
  return { cliPath, actualVersion: pkg.version };
}

// ── Raw source (cached in memory) ─────────────────────────────────────────
let _raw: { source: string; version: string } | null = null;
function getRaw(): { source: string; version: string } {
  if (_raw) return _raw;
  const { cliPath, actualVersion } = ensureTarball(TARGET_VERSION);
  _raw = { source: readFileSync(cliPath, 'utf-8'), version: actualVersion };
  return _raw;
}

// ── Patched variants (bounded LRU, keyed by patch id set) ────────────────
// Each patched bundle is ~13MB. Parsing it into an AST elsewhere costs
// hundreds of MB more. `bun test --max-concurrency=1` runs files serially,
// and every test file pulls exactly one patched bundle, so LRU=2 is
// plenty — size 2 covers both an isolated bundle and an all-patches
// bundle if a single file needs both (e.g. smoke.test.ts).
const MAX_PATCHED = 2;
const _patched = new Map<string, string>();

function lruGet<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function lruSet<K, V>(cache: Map<K, V>, key: K, value: V, max: number): void {
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface BundleOptions {
  /** Patches to apply. If omitted, applies all default-enabled patches. */
  patches?: string[] | null;
  /** If true, applies every available patch (ignores defaultEnabled). */
  all?: boolean;
}

/**
 * Return a patched bundle source string. Memoized by patch id set so
 * multiple tests asking for the same combination share one compilation.
 *
 * Pass `{ patches: ['banner'] }` to isolate a single patch. Pass
 * `{ all: true }` to apply every patch. Default is the set of
 * `defaultEnabled: true` patches — matches the runtime default.
 */
export function getBundle(opts: BundleOptions = {}): { source: string; version: string } {
  const { source: raw, version } = getRaw();

  let ids: string[];
  if (opts.all) {
    ids = (Object.values(allPatches) as Patch[]).map(p => p.id);
  } else if (opts.patches) {
    ids = [...opts.patches];
  } else {
    ids = (Object.values(allPatches) as Patch[])
      .filter(p => p.defaultEnabled !== false)
      .map(p => p.id);
  }

  const key = [...ids].sort().join(',');
  const hit = lruGet(_patched, key);
  if (hit) return { source: hit, version };

  const patched = transform(raw, version, ids);
  lruSet(_patched, key, patched, MAX_PATCHED);
  return { source: patched, version };
}

/** Return the raw (unpatched) bundle source. Useful for A/B comparisons. */
export function getRawBundle(): { source: string; version: string } {
  return getRaw();
}

/**
 * Return a bundle patched with ONLY the named patch. This is the standard
 * form for per-patch tests: isolate the patch so any observed effect is
 * attributable to it and not some other interaction.
 */
export function getIsolatedBundle(patchId: string): { source: string; version: string } {
  return getBundle({ patches: [patchId] });
}
