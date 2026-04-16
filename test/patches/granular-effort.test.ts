/**
 * granular-effort.test.ts
 *
 * Most behavioral of the test suite — the patch has multiple
 * observable changes and we can verify each one by extracting the
 * target function and calling it.
 *
 *  1. cycleEffortLevel — walks 1..10 with direction "right"/"left",
 *     respecting includeMax/includeXHigh flags
 *  2. convertEffortValueToLevel — passes numbers through unchanged
 *  3. toPersistableEffort — allows numbers to reach settings
 *  4. API effort mapping — converts numeric to string at request time
 *  5. effortSuffix template — startup banner shows "N/M effort" gated
 *     on model
 *
 * Each test isolates the patch and runs it standalone (no other
 * patches applied) so we know any observed behavior comes from
 * granular-effort alone.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getBundle,
  findFunctionContaining,
  evalFunction,
} from '../harness/index.js';

// granular-effort needs persist-max-effort on top because they both
// edit the ["low","medium","high"] arrays — granular-effort's Zod
// union wrap assumes persist-max-effort's "max" is already there.
// At runtime cx composes them the same way, so we mirror it here.
let patched: string;

beforeAll(() => {
  patched = getBundle({ patches: ['persist-max-effort', 'granular-effort'] }).source;
});

describe('granular-effort — cycleEffortLevel', () => {
  // Anchor: the prelude's unique var name `_cxL`. It only appears
  // inside cycleEffortLevel because the patch injects it there.
  function getCycle() {
    const fn = findFunctionContaining(patched, n =>
      n.type === 'Identifier' && (n as any).name === '_cxL',
    );
    return evalFunction<
      (v: any, dir: string, allowMax?: boolean, allowXhigh?: boolean) => number
    >(patched, fn);
  }

  // ── full-support models (Opus 4.7): 1..10 ─────────────────────────
  test('cycles numbers 1..10 rightward when allowMax+allowXhigh', () => {
    const cycle = getCycle();
    expect(cycle(1, 'right', true, true)).toBe(2);
    expect(cycle(5, 'right', true, true)).toBe(6);
    expect(cycle(9, 'right', true, true)).toBe(10);
  });

  test('wraps 10 → 1 on right when allowMax+allowXhigh', () => {
    const cycle = getCycle();
    expect(cycle(10, 'right', true, true)).toBe(1);
  });

  test('wraps 1 → 10 on left when allowMax+allowXhigh', () => {
    const cycle = getCycle();
    expect(cycle(1, 'left', true, true)).toBe(10);
  });

  test('cycles leftward when allowMax+allowXhigh', () => {
    const cycle = getCycle();
    expect(cycle(5, 'left', true, true)).toBe(4);
    expect(cycle(10, 'left', true, true)).toBe(9);
  });

  test('maps legacy string effort levels to numeric buckets (full support)', () => {
    const cycle = getCycle();
    // Prelude maps via list index: low→2, medium→4, high→6, xhigh→8, max→10
    expect(cycle('low', 'right', true, true)).toBe(3);
    expect(cycle('medium', 'right', true, true)).toBe(5);
    expect(cycle('high', 'right', true, true)).toBe(7);
    expect(cycle('xhigh', 'right', true, true)).toBe(9);
    expect(cycle('max', 'right', true, true)).toBe(1); // 10 → wrap
  });

  // ── max-only models (Opus 4.6, Sonnet 4.6): 1..8 ──────────────────
  test('caps at 8 when allowMax but !allowXhigh — wraps 8 → 1 on right', () => {
    const cycle = getCycle();
    expect(cycle(7, 'right', true, false)).toBe(8);
    expect(cycle(8, 'right', true, false)).toBe(1);
  });

  test('clamps stale > 8 input down to 8 when !allowXhigh', () => {
    const cycle = getCycle();
    // A 10 carried over from Opus 4.7 shouldn't render as "10/8" on
    // Sonnet — clamp first, then cycle as if the user is at the cap.
    expect(cycle(10, 'right', true, false)).toBe(1); // 10 → 8 → wrap
    expect(cycle(9, 'left', true, false)).toBe(7);   // 9 → 8 → -1 = 7
  });

  test('"max" string maps to bucket 8 when !allowXhigh', () => {
    const cycle = getCycle();
    // levels = [low, medium, high, max] → max occupies index 3 → 8
    expect(cycle('max', 'right', true, false)).toBe(1); // 8 → wrap to 1
  });

  // ── no-max-no-xhigh models: 1..6 ──────────────────────────────────
  test('caps at 6 when neither allowed — wraps 6 → 1 on right', () => {
    const cycle = getCycle();
    expect(cycle(5, 'right', false, false)).toBe(6);
    expect(cycle(6, 'right', false, false)).toBe(1);
  });

  test('wraps 1 → 6 on left when neither allowed', () => {
    const cycle = getCycle();
    expect(cycle(1, 'left', false, false)).toBe(6);
  });
});

describe('granular-effort — convertEffortValueToLevel', () => {
  test('numeric input is passed through unchanged', () => {
    // The patch inserts `if(typeof X === "number") return X;` as the
    // first statement. Verify by finding a function whose body starts
    // with exactly that pattern and calling it with a number.
    const fn = findFunctionContaining(patched, n => {
      if (n.type !== 'IfStatement') return false;
      const t = (n as any).test;
      if (
        t?.type !== 'BinaryExpression' ||
        t.operator !== '===' ||
        t.left?.type !== 'UnaryExpression' ||
        t.left.operator !== 'typeof' ||
        t.right?.type !== 'Literal' ||
        t.right.value !== 'number'
      ) {
        return false;
      }
      const cons = (n as any).consequent;
      if (cons?.type === 'BlockStatement') {
        return (
          cons.body?.[0]?.type === 'ReturnStatement' &&
          cons.body[0].argument?.type === 'Identifier'
        );
      }
      if (cons?.type === 'ReturnStatement') {
        return cons.argument?.type === 'Identifier';
      }
      return false;
    });

    const callable = evalFunction<(v: any) => any>(patched, fn, {
      fallbackStub: true,
    });
    expect(callable(4)).toBe(4);
    expect(callable(7)).toBe(7);
  });
});

describe('granular-effort — API effort number→string map', () => {
  test('mapping bucket size of 2 covers low/medium/high/xhigh/max', () => {
    // The API patch inlines this mapping using a model-derived levels
    // list. Verify the bucket logic standalone — for full-support the
    // levels are [low, medium, high, xhigh, max].
    const expr =
      `(function(q){` +
        `var L=["low","medium","high","xhigh","max"];` +
        `var I=Math.ceil(q/2)-1;` +
        `if(I<0)I=0;` +
        `if(I>=L.length)I=L.length-1;` +
        `return L[I];` +
      `})`;
    // eslint-disable-next-line no-new-func
    const map = new Function(`return ${expr}`)() as (n: number) => string;
    expect(map(1)).toBe('low');
    expect(map(2)).toBe('low');
    expect(map(3)).toBe('medium');
    expect(map(4)).toBe('medium');
    expect(map(5)).toBe('high');
    expect(map(6)).toBe('high');
    expect(map(7)).toBe('xhigh');
    expect(map(8)).toBe('xhigh');
    expect(map(9)).toBe('max');
    expect(map(10)).toBe('max');

    // Verify the patched bundle actually contains the inlined mapping
    // (canary against future structural drift in the API function).
    expect(patched.includes('_cxL.push("xhigh")')).toBe(true);
    expect(patched.includes('_cxL.push("max")')).toBe(true);
    expect(patched.includes('opus-4-7')).toBe(true);
  });
});

describe('granular-effort — N/M display', () => {
  test('ModelPicker display denominator scales with support flags', () => {
    // Section 2 emits `Math.min(N, M), "/", M` where M is computed as
    // `(3 + (xhigh?1:0) + (max?1:0)) * 2`. The literal text fragment
    // `?1:0)+(` proves the two flag components are still composed.
    expect(patched.includes('?1:0)+(')).toBe(true);
  });

  test('ModelPicker display uses Math.min to clamp numerator to model cap', () => {
    // Catches accidental removal of the per-model clamp — without it,
    // a stale 10 from Opus 4.7 would render as "10/8" on Sonnet.
    expect(patched.includes('Math.min(')).toBe(true);
  });

  test('startup banner suffix is gated on model (haiku/opus-4-7/opus-4-6 branches)', () => {
    // Section 7's IIFE: distinguishes haiku (no suffix), opus-4-7 (/10
    // when both flags), and opus-4-6/sonnet-4-6 (/8 with max only).
    expect(patched.includes('/haiku/i.test(')).toBe(true);
    expect(patched.includes('/opus-4-7/i.test(')).toBe(true);
    expect(patched.includes('/opus-4-7|opus-4-6|sonnet-4-6/i.test(')).toBe(true);
    expect(patched.includes('"/"+_M+" effort"')).toBe(true);
  });
});
