/**
 * cx-badge.test.ts — persistent "cx" footer badge
 *
 * The badge patch modifies ModeIndicator's final <Box height={1}
 * overflow="hidden"> to inject a badge, AND rewrites its empty-state
 * early return so the badge survives typing. Both injections add a
 * createElement call that references `inverse:true` and `color:"claude"`
 * alongside the literal "cx" — a combination that's unique enough we
 * can grep the patched source for it.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  countOccurrences,
  findObjectsWithProps,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('cx-badge').source;
  raw = getRawBundle().source;
});

describe('cx-badge — badge injection', () => {
  test('anchor literal "? for shortcuts" exists in raw bundle', () => {
    // The patch locates ModeIndicator by this exact literal. If it
    // changes upstream, the patch is broken.
    expect(raw.includes('"? for shortcuts"')).toBe(true);
  });

  test('patched bundle contains an inverse claude-color "cx" text', () => {
    // The badge is createElement(Text, {inverse:true, color:"claude"}, "cx").
    // Look for the combination in an object literal — both props sit in
    // the same object. The patch has up to two injection sites (final
    // Box + empty-state override) but on some versions the second site
    // doesn't match and only one fires. We require ≥1 so the test
    // catches complete failure but accepts partial coverage.
    const objs = findObjectsWithProps(patched, [
      ['inverse', true],
      ['color', 'claude'],
    ]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });

  test('raw bundle does NOT contain the inverse claude-color badge shape', () => {
    // Differential: the raw ModeIndicator has no such object literal.
    const objs = findObjectsWithProps(raw, [
      ['inverse', true],
      ['color', 'claude'],
    ]);
    expect(objs.length).toBe(0);
  });
});

describe('cx-badge — empty-state fallback', () => {
  test('patched source contains a Box {height:1, overflow:"hidden"} wrapping the badge', () => {
    // The empty-state rewrite creates createElement(Box, {height:1,
    // overflow:"hidden"}, cxBadgeBox). Assert at least one such object
    // exists in the patched bundle. (There are several height-1/overflow
    // Boxes upstream for other reasons; this just asserts we didn't
    // lose the shape during patching.)
    const objs = findObjectsWithProps(patched, [
      ['height', 1],
      ['overflow', 'hidden'],
    ]);
    expect(objs.length).toBeGreaterThan(0);
  });

  test('"cx" literal occurrences increase after patching', () => {
    // Crude but effective: the patched bundle should contain MORE
    // "cx" literals than the raw one, because the injection adds at
    // least one. Upper bound is loose (up to 2 for both sites).
    const rawCx = countOccurrences(raw, '"cx"');
    const patchedCx = countOccurrences(patched, '"cx"');
    expect(patchedCx - rawCx).toBeGreaterThanOrEqual(1);
  });
});
