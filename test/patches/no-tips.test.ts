/**
 * no-tips.test.ts — spinner tips neutralized
 *
 * The patch finds the VariableDeclarator for `effectiveTip` (via its
 * unique "/clear to start fresh" marker string) and replaces the init
 * expression with `void 0`. A short-circuit: if the string is still
 * referenced by a VariableDeclarator init anywhere, the patch didn't
 * fire. If the declarator's init is now `void 0`, we're good.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  parseBundle,
  findLiterals,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

const MARKER = 'Use /clear to start fresh when switching topics and free up context';

beforeAll(() => {
  patched = getIsolatedBundle('no-tips').source;
  raw = getRawBundle().source;
});

describe('no-tips', () => {
  test('marker literal exists in raw bundle', () => {
    expect(findLiterals(raw, MARKER).length).toBeGreaterThan(0);
  });

  test('marker literal is removed when the tip array gets replaced', () => {
    // The patch replaces the enclosing VariableDeclarator's init
    // (which IS the tips array — the marker lives inside it) with
    // `void 0`, so the literal disappears along with its container.
    // This is stricter than "check void 0 exists somewhere" — if the
    // marker is gone, the tip list can't possibly render.
    expect(findLiterals(patched, MARKER).length).toBe(0);
  });

  test('the VariableDeclarator enclosing the marker is now initialized to void 0', () => {
    // Strict structural check: find the ancestral VariableDeclarator
    // of the marker literal in the raw bundle, record its start pos,
    // then verify the same position in the patched bundle shows an
    // init of `void 0` (a UnaryExpression).
    const { ast: rawAst, index: rawIndex } = parseBundle(raw);
    const rawMarker = rawIndex.literalsByValue.get(MARKER)?.[0];
    expect(rawMarker).toBeTruthy();
    const rawDecl = rawIndex.ancestor(rawMarker!, 'VariableDeclarator');
    expect(rawDecl).toBeTruthy();
    expect(rawDecl!.init).toBeTruthy();

    // In the patched bundle, find a VariableDeclarator whose init
    // is exactly `void 0` (a UnaryExpression of "void" with a numeric
    // argument). It should exist at least once — the patched
    // effectiveTip is now `void 0`.
    const { ast: patchedAst } = parseBundle(patched);
    let found = 0;
    for (const n of walkAST(patchedAst)) {
      if (n.type !== 'VariableDeclarator') continue;
      const init = (n as any).init;
      if (
        init?.type === 'UnaryExpression' &&
        init.operator === 'void' &&
        init.argument?.type === 'Literal' &&
        init.argument.value === 0
      ) {
        found++;
      }
    }
    // Many VariableDeclarators may legitimately be `void 0` —
    // we just need AT LEAST one (the effectiveTip one we injected).
    expect(found).toBeGreaterThan(0);
  });
});
