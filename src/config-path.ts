/**
 * Shared config-path helper.
 *
 * The patch config lives at ~/.config/cx/patches.json so it survives
 * `npm i -g claude-code-extensions` (which wipes the package dir and
 * would otherwise take the old in-package .cx-patches.json with it).
 */

import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve, dirname } from 'path';

export const CONFIG_PATH = resolve(homedir(), '.config', 'cx', 'patches.json');

/** Ensure the parent directory for CONFIG_PATH exists before writing. */
export function ensureConfigDir(): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
}
