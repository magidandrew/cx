/**
 * Shared config-path helper.
 *
 * Everything cx persists across runs lives under ~/.config/cx so it
 * survives `npm i -g claude-code-extensions` (which wipes the package
 * dir). Layout:
 *
 *   ~/.config/cx/
 *   ├── patches.json              — user config (precious)
 *   └── cache/
 *       └── version-check.json    — ephemeral wrapper state (safe to rm)
 */

import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve, dirname } from 'path';

const CX_HOME = resolve(homedir(), '.config', 'cx');

export const CONFIG_PATH = resolve(CX_HOME, 'patches.json');
export const CACHE_DIR = resolve(CX_HOME, 'cache');

/** Ensure the parent directory for CONFIG_PATH exists before writing. */
export function ensureConfigDir(): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
}

/** Ensure CACHE_DIR exists before writing. Best-effort — never throws. */
export function ensureCacheDir(): void {
  try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* best-effort */ }
}
