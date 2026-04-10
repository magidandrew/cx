#!/usr/bin/env node
/**
 * cx — Claude Code Extensions
 *
 * Drop-in replacement for `claude`. Applies enabled patches at runtime
 * via AST transformation. The original cli.js is never modified.
 * All arguments pass through to claude untouched.
 *
 * Subcommands:
 *   cx setup    — interactive patch configurator
 *   cx list     — show patch status
 *   cx reload   — signal a running cx instance to reload Claude
 *   cx [args]   — run patched Claude (with auto-reload support)
 *
 * Reload: type `! cx reload` inside Claude to restart the session
 * with fresh patches applied. The conversation resumes via --continue.
 */

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { execSync, spawn as nodeSpawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { transformAsync, listPatches } from './transform.js';
import type { CxConfig, PatchInfo } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', '.cx-patches.json');
const cacheDir = resolve(__dirname, '..', '.cache');
const cachedCliPath = resolve(cacheDir, 'cli.mjs');
const metaPath = resolve(cacheDir, 'meta.json');
const PID_FILE = resolve(__dirname, '..', '.cx-pid');
const RELOAD_EXIT_CODE = 75;

// ── Subcommands (fast path, before any heavy work) ───────────────────────

const sub = process.argv[2];

if (sub === 'reload') {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 'SIGUSR1');
    process.stderr.write('\x1b[2mcx: reload signal sent\x1b[0m\n');
  } catch (e: any) {
    const msg = e.code === 'ENOENT' ? 'no cx instance running'
      : e.code === 'ESRCH' ? 'cx process not running'
      : e.message;
    process.stderr.write(`cx reload: ${msg}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Config ───────────────────────────────────────────────────────────────

function loadConfig(): CxConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CxConfig; } catch { return null; }
}

function getEnabledPatches(): string[] {
  const config = loadConfig();
  const all = listPatches();
  if (!config?.patches) return all.map(p => p.id);
  return all.filter((p: PatchInfo) => {
    if (p.id in config.patches) return config.patches[p.id] !== false;
    return p.defaultEnabled !== false;
  }).map(p => p.id);
}

if (sub === 'list') {
  const all = listPatches();
  const enabled = getEnabledPatches();
  for (const p of all) {
    const on = enabled.includes(p.id);
    process.stdout.write(`  ${on ? '\x1b[32m✓\x1b[0m' : '\x1b[90m✗\x1b[0m'} ${p.id} — ${p.description ?? p.name}\n`);
  }
  process.exit(0);
}

if (sub === 'setup') {
  const { default: setup } = await import('./setup.js');
  await setup();
  process.exit(0);
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

// ── Cache ────────────────────────────────────────────────────────────────

async function ensureCache(): Promise<void> {
  const enabled = getEnabledPatches();
  const stat = statSync(cliPath!);
  const key = `${stat.size}:${stat.mtimeMs}:${[...enabled].sort().join(',')}`;

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
    const patched = await transformAsync(original, enabled, {
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

  process.exit(code ?? 0);
}
