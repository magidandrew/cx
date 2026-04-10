#!/usr/bin/env node
/**
 * cx-reload — Signal a running cx instance to reload patches
 *
 * Usage: cx-reload (or `! cx-reload` from inside a cx session)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PID_FILE = resolve(__dirname, '..', '.cx-pid');

try {
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  process.kill(pid, 'SIGUSR1');
  process.stderr.write('\x1b[2mcx: reload signal sent\x1b[0m\n');
} catch (e: any) {
  const msg = e.code === 'ENOENT' ? 'no cx instance running'
    : e.code === 'ESRCH' ? 'cx process not running'
    : e.message;
  process.stderr.write(`cx-reload: ${msg}\n`);
  process.exit(1);
}
