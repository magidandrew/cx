#!/usr/bin/env node
/**
 * cx-setup — Configure Claude Code Extensions
 *
 * Standalone tool for managing which patches cx applies.
 *
 * Usage:
 *   cx-setup                  Interactive TUI
 *   cx-setup list             Show patch status
 *   cx-setup enable <id>      Enable a patch
 *   cx-setup disable <id>     Disable a patch
 *   cx-setup reset            Re-enable all patches
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listPatches } from './transform.js';
import type { CxConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', '.cx-patches.json');
const CACHE_DIR = resolve(__dirname, '..', '.cache');

const DIM = '\x1b[2m', BOLD = '\x1b[1m', GREEN = '\x1b[32m', RESET = '\x1b[0m';

// ── Config helpers ────────────────────────────────────────────────────────

function loadConfig(): Record<string, boolean> {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return (JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CxConfig).patches || {}; } catch { return {}; }
}

function saveConfig(patches: Record<string, boolean>): void {
  writeFileSync(CONFIG_PATH, JSON.stringify({ patches }, null, 2) + '\n');
  invalidateCache();
}

function invalidateCache(): void {
  try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch { /* ok */ }
}

// ── Commands ──────────────────────────────────────────────────────────────

const cmd = process.argv[2];
const arg = process.argv[3];

if (!cmd) {
  // Interactive TUI
  const { default: setup } = await import('./setup.js');
  setup();

} else if (cmd === 'list') {
  const config = loadConfig();
  const all = listPatches();
  console.log(`\n  ${BOLD}cx patches${RESET}\n`);
  for (const p of all) {
    const on = config[p.id] !== false;
    const icon = on ? `${GREEN}✔${RESET}` : `${DIM}○${RESET}`;
    console.log(`  ${icon} ${p.id.padEnd(16)}${DIM}${p.description}${RESET}`);
  }
  console.log(`\n  Run ${BOLD}cx-setup${RESET} to toggle interactively.\n`);

} else if (cmd === 'enable') {
  if (!arg) { console.error('Usage: cx-setup enable <patch-id>'); process.exit(1); }
  const all = listPatches();
  if (!all.find(p => p.id === arg)) {
    console.error(`Unknown patch: "${arg}". Available: ${all.map(p => p.id).join(', ')}`);
    process.exit(1);
  }
  const config = loadConfig();
  config[arg] = true;
  saveConfig(config);
  console.log(`  ${GREEN}✔${RESET} ${BOLD}${arg}${RESET} enabled`);

} else if (cmd === 'disable') {
  if (!arg) { console.error('Usage: cx-setup disable <patch-id>'); process.exit(1); }
  const all = listPatches();
  if (!all.find(p => p.id === arg)) {
    console.error(`Unknown patch: "${arg}". Available: ${all.map(p => p.id).join(', ')}`);
    process.exit(1);
  }
  const config = loadConfig();
  config[arg] = false;
  saveConfig(config);
  console.log(`  ${DIM}○${RESET} ${BOLD}${arg}${RESET} disabled`);

} else if (cmd === 'reset') {
  try { rmSync(CONFIG_PATH, { force: true }); } catch { /* ok */ }
  invalidateCache();
  console.log(`  ${GREEN}✔${RESET} Config reset — all patches enabled.`);

} else {
  console.error(`Unknown command: ${cmd}`);
  console.error(`\nUsage:`);
  console.error(`  cx-setup              Interactive configurator`);
  console.error(`  cx-setup list         Show patch status`);
  console.error(`  cx-setup enable <id>  Enable a patch`);
  console.error(`  cx-setup disable <id> Disable a patch`);
  console.error(`  cx-setup reset        Re-enable all patches`);
  process.exit(1);
}
