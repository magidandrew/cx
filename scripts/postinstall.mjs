#!/usr/bin/env node
/**
 * Post-install banner — tells the user what to run next and checks
 * that @anthropic-ai/claude-code is installed globally (cx patches
 * it at runtime, so it's a hard requirement).
 *
 * Two gotchas baked in:
 *
 * 1. Dev tree. `scripts/postinstall.mjs` is published in the tarball,
 *    but npm ALSO runs it for every `npm install` inside the cx source
 *    repo. Skip when `../src` exists — that means we're sitting in
 *    the checkout, not an installed package, and the banner would
 *    just be noise during development.
 *
 * 2. npm 9+ runs postinstall scripts in the background and captures
 *    their stdout, so `process.stdout.write(...)` gets silently
 *    swallowed during a normal `npm install -g`. The only way the
 *    user sees it is by passing `--foreground-scripts`, which nobody
 *    does. Fix: open `/dev/tty` directly — that's the user's
 *    controlling terminal regardless of how stdout is piped, so it
 *    sidesteps npm's capture. Falls back to `process.stdout` on
 *    Windows and in truly non-interactive contexts (CI, `docker run`
 *    without `-it`) so CI logs still get something.
 *
 * Best-effort: any failure here must not fail the install. Every
 * path is wrapped in try/catch and we always exit 0.
 */

import { execSync } from 'child_process';
import { existsSync, openSync, writeSync, closeSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Write to the user's controlling terminal, even when npm has
 * captured stdout. `/dev/tty` bypasses the pipe that npm set up
 * around our process; if it's not available (Windows, no controlling
 * tty) we fall back to stdout.
 */
function writeToTerminal(text) {
  if (process.platform !== 'win32') {
    try {
      const fd = openSync('/dev/tty', 'w');
      writeSync(fd, text);
      closeSync(fd);
      return;
    } catch { /* no /dev/tty — fall through */ }
  }
  try { process.stdout.write(text); } catch { /* stdout closed */ }
}

try {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Dev tree check — see file header.
  if (existsSync(resolve(__dirname, '..', 'src'))) {
    process.exit(0);
  }

  // ANSI helpers. NO_COLOR opts out (standard env var); otherwise we
  // emit escapes unconditionally since modern terminals and CI log
  // viewers both render them fine.
  const useColor = !process.env.NO_COLOR;
  const c = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  const bold   = (t) => c('1', t);
  const dim    = (t) => c('2', t);
  const green  = (t) => c('32', t);
  const yellow = (t) => c('33', t);
  const cyan   = (t) => c('36', t);

  // Is @anthropic-ai/claude-code present in the global npm root? Best-
  // effort: any failure is treated as "not installed" and surfaces the
  // install hint. Mirrors the runtime check in src/cli.ts so users
  // catch the missing peer up front at install time instead of at
  // first run.
  let hasClaude = false;
  try {
    const root = execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (root) {
      hasClaude = existsSync(resolve(root, '@anthropic-ai/claude-code/cli.js'));
    }
  } catch { /* leave hasClaude = false */ }

  const lines = [];
  lines.push('');
  lines.push(`  ${bold(cyan('cx'))} ${dim('— Claude Code Extensions installed')} ${green('✓')}`);
  lines.push('');

  // Loudest element: the one thing the user should do next. Put it
  // above everything else so it's impossible to miss.
  if (hasClaude) {
    lines.push(`  ${bold(green('▶'))} ${bold('Run')} ${bold(cyan('cx'))} ${bold('to get started')}`);
    lines.push(`    ${dim('opens a one-time setup, then launches Claude Code')}`);
  } else {
    lines.push(`  ${yellow('⚠')}  ${bold('@anthropic-ai/claude-code is not installed globally')}`);
    lines.push(`    ${dim('cx patches it at runtime — install it first, then run cx:')}`);
    lines.push('');
    lines.push(`    ${dim('$')} ${cyan('npm install -g @anthropic-ai/claude-code')}`);
    lines.push(`    ${dim('$')} ${cyan('cx')}`);
  }

  lines.push('');
  lines.push(`  ${dim('Other commands')}`);
  lines.push(`    ${cyan('cx-setup')}   ${dim('reopen the setup TUI later')}`);
  lines.push(`    ${cyan('cx-list')}    ${dim('show enabled patches')}`);
  lines.push('');
  lines.push(`  ${dim('Docs: ')}${cyan('https://cx.worms.coffee')}`);
  lines.push('');

  writeToTerminal(lines.join('\n') + '\n');
} catch {
  /* never fail the install */
}

process.exit(0);
