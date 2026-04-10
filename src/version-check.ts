/**
 * Version check — best-effort check for a newer cx on npm.
 *
 * Prints an upgrade hint when a cached npm response shows a newer
 * version than the one we're running. The actual network fetch is
 * kicked off in the background and never blocks startup: this run
 * prints from the last-known cache, the next run picks up what this
 * run fetched. Cache TTL is 24h.
 *
 * Not a patch — this is built-in behavior, called once from cli.ts
 * at initial startup (before the reload loop), similar in spirit to
 * the banner patch but implemented in the wrapper, not in the bundle.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get as httpsGet } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(__dirname, '..', '.cache');
const cachePath = resolve(cacheDir, 'version-check.json');
const TTL_MS = 24 * 60 * 60 * 1000;

interface VersionCache {
  latest: string;
  checkedAt: number;
}

function readPkgVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
  return pkg.version as string;
}

function readCache(): VersionCache | null {
  if (!existsSync(cachePath)) return null;
  try { return JSON.parse(readFileSync(cachePath, 'utf-8')) as VersionCache; } catch { return null; }
}

function writeCache(c: VersionCache): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(c));
  } catch { /* best-effort */ }
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
    const req = httpsGet(
      'https://registry.npmjs.org/claude-code-extensions/latest',
      { headers: { accept: 'application/json' }, timeout: 3000 },
      r => {
        if (r.statusCode !== 200) { r.resume(); return res(null); }
        let body = '';
        r.setEncoding('utf-8');
        r.on('data', c => body += c);
        r.on('end', () => {
          try {
            const j = JSON.parse(body);
            res(typeof j.version === 'string' ? j.version : null);
          } catch { res(null); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); res(null); });
    req.on('error', () => res(null));
  });
}

/**
 * Print an upgrade hint from cache if one is known, and refresh the
 * cache in the background when stale. Never blocks. Never throws.
 */
export function runVersionCheck(): void {
  let current: string;
  try { current = readPkgVersion(); } catch { return; }

  const cached = readCache();
  const now = Date.now();

  if (cached && isNewer(cached.latest, current)) {
    process.stderr.write(
      `\x1b[33m  ✨ cx update available\x1b[0m \x1b[2m${current} → ${cached.latest}\x1b[0m\n` +
      `\x1b[2m     update with \x1b[0m\x1b[36mnpm install -g claude-code-extensions@latest\x1b[0m\n`
    );
  }

  if (!cached || now - cached.checkedAt > TTL_MS) {
    // Fire-and-forget. The process is long-lived (claude session) so
    // the fetch has plenty of time to finish; on exit, unresolved
    // handles are torn down with the process.
    void fetchLatest().then(latest => {
      if (latest) writeCache({ latest, checkedAt: Date.now() });
    });
  }
}
