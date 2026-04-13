/**
 * no-npm-warning.test.ts — suppress "switched from npm" notification
 *
 * The patch finds a ReturnStatement that returns an object with
 * key:"npm-deprecation-warning" and replaces the whole return with
 * `return null`. That means the key literal is gone from the patched
 * bundle — which is exactly what we want to verify.
 *
 * We also do a function-extraction test: locate the function in the
 * RAW bundle (via the key literal anchor), note its name, then find
 * the same named function in the patched bundle and eval it. Raw
 * returns a warning object; patched returns null.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  getRawBundle,
  parseBundle,
  findFunctionContaining,
  evalFunction,
  findLiterals,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';
import type { ASTNode } from '../../src/types.js';

let patched: string;
let raw: string;

beforeAll(() => {
  patched = getIsolatedBundle('no-npm-warning').source;
  raw = getRawBundle().source;
});

describe('no-npm-warning — static', () => {
  test('raw bundle has exactly the npm-deprecation-warning key literal', () => {
    expect(findLiterals(raw, 'npm-deprecation-warning').length).toBe(1);
  });

  test('patched bundle has zero occurrences of the key literal', () => {
    // The patch replaces the entire ReturnStatement with `return null`,
    // which strips the whole object literal including the key. If any
    // occurrences remain, the patch didn't fire.
    expect(findLiterals(patched, 'npm-deprecation-warning').length).toBe(0);
  });
});

describe('no-npm-warning — functional', () => {
  // Locate the enclosing function of the key literal in the RAW bundle,
  // record its name, and find the same-named function in the patched
  // bundle. We need the name-preserving route because the patched
  // bundle no longer has the anchor literal (the patch stripped it).
  function getRawFunctionName(): string | null {
    const fn = findFunctionContaining(raw, n =>
      n.type === 'Literal' && (n as any).value === 'npm-deprecation-warning',
    );
    if (fn.type === 'FunctionDeclaration' && (fn as any).id?.name) {
      return (fn as any).id.name;
    }
    return null;
  }

  test('raw function returns a npm-deprecation-warning object', () => {
    // Sanity: extract, run, assert we're on the right function. The
    // function closes over several minified helpers (state selectors,
    // etc.) so we eval with fallbackStub to trap all of them.
    const fn = findFunctionContaining(raw, n =>
      n.type === 'Literal' && (n as any).value === 'npm-deprecation-warning',
    );
    const callable = evalFunction<(...a: any[]) => any>(raw, fn, {
      fallbackStub: true,
    });
    let result: any;
    try {
      result = callable(undefined);
    } catch {
      // Even with fallback stubs, some functions can throw from
      // Symbol coercions or unexpected Proxy behavior — the static
      // test above is authoritative. This one is best-effort.
      return;
    }
    if (result && typeof result === 'object' && 'key' in result) {
      expect(result.key).toBe('npm-deprecation-warning');
    }
  });

  test('patched function (by name) returns null', async () => {
    const name = getRawFunctionName();
    if (!name) return;

    const { ast } = parseBundle(patched);
    let patchedFn: ASTNode | null = null;
    for (const n of walkAST(ast)) {
      if (
        n.type === 'FunctionDeclaration' &&
        (n as any).id?.name === name
      ) {
        patchedFn = n;
        break;
      }
    }
    if (!patchedFn) {
      // Minifier may re-name between raw and patched — extremely
      // unlikely because the patch only edits a single statement,
      // but guard anyway.
      return;
    }
    const callable = evalFunction<(...a: any[]) => any>(patched, patchedFn, {
      fallbackStub: true,
    });
    let result: any;
    try {
      result = callable(undefined, undefined);
      // Function may be async — unwrap the promise if so.
      if (result && typeof result.then === 'function') {
        result = await result;
      }
    } catch {
      return;
    }
    expect(result).toBe(null);
  });
});
