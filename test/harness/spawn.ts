/**
 * test/harness/spawn.ts
 *
 * Spawn the patched cli.js with a chosen set of patches and capture
 * stdout/stderr/exit. The patched source is written to a temp dir
 * alongside the claude-code node_modules tree so relative requires
 * and asset lookups (vendor/, sdk-tools.d.ts, etc.) still resolve —
 * we symlink the extracted package dir and swap cli.js for the
 * patched version.
 *
 * Used for SPAWN-bucket tests that need to observe real runtime
 * behavior: exit codes (reload → 75), non-interactive slash commands
 * (/cd, /rename), stdout formatting (startup banner).
 *
 * The spawned process inherits a scrubbed HOME so config writes stay
 * sandboxed. Tests that want to inspect config after the spawn should
 * read from the `home` dir returned by prepareSpawnEnv().
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { spawn, spawnSync } from 'child_process';
import { getBundle, TARGET_VERSION } from './bundle.js';

// ── Workspace layout ─────────────────────────────────────────────────────

/**
 * Stage a patched claude-code install in a temp dir. We copy the
 * extracted package dir (cli.js gets overwritten with the patched
 * version, everything else is symlinked) and create a throwaway $HOME
 * so the cli doesn't touch the developer's real config.
 */
export interface SpawnEnv {
  /** Path to the patched cli.js the test should node-spawn. */
  cliPath: string;
  /** Throwaway HOME dir — assert config writes land here. */
  home: string;
  /** Throwaway CWD — tests cd commands can push into subdirs of this. */
  cwd: string;
  /** Cleanup. Always call in afterEach so temp dirs don't accumulate. */
  cleanup: () => void;
}

export interface PrepareOptions {
  patches?: string[] | null;
  /** If true, apply every available patch. */
  all?: boolean;
}

export function prepareSpawnEnv(opts: PrepareOptions = {}): SpawnEnv {
  const cachedPkgDir = resolve(process.cwd(), '.test-cache', `v${TARGET_VERSION}`, 'package');
  if (!existsSync(cachedPkgDir)) {
    // Force the bundle harness to download the tarball.
    getBundle(opts);
  }

  const workDir = mkdtempSync(resolve(tmpdir(), 'cx-spawn-'));
  const pkgDir = resolve(workDir, 'package');
  mkdirSync(pkgDir);
  // Symlink everything except cli.js — the patched copy lives in the temp dir.
  for (const entry of readdirSyncSafe(cachedPkgDir)) {
    if (entry === 'cli.js') continue;
    try {
      symlinkSync(resolve(cachedPkgDir, entry), resolve(pkgDir, entry));
    } catch (err) {
      // Fall back to a copy on systems where symlinking fails.
      // (Tests intentionally don't mutate these files.)
    }
  }
  const { source } = getBundle(opts);
  const cliPath = resolve(pkgDir, 'cli.js');
  writeFileSync(cliPath, source);

  const home = resolve(workDir, 'home');
  mkdirSync(home, { recursive: true });
  const cwd = resolve(workDir, 'cwd');
  mkdirSync(cwd, { recursive: true });

  return {
    cliPath,
    home,
    cwd,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ── Synchronous spawn ────────────────────────────────────────────────────

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunOptions {
  args?: string[];
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  /** Extra env to add on top of the scrubbed defaults. */
}

/**
 * Run the patched cli.js under node with the given args/stdin.
 * Synchronous — blocks until the process exits. Default timeout is
 * 15s since spawning claude-code takes a couple seconds of startup.
 */
export function runCli(env: SpawnEnv, opts: RunOptions = {}): RunResult {
  const childEnv: Record<string, string> = {
    // Scrub to a minimal env so tests are reproducible across machines.
    PATH: process.env.PATH ?? '',
    HOME: env.home,
    USER: process.env.USER ?? 'tester',
    NODE_NO_WARNINGS: '1',
    // Disable telemetry hard in case the disable-telemetry patch isn't
    // applied for this test.
    DISABLE_TELEMETRY: '1',
    CI: '1',
    ...(opts.env ?? {}),
  };

  const result = spawnSync('node', [env.cliPath, ...(opts.args ?? [])], {
    cwd: env.cwd,
    env: childEnv,
    input: opts.stdin,
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 15_000,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
    signal: result.signal as NodeJS.Signals | null,
  };
}
