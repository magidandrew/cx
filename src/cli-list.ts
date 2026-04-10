#!/usr/bin/env node
/**
 * cx-list — Show patch status for Claude Code Extensions
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listPatches } from './transform.js';
import type { CxConfig, PatchInfo } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', '.cx-patches.json');

function loadConfig(): CxConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CxConfig; } catch { return null; }
}

const config = loadConfig();
const all = listPatches();

for (const p of all) {
  let on: boolean;
  if (config?.patches && p.id in config.patches) {
    on = config.patches[p.id] !== false;
  } else {
    on = p.defaultEnabled !== false;
  }
  process.stdout.write(`  ${on ? '\x1b[32m✓\x1b[0m' : '\x1b[90m✗\x1b[0m'} ${p.id} — ${p.description ?? p.name}\n`);
}
