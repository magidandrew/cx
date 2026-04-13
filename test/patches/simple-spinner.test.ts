/**
 * simple-spinner.test.ts — SPINNER_VERBS / TURN_COMPLETION_VERBS replaced
 *
 * Both arrays are overwritten wholesale with single-element arrays.
 * We verify by searching the patched bundle for the two tiny replacement
 * arrays as structural AST nodes — this is more robust than grep because
 * minification can place them next to unrelated string-array literals.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findArraysStartingWith,
  findLiterals,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('simple-spinner').source;
  raw = getRawBundle().source;
});

describe('simple-spinner — spinner verbs', () => {
  test('raw bundle has the large SPINNER_VERBS array ("Accomplishing","Actioning"…)', () => {
    const hits = findArraysStartingWith(raw, ['Accomplishing', 'Actioning']);
    expect(hits.length).toBe(1);
    expect(hits[0].elements.length).toBeGreaterThan(5);
  });

  test('patched bundle no longer has a ["Accomplishing","Actioning"…] array', () => {
    const hits = findArraysStartingWith(patched, ['Accomplishing', 'Actioning']);
    expect(hits.length).toBe(0);
  });

  test('patched bundle has a ["Working"] array where SPINNER_VERBS used to be', () => {
    const hits = findArraysStartingWith(patched, ['Working']);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // At least one such array should be a 1-element array — the
    // replaced SPINNER_VERBS.
    const single = hits.filter(h => h.elements.length === 1);
    expect(single.length).toBeGreaterThanOrEqual(1);
  });
});

describe('simple-spinner — completion verbs', () => {
  test('raw bundle has the TURN_COMPLETION_VERBS array ("Baked","Brewed"…)', () => {
    const hits = findArraysStartingWith(raw, ['Baked', 'Brewed']);
    expect(hits.length).toBe(1);
  });

  test('patched bundle no longer has the Baked/Brewed array', () => {
    const hits = findArraysStartingWith(patched, ['Baked', 'Brewed']);
    expect(hits.length).toBe(0);
  });

  test('patched bundle has a ["Worked"] array', () => {
    const hits = findArraysStartingWith(patched, ['Worked']);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
