/**
 * Interactive patch configurator.
 * Toggle patches on/off with a keyboard-driven TUI.
 *
 * Called by `cx setup` — not meant to be run directly.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listPatches } from './transform.js';
import type { CxConfig, PatchInfo } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', '.cx-patches.json');

// ── Config persistence ────────────────────────────────────────────────────

function loadConfig(): CxConfig {
  if (!existsSync(CONFIG_PATH)) return { patches: {} };
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CxConfig; } catch { return { patches: {} }; }
}

function saveConfig(patches: Record<string, boolean>): void {
  writeFileSync(CONFIG_PATH, JSON.stringify({ patches }, null, 2) + '\n');
}

// ── Themed groups ────────────────────────────────────────────────────────

interface Group {
  label: string;
  ids: string[];
}

const groups: Group[] = [
  { label: 'Display', ids: [
    'always-show-thinking', 'disable-paste-collapse',
    'show-file-in-collapsed-read', 'cx-badge',
    'cx-resume-commands', 'random-clawd', 'session-timer',
  ]},
  { label: 'Input', ids: [
    'queue', 'swap-enter-submit', 'reload',
  ]},
  { label: 'Spinner', ids: [
    'no-tips', 'simple-spinner',
  ]},
  { label: 'Behavior', ids: [
    'persist-max-effort', 'no-npm-warning', 'no-feedback',
  ]},
];

// ── State ─────────────────────────────────────────────────────────────────

const patchMap = new Map<string, PatchInfo>(listPatches().map(p => [p.id, p]));

// Patches that are always on and should not appear in the setup TUI
const hidden = new Set(['banner']);

// Build ordered list from groups, append any ungrouped patches at the end
const groupedIds = new Set(groups.flatMap(g => g.ids));
const ungrouped = listPatches().filter(p => !groupedIds.has(p.id) && !hidden.has(p.id));
if (ungrouped.length) groups.push({ label: 'Other', ids: ungrouped.map(p => p.id) });

const allPatchList: PatchInfo[] = groups.flatMap(g => g.ids.map(id => patchMap.get(id)).filter((p): p is PatchInfo => !!p));
// sectionStarts[i] = label if patch i starts a new section
const sectionStarts: Record<number, string> = {};
let idx = 0;
for (const g of groups) {
  const valid = g.ids.filter(id => patchMap.has(id));
  if (valid.length) { sectionStarts[idx] = g.label; idx += valid.length; }
}

const config = loadConfig();
const states: boolean[] = allPatchList.map(p =>
  config.patches?.[p.id] !== undefined ? config.patches[p.id] : (p.defaultEnabled !== false)
);
let cursor = 0;
let dirty = false;
let resetPending = false;
let firstRunMode = false;

// ── Rendering ─────────────────────────────────────────────────────────────

const ESC = '\x1b';
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const WHITE = `${ESC}[37m`;
const BG_HIGHLIGHT = `${ESC}[48;5;236m`;

const maxId = Math.max(...allPatchList.map(p => p.id.length));

function render(): void {
  const rows = process.stdout.rows || 24;
  const lines: string[] = [];
  const patchLineIndex: number[] = [];

  // Header
  lines.push('');
  if (firstRunMode) {
    lines.push(`  ${BOLD}${CYAN}Welcome to cx${RESET}  ${DIM}— Claude Code Extensions${RESET}`);
    lines.push(`  ${DIM}These patches will be applied to Claude Code at runtime.${RESET}`);
    lines.push(`  ${DIM}Press Enter to proceed with defaults, or toggle patches with Space.${RESET}`);
    lines.push(`  ${DIM}You can always change this later by running ${RESET}${BOLD}cx setup${RESET}${DIM}.${RESET}`);
  } else {
    lines.push(`  ${BOLD}${CYAN}cx setup${RESET}  ${DIM}— toggle patches on/off${RESET}`);
  }

  // Patch list with section headers
  for (let i = 0; i < allPatchList.length; i++) {
    if (sectionStarts[i]) {
      lines.push('');
      lines.push(`  ${DIM}${sectionStarts[i]}${RESET}`);
    }

    const p = allPatchList[i];
    const on = states[i];
    const sel = i === cursor;

    const bg = sel ? BG_HIGHLIGHT : '';
    const pointer = sel ? `${bg}${WHITE}> ` : `${bg}  `;
    const checkbox = on ? `${GREEN}✔${RESET}${bg}` : `${DIM}○${RESET}${bg}`;
    const name = sel ? `${BOLD}${WHITE}${p.id}${RESET}${bg}` : p.id;
    const pad = ' '.repeat(maxId - p.id.length + 2);
    const desc = `${DIM}${p.description}${RESET}`;

    patchLineIndex[i] = lines.length;
    lines.push(`${pointer}${checkbox} ${name}${pad}${desc}${RESET}`);
  }

  // Footer
  lines.push('');
  if (resetPending) {
    lines.push(`  ${YELLOW}Press r again to reset all patches to defaults${RESET}`);
  } else {
    let footer = `  ${DIM}↑↓${RESET} navigate  ${DIM}space${RESET} toggle  ${DIM}r${RESET} reset  ${DIM}enter${RESET} save  ${DIM}esc${RESET} cancel`;
    if (dirty) {
      footer += `    ${YELLOW}● unsaved${RESET}`;
    }
    lines.push(footer);
  }

  const prefix = CLEAR + HIDE_CURSOR;

  // Everything fits — render as-is
  if (lines.length <= rows) {
    process.stdout.write(prefix + lines.join('\n') + '\n');
    return;
  }

  // Scrolling — reserve 2 lines for indicators
  const usable = Math.max(1, rows - 2);
  const target = patchLineIndex[cursor];
  let scrollTop = Math.max(0, target - Math.floor(usable / 2));
  scrollTop = Math.min(scrollTop, lines.length - usable);

  const visible = lines.slice(scrollTop, scrollTop + usable);
  const top = scrollTop > 0 ? `  ${DIM}↑ more${RESET}` : '';
  const bottom = scrollTop + usable < lines.length ? `  ${DIM}↓ more${RESET}` : '';

  process.stdout.write(prefix + top + '\n' + visible.join('\n') + '\n' + bottom + '\n');
}

// ── Input handling ────────────────────────────────────────────────────────

function cleanup(): void {
  process.stdout.write(SHOW_CURSOR + CLEAR);
  process.stdout.removeListener('resize', render);
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

export interface SetupOptions {
  /** When true, show a welcome header and return instead of exiting. */
  firstRun?: boolean;
}

export default function setup(opts?: SetupOptions): Promise<void> {
  const isFirstRun = opts?.firstRun ?? false;
  firstRunMode = isFirstRun;

  if (!process.stdin.isTTY) {
    console.error('cx setup requires an interactive terminal.');
    process.exit(1);
  }

  return new Promise<void>((resolveSetup) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdout.on('resize', render);
    render();

    const onKey = (key: string) => {
      // Ctrl+C
      if (key === '\x03') {
        cleanup();
        if (isFirstRun) {
          // Save defaults and continue
          const patches: Record<string, boolean> = {};
          for (let i = 0; i < allPatchList.length; i++) {
            patches[allPatchList[i].id] = states[i];
          }
          saveConfig(patches);
          done();
          return;
        }
        process.exit(0);
      }

      // ESC
      if (key === '\x1b' || key === 'q') {
        cleanup();
        if (isFirstRun) {
          // Save defaults and continue
          const patches: Record<string, boolean> = {};
          for (let i = 0; i < allPatchList.length; i++) {
            patches[allPatchList[i].id] = states[i];
          }
          saveConfig(patches);
          console.log(`  ${DIM}Using default patches.${RESET}\n`);
          done();
          return;
        }
        console.log('  Cancelled — no changes saved.\n');
        process.exit(0);
      }

      // Reset to defaults (two-press confirmation)
      if (key === 'r') {
        if (resetPending) {
          // Second press — perform the reset
          for (let i = 0; i < allPatchList.length; i++) {
            states[i] = allPatchList[i].defaultEnabled !== false;
          }
          dirty = true;
          resetPending = false;
        } else {
          // First press — enter pending state
          resetPending = true;
        }
        render();
        return;
      }

      // Any other key cancels a pending reset
      if (resetPending) {
        resetPending = false;
      }

      // Arrow up / k
      if (key === '\x1b[A' || key === 'k') {
        cursor = Math.max(0, cursor - 1);
      }

      // Arrow down / j
      if (key === '\x1b[B' || key === 'j') {
        cursor = Math.min(allPatchList.length - 1, cursor + 1);
      }

      // Space — toggle
      if (key === ' ') {
        states[cursor] = !states[cursor];
        dirty = true;
      }

      // Enter — save and exit
      if (key === '\r' || key === '\n') {
        const patches: Record<string, boolean> = {};
        for (let i = 0; i < allPatchList.length; i++) {
          patches[allPatchList[i].id] = states[i];
        }
        saveConfig(patches);
        cleanup();

        // Delete cache so next run re-transforms
        try { rmSync(resolve(__dirname, '..', '.cache'), { recursive: true, force: true }); } catch { /* ok */ }

        console.log(`  ${GREEN}✔${RESET} Config saved to .cx-patches.json\n`);
        const enabled = allPatchList.filter((_, i) => states[i]).map(p => p.id);
        const disabled = allPatchList.filter((_, i) => !states[i]).map(p => p.id);
        if (enabled.length) console.log(`  ${GREEN}enabled${RESET}  ${enabled.join(', ')}`);
        if (disabled.length) console.log(`  ${DIM}disabled${RESET} ${disabled.join(', ')}`);

        if (isFirstRun) {
          console.log('');
          done();
          return;
        }
        console.log(`\n  Run ${BOLD}cx${RESET} to start with these patches.\n`);
        process.exit(0);
      }

      render();
    };

    process.stdin.on('data', onKey);

    function done(): void {
      process.stdin.removeListener('data', onKey);
      resolveSetup();
    }
  });
}
