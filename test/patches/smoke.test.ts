/**
 * smoke.test.ts — spawn-based end-to-end tests
 *
 * Every test in this file actually RUNS the patched cli.js binary.
 * This catches the class of bugs that structural tests miss: edits
 * that look correct in the AST but produce unparseable JS, runtime
 * crashes from scope errors, or patched logic that doesn't execute
 * the way the test author assumed.
 *
 * Two tiers:
 *
 *   1. Per-patch smoke tests: apply each patch in isolation, spawn
 *      `node cli.js --bare --version`, assert exit 0. If a patch
 *      produces broken JS, this is where it surfaces — the binary
 *      won't even parse. Cost: ~0.6s per patch.
 *
 *   2. Behavioral spawn tests: for patches whose effect is observable
 *      via `--bare -p "/slash-command"` or similar no-auth paths,
 *      check the stdout. These prove the patch RUNS, not just that
 *      it was INSERTED.
 *
 * All spawns use `--bare` to skip hooks/LSP/plugin-sync (~0.6s vs ~9s).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { prepareSpawnEnv, runCli } from '../harness/index.js';
import type { SpawnEnv } from '../harness/spawn.js';
import { listPatches } from '../../src/transform.js';

// ═══════════════════════════════════════════════════════════════════════════
// Tier 1: per-patch smoke — does the patched bundle parse and run?
// ═══════════════════════════════════════════════════════════════════════════

describe('smoke — patched bundle runs', () => {
  const patches = listPatches();

  // Conflicts: nsfw-spinner and simple-spinner can't coexist.
  // Test each in isolation (one patch at a time) so conflicts don't matter.
  for (const p of patches) {
    test(`${p.id}: --version exits 0`, () => {
      let env: SpawnEnv | null = null;
      try {
        env = prepareSpawnEnv({ patches: [p.id] });
        const result = runCli(env, { args: ['--bare', '--version'] });
        expect(result.exitCode).toBe(0);
        // stdout should contain a version string like "2.1.101"
        expect(result.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
      } finally {
        env?.cleanup();
      }
    });
  }

  test('all default-enabled patches together: --version exits 0', () => {
    let env: SpawnEnv | null = null;
    try {
      env = prepareSpawnEnv(); // default-enabled set
      const result = runCli(env, { args: ['--bare', '--version'] });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
    } finally {
      env?.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tier 2: behavioral spawn tests — does the patch DO the right thing?
// ═══════════════════════════════════════════════════════════════════════════

describe('spawn — cd-command', () => {
  let env: SpawnEnv;

  beforeAll(() => {
    env = prepareSpawnEnv({ patches: ['cd-command'] });
  });
  afterAll(() => env?.cleanup());

  test('/cd /tmp changes directory', () => {
    const result = runCli(env, { args: ['--bare', '-p', '/cd /tmp'] });
    expect(result.exitCode).toBe(0);
    // macOS resolves /tmp → /private/tmp, so check the suffix.
    expect(result.stdout).toContain('/tmp');
    expect(result.stdout).toContain('Changed to');
  });

  test('/cd with no arg reports current directory', () => {
    const result = runCli(env, { args: ['--bare', '-p', '/cd'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Current directory:');
  });

  test('/cd to non-existent path returns error message (not crash)', () => {
    const result = runCli(env, {
      args: ['--bare', '-p', '/cd /this/path/does/not/exist'],
    });
    expect(result.exitCode).toBe(0); // the command catches and returns text
    // Should contain an error message, not a stack trace.
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

describe('spawn — cx-resume-commands', () => {
  // The shutdown hint template is only printed in interactive sessions.
  // But we CAN verify via --help that the binary starts cleanly, and
  // use the structural adjacency-pair test (cx-resume-commands.test.ts)
  // for the actual text. This spawn test just proves the patch doesn't
  // crash the binary — the deeper check is in the structural test.
  let env: SpawnEnv;

  beforeAll(() => {
    env = prepareSpawnEnv({ patches: ['cx-resume-commands'] });
  });
  afterAll(() => env?.cleanup());

  test('patched binary starts and shows --help', () => {
    const result = runCli(env, { args: ['--bare', '--help'] });
    expect(result.exitCode).toBe(0);
    // --help output should mention cx-relevant flags.
    expect(result.stdout).toContain('--resume');
    expect(result.stdout).toContain('--continue');
  });
});

describe('spawn — granular-effort + persist-max-effort', () => {
  let env: SpawnEnv;

  beforeAll(() => {
    env = prepareSpawnEnv({
      patches: ['persist-max-effort', 'granular-effort'],
    });
  });
  afterAll(() => env?.cleanup());

  test('--effort max with persist-max-effort starts cleanly', () => {
    // Without persist-max-effort, "max" is stripped from the Zod schema
    // and settings validation silently drops it. With the patch, max
    // survives through the full stack. The CLI flag accepts max because
    // Commander's enum already includes it — but the Zod/settings path
    // downstream would crash without the patch. --version exits before
    // reaching the full settings flow, so this is a smoke check.
    const result = runCli(env, {
      args: ['--bare', '--effort', 'max', '--version'],
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('spawn — banner', () => {
  let env: SpawnEnv;

  beforeAll(() => {
    env = prepareSpawnEnv({ patches: ['banner'] });
  });
  afterAll(() => env?.cleanup());

  test('patched binary starts without crashing', () => {
    const result = runCli(env, { args: ['--bare', '--version'] });
    expect(result.exitCode).toBe(0);
  });
});

describe('spawn — no-feedback', () => {
  let env: SpawnEnv;

  beforeAll(() => {
    env = prepareSpawnEnv({ patches: ['no-feedback'] });
  });
  afterAll(() => env?.cleanup());

  test('patched binary starts without crashing', () => {
    const result = runCli(env, { args: ['--bare', '--version'] });
    expect(result.exitCode).toBe(0);
  });
});
