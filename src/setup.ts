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
import { CONFIG_PATH, ensureConfigDir } from './config-path.js';
import type { CxConfig, PatchInfo } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config persistence ────────────────────────────────────────────────────

function loadConfig(): CxConfig {
  if (!existsSync(CONFIG_PATH)) return { patches: {} };
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CxConfig; } catch { return { patches: {} }; }
}

function saveConfig(patches: Record<string, boolean>): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify({ patches }, null, 2) + '\n');
}

// ── Themed groups ────────────────────────────────────────────────────────

interface Group {
  label: string;
  ids: string[];
}

const groups: Group[] = [
  { label: 'Display', ids: [
    'always-show-thinking',
    'session-usage',
    'show-file-in-collapsed-read',
    'disable-paste-collapse',
    'disable-text-truncation',
  ]},
  { label: 'Spinner', ids: [
    // simple-spinner and nsfw-spinner must stay adjacent — they conflict,
    // and the TUI draws a connector glyph between adjacent conflicting rows.
    'simple-spinner', 'nsfw-spinner', 'no-tips',
  ]},
  { label: 'Input', ids: [
    'queue', 'swap-enter-submit', 'cut-to-clipboard', 'reload',
  ]},
  { label: 'Commands', ids: [
    'cd-command', 'cx-resume-commands',
  ]},
  { label: 'Model', ids: [
    'persist-max-effort', 'granular-effort',
  ]},
  { label: 'Quiet mode', ids: [
    'no-feedback', 'no-npm-warning', 'no-attribution', 'disable-telemetry',
  ]},
  { label: 'Remote Control', ids: [
    'remote-control-default-on',
  ]},
  { label: 'Branding', ids: [
    'cx-badge', 'random-clawd',
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

// id → position in allPatchList, for fast lookups in the toggle handler.
const indexById = new Map<string, number>();
allPatchList.forEach((p, i) => indexById.set(p.id, i));

// Bidirectional conflict map. `conflictsWith` in the patch metadata is
// directional at transform time (declarer wins), but in the TUI we treat
// it as mutual exclusion: turning on either side forces the other off,
// since saving both makes no sense — the transform would just drop one.
const conflictMap = new Map<string, Set<string>>();
for (const p of allPatchList) {
  if (!p.conflictsWith?.length) continue;
  for (const other of p.conflictsWith) {
    if (!indexById.has(other)) continue;
    if (!conflictMap.has(p.id)) conflictMap.set(p.id, new Set());
    if (!conflictMap.has(other)) conflictMap.set(other, new Set());
    conflictMap.get(p.id)!.add(other);
    conflictMap.get(other)!.add(p.id);
  }
}

const config = loadConfig();
const states: boolean[] = allPatchList.map(p =>
  config.patches?.[p.id] !== undefined ? config.patches[p.id] : (p.defaultEnabled !== false)
);
// If a stale/hand-edited config has both sides of a conflict enabled,
// drop the loser so the TUI opens in a state the transform would
// actually produce. The declarer wins (matches transform resolution).
for (const p of allPatchList) {
  if (!p.conflictsWith?.length) continue;
  const declarerIdx = indexById.get(p.id);
  if (declarerIdx === undefined || !states[declarerIdx]) continue;
  for (const otherId of p.conflictsWith) {
    const i = indexById.get(otherId);
    if (i !== undefined && states[i]) states[i] = false;
  }
}
let cursor = 0;
let dirty = false;
let resetPending = false;
let firstRunMode = false;
let searchMode = false;
let query = '';

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
const MAGENTA = `${ESC}[35m`;
const CYAN = `${ESC}[36m`;
const WHITE = `${ESC}[37m`;
const BG_HIGHLIGHT = `${ESC}[48;5;236m`;

const maxId = Math.max(...allPatchList.map(p => p.id.length));

// ── Vim-magic search ──────────────────────────────────────────────────────
//
// `/` drops you into a live regex filter that behaves like vim's default
// `magic` mode:
//   .  *  ^  $  [ ]           → metacharacters (same as JS)
//   \( \) \+ \? \| \{ \} \= → metacharacters (mapped to JS counterparts)
//   ( ) + ? | { }             → literal, auto-escaped for JS
//   \< \>                      → word boundary (JS `\b`)
//   everything else            → literal
// The pattern is compiled once per keystroke, cached into `queryRegex`,
// and tested against each patch's id, name, and description. If the
// in-flight pattern is not yet a valid regex (e.g. user typed `\(` but
// hasn't closed the group), we fall back to a literal substring match
// so the list doesn't blink to empty mid-typing. Match is case-insensitive.

let queryRegex: RegExp | null = null;

function vimMagicToJsRegex(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      // Vim meta sequences → JS meta
      if ('()+?|{}'.includes(next)) { out += next; i++; continue; }
      if (next === '<' || next === '>') { out += '\\b'; i++; continue; }
      if (next === '=') { out += '?'; i++; continue; }
      // Pass through (\s, \d, \w, \., \\, etc.)
      out += '\\' + next;
      i++;
      continue;
    }
    // Unescaped literals that are JS metas need escaping
    if ('()+?|{}'.includes(c)) { out += '\\' + c; continue; }
    out += c;
  }
  return out;
}

/** Update the cached regex from the current `query`. Falls back to a
 *  literal substring match on any parse error. */
function setQuery(next: string): void {
  query = next;
  if (!next) { queryRegex = null; return; }
  try {
    queryRegex = new RegExp(vimMagicToJsRegex(next), 'i');
  } catch {
    const literal = next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { queryRegex = new RegExp(literal, 'i'); }
    catch { queryRegex = null; }
  }
}

/** Is patch index `i` visible under the current query? */
function isVisible(i: number): boolean {
  if (!queryRegex) return true;
  const p = allPatchList[i];
  return queryRegex.test(p.id) || queryRegex.test(p.name) || queryRegex.test(p.description);
}

/** If cursor is on a filtered-out row, slide it to the nearest visible one. */
function ensureCursorVisible(): void {
  if (allPatchList.length === 0 || isVisible(cursor)) return;
  for (let i = cursor + 1; i < allPatchList.length; i++) {
    if (isVisible(i)) { cursor = i; return; }
  }
  for (let i = cursor - 1; i >= 0; i--) {
    if (isVisible(i)) { cursor = i; return; }
  }
}

/** Gutter glyph showing that row i is linked to an adjacent conflicting
 *  row as a mutex pair. Only draws when the partner is immediately adjacent,
 *  in the same section, and currently visible — otherwise the line would
 *  dangle toward nothing. */
function conflictGlyph(i: number): string {
  const conflicts = conflictMap.get(allPatchList[i].id);
  if (!conflicts) return ' ';
  const above = i > 0 && !sectionStarts[i] && isVisible(i - 1) ? i - 1 : -1;
  const below = i < allPatchList.length - 1 && !sectionStarts[i + 1] && isVisible(i + 1) ? i + 1 : -1;
  const linkAbove = above >= 0 && conflicts.has(allPatchList[above].id);
  const linkBelow = below >= 0 && conflicts.has(allPatchList[below].id);
  if (linkAbove && linkBelow) return '│';
  if (linkBelow) return '╮';
  if (linkAbove) return '╯';
  return ' ';
}

// Render layout — three regions composed at draw time:
//
//   ┌─ header (fixed) ──────────────┐   never scrolls
//   │  cx setup — …                 │
//   ├─ body (scrollable) ───────────┤   patch list; scrolls with ↑/↓more
//   │  Display                      │
//   │  > ✔  patch-id     description│
//   │    ○  patch-id     description│
//   │  …                            │
//   ├─ footer (fixed) ──────────────┤   always visible so the user
//   │  14/27 enabled  ●unsaved      │   can see the keybindings even
//   │  [↑↓] nav  [space] toggle  …  │   while the patch list overflows
//   └───────────────────────────────┘
//
// When body fits: render header + body + footer naturally.
// When body overflows: allocate `rows - header - footer - 2` lines for
// the body window, reserve 1 line each for ↑more/↓more indicators, and
// pad the body window with empty strings if it's shorter than allocated
// so the footer stays glued to the terminal's bottom row.

function buildHeader(): string[] {
  const out: string[] = [''];
  if (firstRunMode) {
    out.push(`  ${BOLD}${CYAN}Welcome to cx${RESET}  ${DIM}— Claude Code Extensions${RESET}`);
    out.push(`  ${DIM}These patches will be applied to Claude Code at runtime.${RESET}`);
    out.push(`  ${DIM}Toggle with ${RESET}${BOLD}space${RESET}${DIM}, then ${RESET}${BOLD}enter${RESET}${DIM} to save — or ${RESET}${BOLD}enter${RESET}${DIM} now for defaults.${RESET}`);
    out.push(`  ${DIM}You can re-run this anytime with ${RESET}${BOLD}cx setup${RESET}${DIM}.${RESET}`);
  } else {
    out.push(`  ${BOLD}${CYAN}cx setup${RESET}  ${DIM}— toggle Claude Code patches on/off${RESET}`);
  }
  return out;
}

function buildBody(cols: number): { body: string[]; patchLineIndex: number[]; visibleCount: number } {
  const body: string[] = [];
  const patchLineIndex: number[] = [];
  // Max description width. The patch line prefix is `8 + maxId` visible
  // chars (2 pointer + 1 checkbox + 1 space + 1 glyph + 1 space + id +
  // 2 pad), leaving the rest for the description. Truncate with an
  // ellipsis so lines never wrap — if they wrapped, each array entry
  // would take >1 visual row and the scroll math (which assumes 1:1)
  // would be wrong.
  const maxDescWidth = Math.max(10, cols - (8 + maxId) - 1);

  // Section headers are deferred until at least one visible patch
  // follows them, so filtering doesn't leave empty-section labels
  // stranded.
  let pendingSection: string | null = null;
  let visibleCount = 0;
  for (let i = 0; i < allPatchList.length; i++) {
    if (sectionStarts[i]) pendingSection = sectionStarts[i];
    if (!isVisible(i)) continue;

    if (pendingSection) {
      // Blank separator between sections — but not before the first one,
      // so body[0] is the first section label (header provides the blank
      // line that sits above it).
      if (body.length > 0) body.push('');
      body.push(`  ${DIM}${pendingSection}${RESET}`);
      pendingSection = null;
    }

    const p = allPatchList[i];
    const on = states[i];
    const sel = i === cursor;

    const bg = sel ? BG_HIGHLIGHT : '';
    const pointer = sel ? `${bg}${WHITE}> ` : `${bg}  `;
    const checkbox = on ? `${GREEN}✔${RESET}${bg}` : `${DIM}○${RESET}${bg}`;
    const name = sel ? `${BOLD}${WHITE}${p.id}${RESET}${bg}` : p.id;
    const pad = ' '.repeat(maxId - p.id.length + 2);
    // Conflict gutter — 1 visible char between checkbox and name.
    // Drawn in the same column on every row so conflict rows are
    // visually linked by a continuous line segment.
    const glyphChar = conflictGlyph(i);
    const glyphPart = glyphChar === ' ' ? ' ' : `${DIM}${glyphChar}${RESET}${bg}`;
    // Tag is rendered in the description column; its visible width
    // eats into the description budget so long descriptions still
    // truncate before wrapping.
    const tagText = p.tag ? `[${p.tag}] ` : '';
    const descBudget = Math.max(10, maxDescWidth - tagText.length);
    const descText = p.description.length > descBudget
      ? p.description.slice(0, Math.max(1, descBudget - 1)) + '…'
      : p.description;
    const tagPart = p.tag ? `${MAGENTA}${tagText}${RESET}${bg}` : '';
    const desc = `${tagPart}${DIM}${descText}${RESET}`;

    patchLineIndex[i] = body.length;
    body.push(`${pointer}${checkbox} ${glyphPart} ${name}${pad}${desc}${RESET}`);
    visibleCount++;
  }

  if (visibleCount === 0 && query) {
    body.push('');
    body.push(`  ${DIM}no patches match "${query}"${RESET}`);
  }

  return { body, patchLineIndex, visibleCount };
}

function buildFooter(): string[] {
  const out: string[] = [''];

  // Status line: enabled count + unsaved marker + active filter.
  // Always rendered (even when empty extras) so footer height stays
  // constant across renders — keeps the scroll math simple.
  const enabledCount = states.filter(Boolean).length;
  const parts: string[] = [`${DIM}${enabledCount}/${allPatchList.length} enabled${RESET}`];
  if (dirty) parts.push(`${YELLOW}● unsaved${RESET}`);
  if (query && !searchMode) parts.push(`${CYAN}/${query}${RESET}`);
  out.push(`  ${parts.join(`  ${DIM}·${RESET}  `)}`);

  // Keybinding bar — the whole point of pinning the footer. Rendered
  // in bracket-hint style so new users can tell at a glance which
  // keys do what without having to hunt for documentation.
  if (searchMode) {
    out.push(`  ${CYAN}find:${RESET} ${query}${DIM}█${RESET}    ${DIM}[${RESET}↑↓${DIM}]${RESET} nav  ${DIM}[${RESET}space${DIM}]${RESET} toggle  ${DIM}[${RESET}enter${DIM}]${RESET} save  ${DIM}[${RESET}esc${DIM}]${RESET} exit find`);
  } else if (resetPending) {
    out.push(`  ${YELLOW}Press r again to reset all patches to their defaults${RESET}`);
  } else {
    out.push(`  ${DIM}[${RESET}↑↓${DIM}]${RESET} nav  ${DIM}[${RESET}space${DIM}]${RESET} toggle  ${DIM}[${RESET}/${DIM}]${RESET} find  ${DIM}[${RESET}r${DIM}]${RESET} reset  ${DIM}[${RESET}enter${DIM}]${RESET} save  ${DIM}[${RESET}esc${DIM}]${RESET} cancel`);
  }

  return out;
}

function render(): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;

  const header = buildHeader();
  const { body, patchLineIndex } = buildBody(cols);
  const footer = buildFooter();

  const prefix = CLEAR + HIDE_CURSOR;

  // No trailing newline below — if content ends exactly on the bottom
  // row, a final `\n` triggers a 1-line scroll and pushes the top
  // line (including the `↑ more` indicator) out of view.

  const availableForBody = Math.max(1, rows - header.length - footer.length);

  // ── Fit mode ─────────────────────────────────────────────
  // Body fits without scroll — render naturally. Footer lands
  // right after the last body row and stays visible because
  // the whole render is shorter than `rows`.
  if (body.length <= availableForBody) {
    process.stdout.write(prefix + [...header, ...body, ...footer].join('\n'));
    return;
  }

  // ── Scroll mode ──────────────────────────────────────────
  // Body overflows. Reserve 2 lines inside the body region for
  // ↑more/↓more indicators, then slice a window of the body
  // around the cursor. Pad the window to exactly `bodyRows`
  // lines so the footer stays glued to the bottom of the
  // terminal — this is the whole reason the keybinding bar
  // stays visible regardless of patch count.
  const indicatorRows = 2;
  const bodyRows = Math.max(1, availableForBody - indicatorRows);

  const target = patchLineIndex[cursor] ?? 0;
  const maxScrollTop = Math.max(0, body.length - bodyRows);
  let scrollTop = Math.max(0, target - Math.floor(bodyRows / 2));
  scrollTop = Math.min(scrollTop, maxScrollTop);

  const windowContent = body.slice(scrollTop, scrollTop + bodyRows);
  while (windowContent.length < bodyRows) windowContent.push('');

  const topInd = scrollTop > 0 ? `  ${DIM}↑ more${RESET}` : '';
  const botInd = scrollTop + bodyRows < body.length ? `  ${DIM}↓ more${RESET}` : '';

  // Exactly `rows` lines (header + 1 + bodyRows + 1 + footer = rows)
  // joined by `rows - 1` newlines.
  process.stdout.write(
    prefix + [...header, topInd, ...windowContent, botInd, ...footer].join('\n')
  );
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
      // Ctrl+C — always quits, regardless of mode
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

      // ── Keys that work the same in both modes ──────────────
      // Arrows, Space, and Enter stay live inside find mode so
      // there's no "commit" step — the filter just sits on top
      // of normal navigation.

      // Arrow up — previous visible row
      if (key === '\x1b[A') {
        for (let i = cursor - 1; i >= 0; i--) {
          if (isVisible(i)) { cursor = i; break; }
        }
        if (resetPending) resetPending = false;
        render();
        return;
      }

      // Arrow down — next visible row
      if (key === '\x1b[B') {
        for (let i = cursor + 1; i < allPatchList.length; i++) {
          if (isVisible(i)) { cursor = i; break; }
        }
        if (resetPending) resetPending = false;
        render();
        return;
      }

      // Space — toggle current visible row. When turning a patch ON,
      // also turn OFF anything it conflicts with so the user never
      // sees both sides of a mutual-exclusion pair enabled.
      if (key === ' ') {
        if (isVisible(cursor)) {
          const turningOn = !states[cursor];
          states[cursor] = turningOn;
          dirty = true;
          if (turningOn) {
            const partners = conflictMap.get(allPatchList[cursor].id);
            if (partners) {
              for (const otherId of partners) {
                const i = indexById.get(otherId);
                if (i !== undefined && states[i]) states[i] = false;
              }
            }
          }
        }
        if (resetPending) resetPending = false;
        render();
        return;
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

        console.log(`  ${GREEN}✔${RESET} Config saved to ~/.config/cx/patches.json\n`);
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

      // ── Find mode ──────────────────────────────────────────
      // Printable keys become query input. Backspace edits the
      // query. Esc drops out of find mode and clears the filter —
      // a second Esc (in normal mode) exits the app.
      if (searchMode) {
        if (key === '\x1b') {
          searchMode = false;
          setQuery('');
          render();
          return;
        }
        if (key === '\x7f' || key === '\b') {
          setQuery(query.slice(0, -1));
          ensureCursorVisible();
          render();
          return;
        }
        // Printable ASCII — append to query
        if (key.length === 1 && key >= ' ' && key <= '~') {
          setQuery(query + key);
          ensureCursorVisible();
          render();
          return;
        }
        // Ignore unhandled escape sequences while filtering
        return;
      }

      // ── Normal mode ────────────────────────────────────────

      // / — enter find mode
      if (key === '/') {
        searchMode = true;
        render();
        return;
      }

      // ESC / q — quit
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

      // k — prev visible row (vim-style, normal mode only so j/k
      // stay available as search characters inside find mode)
      if (key === 'k') {
        for (let i = cursor - 1; i >= 0; i--) {
          if (isVisible(i)) { cursor = i; break; }
        }
      }

      // j — next visible row
      if (key === 'j') {
        for (let i = cursor + 1; i < allPatchList.length; i++) {
          if (isVisible(i)) { cursor = i; break; }
        }
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
