#!/usr/bin/env bun
/**
 * scripts/test-patches.ts
 *
 * Downloads @anthropic-ai/claude-code from npm (default: latest) and
 * tries to apply each cx patch against it independently. Reports a
 * pass/fail summary and writes a JSON report.
 *
 * Patches are tested one at a time so a failure in patch A never
 * masks a failure — or a success — in patch B. This is intentionally
 * stricter than the runtime path, where a broken patch would just
 * poison the whole bundle.
 *
 * Usage:
 *   bun scripts/test-patches.ts               # test against @latest
 *   bun scripts/test-patches.ts 2.1.101       # test against a specific version
 *   CC_VERSION=2.1.101 bun scripts/test-patches.ts
 *
 * Exit codes:
 *   0  all patches applied cleanly
 *   1  one or more patches failed (details in stdout + report.json)
 *   2  failed to download/extract the claude-code package
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { transform, listPatches } from '../src/transform.js';

// ── Resolve target version ───────────────────────────────────────────────
const targetVersion = process.argv[2] ?? process.env.CC_VERSION ?? 'latest';

// ── Download & extract the claude-code tarball ────────────────────────────
const tmpDir = resolve(process.cwd(), '.test-cache');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

let tarballName: string;
try {
  tarballName = execSync(
    `npm pack @anthropic-ai/claude-code@${targetVersion} --pack-destination "${tmpDir}" --silent`,
    { encoding: 'utf-8' },
  ).trim();
} catch (err) {
  console.error(`cx: failed to download @anthropic-ai/claude-code@${targetVersion}`);
  console.error((err as Error).message);
  process.exit(2);
}

execSync(`tar -xzf "${resolve(tmpDir, tarballName)}" -C "${tmpDir}"`);
const pkgDir = resolve(tmpDir, 'package');
const cliPath = resolve(pkgDir, 'cli.js');
if (!existsSync(cliPath)) {
  console.error(`cx: cli.js not found in extracted tarball (${cliPath})`);
  process.exit(2);
}

const source = readFileSync(cliPath, 'utf-8');
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8'));
const actualVersion: string = pkg.version;

// ── Run each patch in isolation ───────────────────────────────────────────
const patches = listPatches();
if (patches.length === 0) {
  console.error('cx: no patches found — check src/patches/index.ts');
  process.exit(2);
}

console.log(`Testing ${patches.length} patches against @anthropic-ai/claude-code@${actualVersion}\n`);

interface Result {
  id: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}
const results: Result[] = [];

for (const p of patches) {
  const t0 = performance.now();
  try {
    transform(source, actualVersion, [p.id]);
    const dt = performance.now() - t0;
    results.push({ id: p.id, ok: true, durationMs: dt });
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${p.id} \x1b[2m(${dt.toFixed(0)}ms)\x1b[0m\n`);
  } catch (err) {
    const dt = performance.now() - t0;
    const msg = (err as Error).message.replace(/^Patch "[^"]+" failed: /, '');
    results.push({ id: p.id, ok: false, error: msg, durationMs: dt });
    process.stdout.write(`  \x1b[31m✘\x1b[0m ${p.id}\n`);
    process.stdout.write(`      \x1b[2m${msg}\x1b[0m\n`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
const passed = results.filter(r => r.ok);

console.log();
console.log(`${passed.length} passed, ${failed.length} failed`);

if (failed.length > 0) {
  console.log();
  console.log('Broken patches:');
  for (const f of failed) console.log(`  - ${f.id}: ${f.error}`);
}

// ── Write JSON report ─────────────────────────────────────────────────────
const report = {
  version: actualVersion,
  timestamp: new Date().toISOString(),
  total: patches.length,
  passed: passed.length,
  failed: failed.length,
  results,
};
const reportPath = resolve(tmpDir, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport: ${reportPath}`);

process.exit(failed.length > 0 ? 1 : 0);
