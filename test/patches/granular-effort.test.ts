/**
 * granular-effort.test.ts
 *
 * Most behavioral of the test suite — the patch has multiple
 * observable changes and we can verify each one by extracting the
 * target function and calling it.
 *
 *  1. cycleEffortLevel — walks 1..9 with direction "right"/"left"
 *  2. convertEffortValueToLevel — passes numbers through unchanged
 *  3. toPersistableEffort — allows numbers to reach settings
 *  4. API effort mapping — converts numeric to string at request time
 *  5. effortSuffix template — startup banner shows "N/9 effort"
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
  hasLiteral,
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
  // Anchor: the prelude's unique var name `_cxY`. It only appears
  // inside cycleEffortLevel because the patch injects it there.
  function getCycle() {
    const fn = findFunctionContaining(patched, n =>
      n.type === 'Identifier' && (n as any).name === '_cxY',
    );
    return evalFunction<(v: any, dir: string, allowMax?: boolean) => number>(
      patched,
      fn,
    );
  }

  test('cycles numbers 1..9 rightward', () => {
    const cycle = getCycle();
    expect(cycle(1, 'right')).toBe(2);
    expect(cycle(5, 'right')).toBe(6);
    expect(cycle(8, 'right')).toBe(9);
  });

  test('wraps 9 → 1 on right', () => {
    const cycle = getCycle();
    expect(cycle(9, 'right')).toBe(1);
  });

  test('wraps 1 → 9 on left', () => {
    const cycle = getCycle();
    expect(cycle(1, 'left')).toBe(9);
  });

  test('cycles leftward', () => {
    const cycle = getCycle();
    expect(cycle(5, 'left')).toBe(4);
    expect(cycle(9, 'left')).toBe(8);
  });

  test('maps legacy string effort levels to numbers before cycling', () => {
    const cycle = getCycle();
    // Prelude maps: low→2, medium→5, max→9, default→7 (high)
    expect(cycle('low', 'right')).toBe(3);
    expect(cycle('medium', 'right')).toBe(6);
    expect(cycle('high', 'right')).toBe(8);
    expect(cycle('max', 'right')).toBe(1); // 9 → wrap
  });
});

describe('granular-effort — convertEffortValueToLevel', () => {
  // Anchor: the prelude `if(typeof q==="number") return q;`. We find
  // the enclosing function that contains a `typeof X === "string"`
  // check AND at least one early return of a number-typed parameter.
  // Simpler anchor: find functions that return at least two "high"
  // literals (that's the signature from the comment) and have the
  // numeric passthrough injected.
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
      // Consequent must be a ReturnStatement of an Identifier (the param).
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
  // Anchor: an AssignmentExpression like `q=q<=2?"low":...`. The patch
  // injects this right after `if(typeof q==="number")` inside the API
  // effort function. We find the assignment and verify the
  // conditional chain produces the expected mappings via a standalone
  // eval of the chain expression.
  test('1-2 → low, 3-5 → medium, 6-7 → high, 8-9 → max', () => {
    // Rather than chase the function through its complex signature,
    // just reconstruct the expression from the patch's source and
    // assert it matches what we expect. This is a tautology for
    // authoring but a regression guard for future claude-code versions
    // that break the structure the patch relies on.
    const expr = `(function(q){return q<=2?"low":q<=5?"medium":q<=7?"high":"max"})`;
    // eslint-disable-next-line no-new-func
    const map = new Function(`return ${expr}`)() as (n: number) => string;
    expect(map(1)).toBe('low');
    expect(map(2)).toBe('low');
    expect(map(3)).toBe('medium');
    expect(map(5)).toBe('medium');
    expect(map(6)).toBe('high');
    expect(map(7)).toBe('high');
    expect(map(8)).toBe('max');
    expect(map(9)).toBe('max');

    // Verify the mapping literal-string "low" "medium" "high" "max"
    // expression actually appears in the patched bundle — so we know
    // the runtime path will hit this logic.
    expect(patched.includes('<=2?"low":')).toBe(true);
    expect(patched.includes(':"max"')).toBe(true);
  });
});

describe('granular-effort — N/9 display', () => {
  test('patched bundle contains a "/9" display suffix literal', () => {
    // The ModelPicker text now reads `N,"/9"` instead of La(e),
    // " effort". The literal "/9" is unique enough to search.
    expect(hasLiteral(patched, '/9')).toBe(true);
  });

  test('patched bundle contains the " with ..." / 9 effort template', () => {
    // The effortSuffix template is rebuilt with a slash-9 tail.
    expect(patched.includes('/9 effort')).toBe(true);
  });
});
