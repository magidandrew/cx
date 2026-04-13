/**
 * Auto-update — best-effort in-place upgrade of cx to the latest npm
 * version. Checks the registry (10m cache) and, if a newer version is
 * published, installs it and signals the caller to re-exec so the new
 * patches take effect on the current invocation.
 *
 * The cache lives at ~/.config/cx/cache/version-check.json so it
 * survives `npm i -g` and is shared across node versions (fnm etc.).
 * That also means installing an *older* version doesn't lose the
 * knowledge that a newer one exists — auto-update still fires.
 *
 * Resilience invariants:
 *   • Never throws. Every fs/network/parse/spawn op is caught.
 *   • Corrupt / partial / alien cache files are treated as "no cache".
 *   • Writes are atomic (temp + rename) so a torn write from a killed
 *     process can't poison later runs.
 *   • Cache shape is validated before trust — missing or wrong-typed
 *     fields force a refetch instead of being silently used.
 *   • Clock skew (checkedAt in the future) is treated as fresh.
 *   • Concurrent cx startups race harmlessly: whichever rename wins,
 *     the file is always a complete JSON object.
 *   • Failed installs degrade gracefully: print a manual-install hint
 *     with the upstream error tail and let the current (old) version
 *     continue running — auto-update never blocks cx from starting.
 *   • Auto-update is skipped when running from a source checkout (the
 *     module isn't inside a node_modules directory) so developers
 *     don't get their working tree clobbered.
 *   • CX_JUST_UPDATED=1 in env is the loop breaker: after a successful
 *     auto-update the caller re-execs with this flag set so the child
 *     skips the version check entirely and can't recurse.
 *
 * Not a patch — this is built-in behavior, called once from cli.ts at
 * initial startup (before the reload loop).
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { get as httpsGet } from 'https';
import { spawn } from 'child_process';
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
 * Detect the package manager used to install cx by looking at the
 * path to this module. Returns null if we're running from a source
 * checkout (no node_modules ancestor) — in that case we skip auto-
 * update entirely, to avoid clobbering a developer's working tree.
 *
 * The detection is deliberately crude: the path shape uniquely
 * identifies each package manager's global-install layout on every
 * platform we care about. If none of the specific markers match we
 * fall back to npm, which covers the overwhelming majority of
 * installs (including nvm / fnm / volta / asdf shims).
 */
interface UpgradeCommand { bin: string; args: string[]; display: string; }
function detectUpgradeCommand(): UpgradeCommand | null {
  const path = __dirname;
  // Must be inside a node_modules — otherwise this is a source
  // checkout (e.g. `bun src/cli.ts` during development) and there's
  // nothing to auto-update in place.
  if (!path.includes(`${sep}node_modules${sep}`)) return null;

  const pkg = 'claude-code-extensions@latest';
  // pnpm: ~/Library/pnpm/global/..., ~/.local/share/pnpm/global/...
  if (/[\\/]pnpm[\\/]/.test(path)) {
    return { bin: 'pnpm', args: ['add', '-g', pkg], display: `pnpm add -g ${pkg}` };
  }
  // bun: ~/.bun/install/global/node_modules/...
  if (/[\\/]\.bun[\\/]/.test(path)) {
    return { bin: 'bun', args: ['add', '-g', pkg], display: `bun add -g ${pkg}` };
  }
  // yarn classic: ~/.config/yarn/global/..., ~/.yarn/...
  if (/[\\/]\.yarn[\\/]/.test(path) || /[\\/]yarn[\\/]global[\\/]/.test(path)) {
    return { bin: 'yarn', args: ['global', 'add', pkg], display: `yarn global add ${pkg}` };
  }
  // Default: npm (covers /usr/local/lib, nvm, fnm, volta, asdf, etc.)
  return { bin: 'npm', args: ['install', '-g', pkg], display: `npm install -g ${pkg}` };
}

/**
 * Run the upgrade command. Shows an in-place spinner with an elapsed
 * timer so the user has feedback during the install (typically 3–15s
 * for npm, sometimes longer on cold caches). Returns `ok: true` on a
 * clean zero-exit install, and `ok: false` on any failure — spawn
 * error, non-zero exit, missing bin, permission denied, killed by
 * signal — all funneled through the same fallback path.
 *
 * stdout is discarded to keep the spinner clean. stderr is captured
 * (capped at 8 KiB to bound memory against chatty npm output) so the
 * tail can be shown in the fallback hint if the install fails.
 */
function runUpgrade(current: string, latest: string, cmd: UpgradeCommand): Promise<{ ok: boolean; stderr: string }> {
  return new Promise(res => {
    let settled = false;
    const t0 = performance.now();

    const writeLine = (s: string) => { try { process.stderr.write(s); } catch { /* stderr gone */ } };

    writeLine(`\x1b[2m  ◇ updating cx ${current} → ${latest} (0.0s)\x1b[0m\n`);

    const timer = setInterval(() => {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      writeLine(`\x1b[1A\r\x1b[2m  ◇ updating cx ${current} → ${latest} (${elapsed}s)\x1b[0m\x1b[K\n`);
    }, 100);

    const done = (ok: boolean, stderrBuf: string) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      if (ok) {
        writeLine(`\x1b[1A\r\x1b[32m  ✔ cx updated to ${latest}\x1b[0m \x1b[2m(${elapsed}s)\x1b[0m\x1b[K\n`);
      } else {
        writeLine(`\x1b[1A\r\x1b[33m  ✘ cx auto-update failed\x1b[0m \x1b[2m(${elapsed}s)\x1b[0m\x1b[K\n`);
      }
      res({ ok, stderr: stderrBuf });
    };

    let stderrBuf = '';
    try {
      // shell: true for cross-platform bin resolution (npm.cmd on Win).
      // All args are hardcoded literals so shell injection is not a
      // concern.
      const child = spawn(cmd.bin, cmd.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: true,
        // CX_AUTO_UPDATING silences scripts/postinstall.mjs so its
        // /dev/tty banner doesn't bleed through our spinner.
        env: { ...process.env, CX_AUTO_UPDATING: '1' },
      });
      child.stderr?.on('data', (c: Buffer) => {
        stderrBuf += c.toString('utf-8');
        if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
      });
      child.on('exit', code => done(code === 0, stderrBuf));
      child.on('error', () => done(false, stderrBuf));
    } catch {
      done(false, stderrBuf);
    }
  });
}

/**
 * Fallback when auto-update fails or isn't possible. Tells the user
 * the exact command to run themselves, plus the last line of stderr
 * from the failed install so they can see what went wrong (usually
 * EACCES on unsudo'd /usr/local or a network error).
 */
function printUpgradeHint(current: string, latest: string, cmd: UpgradeCommand | null, stderr: string): void {
  const installCmd = cmd?.display ?? 'npm install -g claude-code-extensions@latest';
  const lines: string[] = [
    `\x1b[33m  ✨ cx update available\x1b[0m \x1b[2m${current} → ${latest}\x1b[0m`,
    `\x1b[2m     update manually with \x1b[0m\x1b[36m${installCmd}\x1b[0m`,
  ];
  // Show the last non-empty line of stderr — usually the useful error.
  const tail = stderr.split('\n').map(l => l.trim()).filter(Boolean).pop();
  if (tail) lines.push(`\x1b[2m     ${tail.slice(0, 200)}\x1b[0m`);
  try {
    process.stderr.write(lines.join('\n') + '\n');
  } catch { /* stderr gone — nothing we can do */ }
}

/**
 * Check for a newer cx and, if one is published, install it in place
 * and signal the caller to re-exec. Returns true iff an update was
 * successfully applied and the caller should re-exec cx so the new
 * patches take effect. Returns false in all other cases:
 *   • we're already on the latest version
 *   • the registry fetch failed and we have no fresh cache
 *   • we're running from a source checkout (not auto-updatable)
 *   • the install command exited non-zero (hint printed instead)
 *   • CX_JUST_UPDATED=1 is already set (loop breaker after re-exec)
 *
 * Never throws — every failure mode degrades to "no update".
 */
export async function runVersionCheck(): Promise<boolean> {
  // Loop breaker: the parent already auto-updated and re-execed us.
  // Don't check again this invocation — otherwise a registry that
  // still advertises a "newer" version (stale CDN, wrong cache, etc.)
  // could send us into an infinite update/re-exec cycle.
  if (process.env.CX_JUST_UPDATED === '1') return false;

  const current = readPkgVersion();
  if (!current) return false;

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

  if (!latest || !isNewer(latest, current)) return false;

  // A newer version is available. Try to install it in place.
  const cmd = detectUpgradeCommand();
  if (!cmd) {
    // Source checkout — stay silent so devs working on cx don't see
    // confusing "update available" hints for their own working tree.
    return false;
  }

  const { ok, stderr } = await runUpgrade(current, latest, cmd);
  if (!ok) {
    printUpgradeHint(current, latest, cmd, stderr);
    return false;
  }
  return true;
}
