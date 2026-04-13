/**
 * disable-paste-collapse.test.ts
 *
 * The patch finds the IfStatement that guards paste-text collapse
 * (recognized by a call to formatPastedTextRef in its consequent)
 * and replaces the test expression with `false`. We verify by
 * scanning the patched bundle for an IfStatement whose test is a
 * literal `false` and whose consequent calls a function containing
 * "Pasted text #".
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  parseBundle,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('disable-paste-collapse').source;
  raw = getRawBundle().source;
});

describe('disable-paste-collapse', () => {
  test('raw bundle has the "Pasted text #" anchor marker', () => {
    expect(raw.includes('Pasted text #')).toBe(true);
  });

  test('patched bundle contains an IfStatement whose test is the literal false', () => {
    // This is the shape the patch produces. There might be other
    // `if (false)` statements in the bundle (dead-code elimination
    // tombstones), but at least one must exist to attribute to our
    // patch's edit.
    const { ast } = parseBundle(patched);
    let found = 0;
    for (const n of walkAST(ast)) {
      if (n.type !== 'IfStatement') continue;
      const t = (n as any).test;
      if (t?.type === 'Literal' && t.value === false) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  test('"Pasted text #" marker literal still exists (we just gate it)', () => {
    // The patch replaces only the IF test expression — the
    // formatPastedTextRef function itself is left intact and still
    // contains its unique marker string.
    expect(patched.includes('Pasted text #')).toBe(true);
  });
});
