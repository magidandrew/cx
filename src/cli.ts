#!/usr/bin/env node
/**
 * cx — Claude Code Extensions
 *
 * Pure drop-in replacement for `claude`. Applies enabled patches at runtime
 * via AST transformation. The original cli.js is never modified.
 * All arguments pass through to claude untouched.
 *
 * Related commands:
 *   cx-setup   — interactive patch configurator
 *   cx-list    — show patch status
 *   cx-reload  — signal a running cx instance to reload Claude
 */

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { execSync, spawn as nodeSpawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { transformAsync, listPatches, resolveConflicts } from './transform.js';
import { runVersionCheck } from './version-check.js';
import { CONFIG_PATH } from './config-path.js';
import type { CxConfig, PatchInfo } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(__dirname, '..', '.cache');
const cachedCliPath = resolve(cacheDir, 'cli.mjs');
const metaPath = resolve(cacheDir, 'meta.json');
const PID_FILE = resolve(__dirname, '..', '.cx-pid');
const RELOAD_EXIT_CODE = 75;


// ── Config ───────────────────────────────────────────────────────────────

function loadConfig(): CxConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CxConfig; } catch { return null; }
}

function getEnabledPatches(): string[] {
  const config = loadConfig();
  const all = listPatches();
  const enabled = !config?.patches
    ? all.map(p => p.id)
    : all.filter((p: PatchInfo) => {
        if (p.id in config.patches) return config.patches[p.id] !== false;
        return p.defaultEnabled !== false;
      }).map(p => p.id);
  return resolveConflicts(enabled);
}


// ── First run ────────────────────────────────────────────────────────────

if (!existsSync(CONFIG_PATH)) {
  if (process.stdin.isTTY) {
    const { default: setup } = await import('./setup.js');
    await setup({ firstRun: true });
  } else {
    process.stderr.write('\x1b[2mcx: first run — all patches enabled. run cx setup to configure.\x1b[0m\n');
  }
}

// ── Locate cli.js ────────────────────────────────────────────────────────

let cliPath: string | undefined;
try {
  const npmRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim();
  cliPath = resolve(npmRoot, '@anthropic-ai/claude-code/cli.js');
} catch { /* fallthrough */ }

if (!cliPath || !existsSync(cliPath)) {
  console.error('cx: could not find @anthropic-ai/claude-code. Install it:');
  console.error('  npm install -g @anthropic-ai/claude-code');
  process.exit(1);
}

// Read the installed claude-code version from the package.json that
// sits next to cli.js. Patches with per-version variants consult
// this to pick the right implementation. Falls back to "0.0.0" if
// the package.json is unreadable — that forces patches to pick a
// catch-all variant ("*") or fail loudly with "no variant matches".
function readClaudeVersion(): string {
  try {
    const pkgPath = resolve(dirname(cliPath!), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch { /* fall through */ }
  return '0.0.0';
}
const claudeVersion = readClaudeVersion();

// ── Cache ────────────────────────────────────────────────────────────────

/**
 * Max mtime across every file in src/patches (dev) or dist/patches (npm).
 * Folded into the cache key so editing a patch source automatically
 * invalidates the cached cli.mjs — otherwise users hit stale patches
 * whenever the enabled list stays the same but a patch body changes.
 */
function patchesMtime(): number {
  const patchesDir = resolve(__dirname, 'patches');
  let maxMtime = 0;
  try {
    for (const entry of readdirSync(patchesDir)) {
      if (entry === 'index.js' || entry === 'index.ts') continue;
      if (!entry.endsWith('.js') && !entry.endsWith('.ts')) continue;
      const m = statSync(resolve(patchesDir, entry)).mtimeMs;
      if (m > maxMtime) maxMtime = m;
    }
  } catch { /* fall through with 0 — never invalidates less than before */ }
  return maxMtime;
}

async function ensureCache(): Promise<void> {
  const enabled = getEnabledPatches();
  const stat = statSync(cliPath!);
  // `claudeVersion` is folded into the cache key alongside size/mtime
  // so a reinstall or upgrade of @anthropic-ai/claude-code always picks
  // up the matching variant — a stale cache from an older CC version
  // would apply the wrong variant's edits and likely corrupt the bundle.
  const key = `${stat.size}:${stat.mtimeMs}:${claudeVersion}:${patchesMtime()}:${[...enabled].sort().join(',')}`;

  let valid = false;
  if (existsSync(cachedCliPath) && existsSync(metaPath)) {
    try { valid = JSON.parse(readFileSync(metaPath, 'utf-8')).key === key; } catch {}
  }

  if (!valid) {
    const t0 = performance.now();
    const total = enabled.length;

    // Line 0: prepare with elapsed timer, Lines 1..N: patch checklist
    process.stderr.write(`\x1b[2m  ◇ preparing (0s)\x1b[0m\n`);
    for (const id of enabled) {
      process.stderr.write(`\x1b[2m  ◻ ${id}\x1b[0m\n`);
    }

    const timer = setInterval(() => {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const up = total + 1;
      process.stderr.write(`\x1b[${up}A\r\x1b[2m  ◇ preparing (${elapsed}s)\x1b[0m\x1b[K\x1b[${up}B\r`);
    }, 100);

    const original = readFileSync(cliPath!, 'utf-8');
    const patched = await transformAsync(original, enabled, claudeVersion, {
      onReady() {
        clearInterval(timer);
        const up = total + 1;
        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`\x1b[${up}A\r\x1b[2m  ◇ ready (${elapsed}s)\x1b[0m\x1b[K\x1b[${up}B\r`);
      },
      onDone(id: string) {
        const idx = enabled.indexOf(id);
        const up = total - idx;
        process.stderr.write(`\x1b[${up}A\r\x1b[32m  ✔ ${id}\x1b[0m\x1b[K\x1b[${up}B\r`);
      },
    });

    // Replace prepare line with summary
    const up = total + 1;
    process.stderr.write(`\x1b[${up}A\r\x1b[2m  ◆ ${total} patches applied (${((performance.now() - t0) / 1000).toFixed(1)}s)\x1b[0m\x1b[K\x1b[${up}B\r`);

    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachedCliPath, patched);
    writeFileSync(metaPath, JSON.stringify({ key, ts: new Date().toISOString() }));
  }
}

// ── PID file ─────────────────────────────────────────────────────────────

writeFileSync(PID_FILE, String(process.pid));
function cleanPid(): void { try { unlinkSync(PID_FILE); } catch {} }
process.on('exit', cleanPid);

// ── Reload loop ──────────────────────────────────────────────────────────

let child: ReturnType<typeof nodeSpawn> | null = null;
let shouldReload = false;

process.on('SIGUSR1', () => {
  shouldReload = true;
  if (child) child.kill('SIGTERM');
});

// Let child handle Ctrl+C — don't let it kill the wrapper
process.on('SIGINT', () => {
  if (!child) { cleanPid(); process.exit(130); }
});

process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM');
  cleanPid();
  process.exit(143);
});

/**
 * Build args for a reload: strip --continue/--resume, prepend --continue.
 */
function reloadArgs(original: string[]): string[] {
  const skip = new Set(['--continue', '-c', '--resume', '-r']);
  const result = ['--continue'];
  for (let i = 0; i < original.length; i++) {
    if (skip.has(original[i])) {
      // --resume/-r may have an optional value; skip it too
      if ((original[i] === '--resume' || original[i] === '-r') &&
          i + 1 < original.length && !original[i + 1].startsWith('-')) {
        i++;
      }
      continue;
    }
    result.push(original[i]);
  }
  return result;
}

// Built-in, always-on: check npm for a newer cx and print an upgrade
// hint if one is known. Cache TTL 10m; blocks up to 500ms on a stale
// cache to refresh, then falls back to the cached value. Only runs on
// the initial startup, not on reload.
await runVersionCheck();

const userArgs = process.argv.slice(2);
let isReload = false;

while (true) {
  await ensureCache();

  const args = isReload ? reloadArgs(userArgs) : userArgs;

  child = nodeSpawn(process.execPath, [cachedCliPath, ...args], {
    stdio: 'inherit',
    env: process.env,
  });

  const code = await new Promise<number | null>(r => child!.on('close', (c) => r(c)));
  child = null;

  if (shouldReload || code === RELOAD_EXIT_CODE) {
    shouldReload = false;
    isReload = true;
    process.stderr.write('\n\x1b[2mcx: reloading…\x1b[0m\n');
    continue;
  }

  // Ensure the final line ends with a newline so zsh doesn't show its
  // "partial line" `%` marker after the TUI tears down on Ctrl-C.
  process.stdout.write('\n');
  process.exit(code ?? 0);
}
