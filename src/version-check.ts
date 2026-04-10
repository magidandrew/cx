/**
 * Version check — best-effort check for a newer cx on npm.
 *
 * Prints an upgrade hint when npm reports a newer version than the one
 * we're running. Cache TTL is 10 minutes; on a stale cache we do a
 * short blocking fetch (500ms budget) and fall back to the cached
 * value on timeout.
 *
 * The cache lives at ~/.config/cx/cache/version-check.json so it
 * survives `npm i -g` and is shared across node versions (fnm etc.).
 * That also means installing an *older* version doesn't lose the
 * knowledge that a newer one exists — the banner still fires.
 *
 * Resilience invariants:
 *   • Never throws. Every fs/network/parse op is caught.
 *   • Corrupt / partial / alien cache files are treated as "no cache".
 *   • Writes are atomic (temp + rename) so a torn write from a killed
 *     process can't poison later runs.
 *   • Cache shape is validated before trust — missing or wrong-typed
 *     fields force a refetch instead of being silently used.
 *   • Clock skew (checkedAt in the future) is treated as fresh.
 *   • Concurrent cx startups race harmlessly: whichever rename wins,
 *     the file is always a complete JSON object.
 *
 * Not a patch — this is built-in behavior, called once from cli.ts at
 * initial startup (before the reload loop).
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get as httpsGet } from 'https';
import { CACHE_DIR, ensureCacheDir } from './config-path.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cachePath = resolve(CACHE_DIR, 'version-check.json');
const TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 500;

interface VersionCache {
  latest: string;
  checkedAt: number;
}

function readPkgVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch { return null; }
}

/**
 * Read and validate the cache. Any deviation from the expected shape
 * — missing file, unreadable, not JSON, wrong types — returns null so
 * the caller treats it as "no cache" and refetches.
 */
function readCache(): VersionCache | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.latest === 'string' &&
      parsed.latest.length > 0 &&
      typeof parsed.checkedAt === 'number' &&
      Number.isFinite(parsed.checkedAt)
    ) {
      return { latest: parsed.latest, checkedAt: parsed.checkedAt };
    }
    return null;
  } catch { return null; }
}

/**
 * Atomic write: stage to a unique temp file, then rename into place.
 * rename() is atomic on POSIX, so readers either see the old file or
 * the new file — never a half-written one. Best-effort: any failure
 * is swallowed and the temp file cleaned up.
 */
function writeCache(c: VersionCache): void {
  const tmp = `${cachePath}.${process.pid}.tmp`;
  try {
    ensureCacheDir();
    writeFileSync(tmp, JSON.stringify(c));
    renameSync(tmp, cachePath);
  } catch {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

/** "1.2.3" → [1,2,3]. Ignores any `-prerelease` suffix. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** Fetches the latest published version from the npm registry. */
function fetchLatest(): Promise<string | null> {
  return new Promise(res => {
    let settled = false;
    const done = (v: string | null) => { if (!settled) { settled = true; res(v); } };
    try {
      const req = httpsGet(
        'https://registry.npmjs.org/claude-code-extensions/latest',
        { headers: { accept: 'application/json' }, timeout: FETCH_TIMEOUT_MS },
        r => {
          if (r.statusCode !== 200) { r.resume(); return done(null); }
          let body = '';
          r.setEncoding('utf-8');
          r.on('data', c => body += c);
          r.on('end', () => {
            try {
              const j = JSON.parse(body);
              done(typeof j.version === 'string' ? j.version : null);
            } catch { done(null); }
          });
          r.on('error', () => done(null));
        }
      );
      req.on('timeout', () => { req.destroy(); done(null); });
      req.on('error', () => done(null));
    } catch { done(null); }
  });
}

/**
 * Determine whether the cache is still within its freshness window.
 * Handles clock skew on both sides:
 *   • Small forward skew (checkedAt slightly in the future): trust it,
 *     don't hammer the registry because the clock jittered.
 *   • Large forward skew (> TTL in the future): treat as corrupt and
 *     refetch — otherwise a bogus timestamp wedges the cache forever.
 */
function isFresh(cached: VersionCache, now: number): boolean {
  const age = now - cached.checkedAt;
  if (age < -TTL_MS) return false;    // absurdly future — corrupt, refetch
  if (age < 0) return true;           // mild skew — trust
  return age <= TTL_MS;
}

/**
 * Print an upgrade hint if npm reports a newer version. Uses a 10m
 * cache; on a stale cache, blocks for up to FETCH_TIMEOUT_MS to refresh
 * before printing, and falls back to the cached value on timeout.
 * Never throws — every failure mode degrades to "print nothing".
 */
export async function runVersionCheck(): Promise<void> {
  const current = readPkgVersion();
  if (!current) return;

  const cached = readCache();
  const now = Date.now();

  let latest: string | null = cached?.latest ?? null;

  if (!cached || !isFresh(cached, now)) {
    const fetched = await fetchLatest();
    if (fetched) {
      latest = fetched;
      writeCache({ latest: fetched, checkedAt: Date.now() });
    }
  }

  if (latest && isNewer(latest, current)) {
    try {
      process.stderr.write(
        `\x1b[33m  ✨ cx update available\x1b[0m \x1b[2m${current} → ${latest}\x1b[0m\n` +
        `\x1b[2m     update with \x1b[0m\x1b[36mnpm install -g claude-code-extensions@latest\x1b[0m\n`
      );
    } catch { /* stderr gone — nothing we can do */ }
  }
}
