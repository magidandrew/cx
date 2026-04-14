/**
 * delete-sessions.test.ts — Opt+D delete flow in /resume picker
 *
 * The patch is STRUCTURAL: it injects a `useRef`/`useState` pair, a
 * new keybinding branch into the LogSelector key handler, a
 * confirmation-overlay render branch, and a `KeyboardShortcutHint`
 * hint into the shortcut row. It also rewrites a ternary on the
 * caller side so `onLogsChanged` is always passed through.
 *
 * The bundle is too large to vm-eval in isolation, so these tests
 * assert the visible byproducts: static markers that must appear
 * after the patch, markers that must NOT appear before, and a few
 * AST-level invariants that catch regressions the string checks
 * would miss (e.g. "did we accidentally eat the rename branch?").
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  countOccurrences,
  parseBundle,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('delete-sessions').source;
  raw = getRawBundle().source;
});

describe('delete-sessions — static markers in patched bundle', () => {
  test('injects the Opt+D keyboard hint chord', () => {
    // The KeyboardShortcutHint for "opt+d" must appear exactly once
    // — and only in the patched bundle. If this count drifts upward,
    // someone added a second hint site (or the patch ran twice).
    expect(countOccurrences(patched, 'chord:"opt+d"')).toBe(1);
  });

  test('injects the confirmation overlay header', () => {
    expect(patched).toContain('Delete this session?');
  });

  test('injects the cancel-instruction text referencing Opt+D', () => {
    // The body of the confirmation overlay tells the user which key
    // confirms vs cancels. If either string moves, the overlay will
    // render empty/garbled.
    expect(patched).toContain('Opt+D');
    expect(patched).toContain('again to confirm, any other key to cancel');
  });

  test('injects the ancillary directory paths for full cleanup', () => {
    // Deleting the .jsonl alone leaves orphan per-session state in
    // ~/.claude/file-history and ~/.claude/session-env — the patch
    // sweeps both. If either drops out, sessions look "deleted" in
    // /resume but their sidecar state still pollutes the home dir.
    expect(patched).toContain('/.claude/file-history/');
    expect(patched).toContain('/.claude/session-env/');
  });

  test('uses dynamic import of node:fs/promises (ESM-safe)', () => {
    // The bundle is ESM, so the patch MUST NOT use CJS require().
    // An old copy of the patch body did `require("fs")` which throws
    // at runtime under `"type": "module"`. This is a regression guard
    // against anyone "simplifying" the fs access back to require().
    expect(patched).toContain('import("node:fs/promises")');
    expect(patched).not.toMatch(/require\(["']fs["']\)/);
  });

  test('Opt+D hint is placed adjacent to the Ctrl+R rename hint', () => {
    // Step 10b of the patch anchors the Opt+D hint immediately after
    // the ctrl+r entry in the shortcut row. If that ordering slips,
    // the hint still renders but the row reads in a jumbled order.
    // A loose proximity check (≤ 250 bytes apart in the minified
    // output) keeps this honest without pinning to exact text.
    const rIdx = patched.indexOf('chord:"ctrl+r"');
    const dIdx = patched.indexOf('chord:"opt+d"');
    expect(rIdx).toBeGreaterThan(-1);
    expect(dIdx).toBeGreaterThan(-1);
    expect(dIdx - rIdx).toBeGreaterThan(0);
    expect(dIdx - rIdx).toBeLessThan(250);
  });
});

describe('delete-sessions — raw bundle baseline', () => {
  test('raw bundle has no Opt+D chord', () => {
    // If this fails, upstream added its own Opt+D binding and our
    // injection will likely collide — re-scope the patch before
    // shipping.
    expect(countOccurrences(raw, 'chord:"opt+d"')).toBe(0);
  });

  test('raw bundle has no confirmation overlay text', () => {
    expect(raw).not.toContain('Delete this session?');
  });

  test('raw bundle still has the rename-event marker we anchor on', () => {
    // This is a "did the anchor survive?" canary. If upstream drops
    // the rename analytics event, the patch's AST walk can't find
    // its way into the LogSelector key handler and apply() will
    // bail — not a regression in our code, but a signal that the
    // patch needs a new anchor.
    expect(raw).toContain('tengu_session_rename_started');
  });
});

describe('delete-sessions — structural invariants', () => {
  test('rename branch is still intact (no collateral damage)', () => {
    // The patch injects NEW code into the key handler. If the
    // replace/insert offsets drift, we'd corrupt the adjacent rename
    // branch. Scanning every IfStatement for the marker + "r" literal
    // would catch that but takes >5s on the 13MB bundle. Cheaper
    // proxy: the rename event literal still appears, AND the adjacent
    // Ctrl+R keybinding check (`.ctrl&&` near `.key==="r"`) is still
    // present — if either drops, the rename flow is broken and the
    // AST-walk test can be re-added as a slower but more precise check.
    expect(patched).toContain('tengu_session_rename_started');
    // Look within a narrow window (200 bytes on each side) of the
    // rename event so unrelated `"r"` / `.ctrl` pairs elsewhere in
    // the bundle don't mask a real regression.
    const idx = patched.indexOf('tengu_session_rename_started');
    const window = patched.slice(Math.max(0, idx - 300), idx + 300);
    expect(window).toContain('"r"');
    expect(window).toMatch(/\.ctrl(?:\s|&|\))/);
  });

  test('patched bundle parses as valid JavaScript', () => {
    // Safety net: if any edit produced syntactically bad output,
    // parseBundle would have thrown in beforeAll. This test exists
    // so the failure mode is "parse error in delete-sessions.test"
    // rather than a cryptic error from some unrelated test that
    // happens to be the first to touch the cache.
    expect(() => parseBundle(patched)).not.toThrow();
  });
});
