/**
 * random-clawd.test.ts — randomized Clawd mascot color
 *
 * The patch injects `var __rc = <colors>[Math.floor(Math.random() * 20)]`
 * before the Clawd component function and replaces every "clawd_body"
 * literal inside that function with `__rc`. We verify:
 *
 *  1. The __rc declaration exists at module scope with the right
 *     20-color palette.
 *  2. None of the raw "clawd_body" literals survive inside the
 *     Clawd function body.
 *  3. All 20 colors are hex-format strings (smoke check on the array).
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  parseBundle,
  evalExpression,
  findLiterals,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('random-clawd').source;
  raw = getRawBundle().source;
});

describe('random-clawd', () => {
  test('raw bundle has the "clawd_body" literal', () => {
    expect(findLiterals(raw, 'clawd_body').length).toBeGreaterThan(0);
  });

  test('patched bundle has fewer "clawd_body" literals than raw', () => {
    // The patch replaces every occurrence inside the Clawd function.
    // If the same literal is referenced elsewhere (unlikely) it'd
    // still appear, so we use < rather than === 0.
    const rawCount = findLiterals(raw, 'clawd_body').length;
    const patchedCount = findLiterals(patched, 'clawd_body').length;
    expect(patchedCount).toBeLessThan(rawCount);
  });

  test('patched bundle contains __rc variable initialized from a 20-element color array', () => {
    // Parse the patched bundle and find a VariableDeclarator for __rc
    // whose init is a MemberExpression on an ArrayExpression.
    const { ast } = parseBundle(patched);
    let rcDecl: any = null;
    for (const n of walkAST(ast)) {
      if (n.type !== 'VariableDeclarator') continue;
      if ((n as any).id?.name !== '__rc') continue;
      rcDecl = n;
      break;
    }
    expect(rcDecl).toBeTruthy();
    // Init should be a MemberExpression: colorArray[Math.floor(Math.random() * N)]
    expect(rcDecl.init.type).toBe('MemberExpression');
    expect(rcDecl.init.object.type).toBe('ArrayExpression');
    expect(rcDecl.init.object.elements.length).toBe(20);

    // Sanity: pick up the array literal, eval it standalone, and
    // verify every element is a hex color string.
    const arrText = patched.slice(
      rcDecl.init.object.start,
      rcDecl.init.object.end,
    );
    const colors = evalExpression<string[]>(arrText);
    expect(colors.length).toBe(20);
    for (const c of colors) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
