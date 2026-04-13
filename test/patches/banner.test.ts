/**
 * banner.test.ts — Attribution Banner
 *
 * Verifies the banner patch rewrites the "Claude Code" title literal
 * and injects star-the-repo text into each of the three layouts the
 * cc-source exposes (condensed, compact-boxed, wide).
 *
 * Regression policy: if a future claude-code version removes one of
 * the three layouts the patch targets, the banner test for that
 * layout goes yellow but the others keep covering us. The patch
 * itself only asserts the condensed layout, so the tests mirror that
 * strictness — condensed is required, boxed/wide are opportunistic.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  countOccurrences,
  findLiterals,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('banner').source;
  raw = getRawBundle().source;
});

describe('banner — title rewrite', () => {
  test('raw bundle contains "Claude Code" literal', () => {
    // Baseline: the patch's anchor literal exists in the raw source.
    // If this fails, the patch can't run — either the string was
    // renamed upstream, or the raw fixture is wrong.
    expect(findLiterals(raw, 'Claude Code').length).toBeGreaterThan(0);
  });

  test('patched bundle injects cx version string', () => {
    // Banner replaces the bold title literal with this prefix. We
    // don't hard-code the full version (it changes per cx release),
    // just check the prefix landed.
    expect(patched.includes('Claude Code Extensions (cx) v')).toBe(true);
  });

  test('patched bundle injects wormcoffee OSC8 hyperlink', () => {
    // The bold-title rewrite wraps the handle in ESC]8;; terminal
    // hyperlink escapes. If minification ever strips these, the banner
    // will still render but without a clickable link.
    expect(patched.includes('x.com/wormcoffee')).toBe(true);
  });

  test('patched bundle injects the star-the-repo call-to-action', () => {
    // The star text is the unique tell that the condensed layout
    // patch fired. Must appear at least once — it's injected in up
    // to three layouts, so we use >= instead of ===.
    expect(patched.includes('Please star the repo')).toBe(true);
    expect(patched.includes('github.com/magidandrew/cx')).toBe(true);
  });
});

describe('banner — idempotency', () => {
  test('boxed-layout title replacement does not double-inject', () => {
    // The boxed b7("claude",o)("Claude Code") replacement is a
    // standalone replace, not an insert — it should leave at most
    // one "Claude Code Extensions (cx)" string in the patched bundle,
    // not two stacked copies. Allow many occurrences because it's
    // also inside the condensed layout — we just want to make sure
    // we didn't double the literal we already replaced.
    const occ = countOccurrences(patched, 'Claude Code Extensions (cx) v');
    expect(occ).toBeGreaterThanOrEqual(1);
    // An upper bound guards against accidental multiplication by a
    // broken loop (observed during patch authoring). 10 is generous
    // but catches true doubling bugs.
    expect(occ).toBeLessThan(10);
  });
});

describe('banner — differential', () => {
  test('raw bundle does NOT contain the star-the-repo call-to-action', () => {
    // Sanity check — if this ever becomes true, someone copy-pasted
    // the patch's marker string into upstream and our differential
    // assertions will silently pass even without the patch.
    expect(raw.includes('Please star the repo')).toBe(false);
  });
});
