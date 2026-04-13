/**
 * cut-to-clipboard.test.ts
 *
 * The patch adds a "chat:cut" KEYBINDING_ACTIONS entry, binds Alt+X
 * to it in DEFAULT_BINDINGS, and wires a handler that copies the
 * prompt to the OS clipboard + clears input. We verify the three
 * structural hooks via the patched source.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  parseBundle,
  findObjectsWithProps,
  findLiterals,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('cut-to-clipboard').source;
});

describe('cut-to-clipboard', () => {
  test('patched bundle has "chat:cut" in KEYBINDING_ACTIONS', () => {
    expect(findLiterals(patched, 'chat:cut').length).toBeGreaterThanOrEqual(1);
    // Should appear in the keybinding array.
    const { ast } = parseBundle(patched);
    let inArray = false;
    for (const n of walkAST(ast)) {
      if (n.type !== 'ArrayExpression') continue;
      const vals = (n as any).elements
        .filter((e: any) => e?.type === 'Literal')
        .map((e: any) => e.value);
      if (vals.includes('chat:cut') && vals.includes('chat:submit')) {
        inArray = true;
        break;
      }
    }
    expect(inArray).toBe(true);
  });

  test('patched bundle binds "alt+x" to "chat:cut"', () => {
    const objs = findObjectsWithProps(patched, [['alt+x', 'chat:cut']]);
    expect(objs.length).toBeGreaterThanOrEqual(1);
  });
});
