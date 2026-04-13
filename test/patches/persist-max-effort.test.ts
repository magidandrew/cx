/**
 * persist-max-effort.test.ts
 *
 * The patch has a strong behavioral signature we can test directly:
 *
 *  1. toPersistableEffort("max") must return "max" after the patch,
 *     not undefined. We extract the function and call it.
 *
 *  2. Every ["low","medium","high"] array in the bundle (Zod schema,
 *     EFFORT_LEVELS) gets extended to ["low","medium","high","max"].
 *     We count these before and after.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  findFunctionContaining,
  findArraysStartingWith,
  evalFunction,
} from '../harness/index.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('persist-max-effort').source;
  raw = getRawBundle().source;
});

// Locate toPersistableEffort in a source string. Anchor is the unique
// `q === "low" || q === "medium" || q === "high"` (±"max") LogicalExpression.
function findToPersistableEffort(
  source: string,
  includeMax: boolean,
): (s: any) => any {
  const fn = findFunctionContaining(source, n => {
    if (n.type !== 'LogicalExpression' || (n as any).operator !== '||') return false;
    const vals: any[] = [];
    let cur: any = n;
    while (cur?.type === 'LogicalExpression' && cur.operator === '||') {
      if (cur.right?.type !== 'BinaryExpression' || cur.right.right?.type !== 'Literal') {
        return false;
      }
      vals.unshift(cur.right.right.value);
      cur = cur.left;
    }
    if (cur?.type !== 'BinaryExpression' || cur.right?.type !== 'Literal') return false;
    vals.unshift(cur.right.value);
    if (includeMax) {
      return (
        vals.length === 4 &&
        vals[0] === 'low' &&
        vals[1] === 'medium' &&
        vals[2] === 'high' &&
        vals[3] === 'max'
      );
    }
    return (
      vals.length === 3 &&
      vals[0] === 'low' &&
      vals[1] === 'medium' &&
      vals[2] === 'high'
    );
  });
  return evalFunction(source, fn);
}

describe('persist-max-effort — toPersistableEffort', () => {
  test('raw bundle drops "max" (returns undefined)', () => {
    const fn = findToPersistableEffort(raw, false);
    expect(fn('low')).toBe('low');
    expect(fn('medium')).toBe('medium');
    expect(fn('high')).toBe('high');
    expect(fn('max')).toBeUndefined();
  });

  test('patched bundle preserves "max"', () => {
    const fn = findToPersistableEffort(patched, true);
    expect(fn('low')).toBe('low');
    expect(fn('medium')).toBe('medium');
    expect(fn('high')).toBe('high');
    expect(fn('max')).toBe('max');
    expect(fn('garbage')).toBeUndefined();
  });
});

describe('persist-max-effort — EFFORT_LEVELS / Zod enum arrays', () => {
  test('raw bundle has ["low","medium","high"] arrays (no max)', () => {
    const rawLows = findArraysStartingWith(raw, ['low', 'medium', 'high']);
    // Filter down to exactly 3-element arrays so we don't count
    // accidentally-patched variants during the differential.
    const threes = rawLows.filter(a => a.elements.length === 3);
    expect(threes.length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle has at least one ["low","medium","high","max"] array', () => {
    const patchedFours = findArraysStartingWith(patched, ['low', 'medium', 'high', 'max']);
    expect(patchedFours.length).toBeGreaterThanOrEqual(1);
  });

  test('patched bundle has fewer 3-element ["low","medium","high"] arrays than the raw', () => {
    // Each 3-element array becomes a 4-element array after the patch
    // inserts "max" into it. The 3-element count should drop.
    const rawThrees = findArraysStartingWith(raw, ['low', 'medium', 'high'])
      .filter(a => a.elements.length === 3).length;
    const patchedThrees = findArraysStartingWith(patched, ['low', 'medium', 'high'])
      .filter(a => a.elements.length === 3).length;
    expect(patchedThrees).toBeLessThan(rawThrees);
  });
});
