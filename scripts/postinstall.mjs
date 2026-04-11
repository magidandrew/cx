#!/usr/bin/env node
/**
 * Post-install banner — prints the available commands and checks that
 * @anthropic-ai/claude-code is installed globally (cx patches it at
 * runtime, so it's a hard requirement).
 *
 * Best-effort: any failure here must not fail the install. Every path
 * is wrapped in try/catch and we always exit 0.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

try {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Skip when running from the cx dev repo — the presence of `src/` next
  // to this script means we're sitting in the source tree, not an
  // installed package, so the banner would just be noise for every
  // `npm install` during development.
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
  lines.push(`  ${bold(cyan('cx'))} ${dim('— Claude Code Extensions installed')}`);
  lines.push('');
  lines.push(`  ${bold('Commands')}`);
  lines.push(`    ${cyan('cx')}           ${dim('launch patched Claude Code (all claude args pass through)')}`);
  lines.push(`    ${cyan('cx-setup')}     ${dim('interactive TUI to toggle patches on/off')}`);
  lines.push(`    ${cyan('cx-list')}      ${dim('print the enabled/disabled patch list')}`);
  lines.push('');
  lines.push(`  ${bold('Quick start')}`);
  lines.push(`    ${dim('$')} ${cyan('cx')}                     ${dim('# first run opens setup, then launches claude')}`);
  lines.push(`    ${dim('$')} ${cyan('cx --model sonnet')}      ${dim('# flags pass through to claude')}`);
  lines.push('');

  if (hasClaude) {
    lines.push(`  ${green('✔')} ${dim('@anthropic-ai/claude-code detected in global npm root')}`);
  } else {
    lines.push(`  ${yellow('⚠')}  ${bold('@anthropic-ai/claude-code is not installed globally')}`);
    lines.push(`    ${dim('cx patches it at runtime, so you need it on your PATH. Install it with:')}`);
    lines.push('');
    lines.push(`    ${dim('$')} ${cyan('npm install -g @anthropic-ai/claude-code')}`);
  }

  lines.push('');
  lines.push(`  ${dim('Docs: ')}${cyan('https://cx.worms.coffee')}`);
  lines.push('');

  try {
    process.stdout.write(lines.join('\n') + '\n');
  } catch { /* stdout closed — ignore */ }
} catch {
  /* never fail the install */
}

process.exit(0);
