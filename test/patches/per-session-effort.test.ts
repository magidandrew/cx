/**
 * per-session-effort.test.ts
 *
 * The patch replaces a single-property `{effortValue: X}` object
 * literal (the spread target in applySettingsChange) with `{}`, so
 * settings-file effort changes no longer overwrite each running
 * session's in-memory effortValue.
 *
 * Across versions the surrounding node type varies: pre-2.1.97 uses
 * a ConditionalExpression, 2.1.97+ uses a LogicalExpression. We
 * verify both shapes of the patched bundle for safety.
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
  patched = getIsolatedBundle('per-session-effort').source;
  raw = getRawBundle().source;
});

function countEffortValueObjects(source: string): number {
  const { ast } = parseBundle(source);
  let n = 0;
  for (const node of walkAST(ast)) {
    if (node.type !== 'ObjectExpression') continue;
    const props = (node as any).properties;
    if (props.length !== 1) continue;
    const p = props[0];
    if (
      p?.type === 'Property' &&
      p.key?.type === 'Identifier' &&
      p.key.name === 'effortValue'
    ) {
      n++;
    }
  }
  return n;
}

describe('per-session-effort', () => {
  test('raw bundle contains a single-property {effortValue:X} object', () => {
    expect(countEffortValueObjects(raw)).toBe(1);
  });

  test('patched bundle contains zero such objects (all collapsed to {})', () => {
    // The exact replacement turns `{effortValue:X}` into `{}`. After
    // patching, there should be NO ObjectExpression with exactly one
    // property named effortValue anywhere in the bundle — if there's
    // even one left, either the patch missed the site or a new call
    // site appeared that we need to target.
    expect(countEffortValueObjects(patched)).toBe(0);
  });
});
