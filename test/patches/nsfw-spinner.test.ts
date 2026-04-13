/**
 * nsfw-spinner.test.ts — SPINNER_VERBS replaced with NSFW array
 *
 * Conflicts with simple-spinner (and is default-off) so we test it in
 * isolation.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  findArraysStartingWith,
} from '../harness/index.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('nsfw-spinner').source;
});

describe('nsfw-spinner', () => {
  test('patched bundle has the NSFW verb array starting with "Gooning"', () => {
    const hits = findArraysStartingWith(patched, ['Gooning']);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle no longer has the original Accomplishing/Actioning array', () => {
    const hits = findArraysStartingWith(patched, ['Accomplishing', 'Actioning']);
    expect(hits.length).toBe(0);
  });

  test('the replacement array has many elements (not a single-verb stub)', () => {
    // Guards against a regression where the replacement JSON.stringify
    // somehow produces an empty or near-empty array.
    const hits = findArraysStartingWith(patched, ['Gooning']);
    expect(hits[0]?.elements.length).toBeGreaterThan(10);
  });
});
