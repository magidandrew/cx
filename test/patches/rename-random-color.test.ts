/**
 * rename-random-color.test.ts
 *
 * The patch injects a `var __cxC = <pool>[Math.floor(Math.random()*8)]`
 * statement at the top of the rename call function body and appends
 * `,color:__cxC` to the inner `standaloneAgentContext: { name }` object.
 * The rename command itself is default-off so we isolate the patch.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import {
  getIsolatedBundle,
  parseBundle,
  evalExpression,
  countOccurrences,
} from '../harness/index.js';
import { walkAST } from '../../src/ast.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('rename-random-color').source;
});

describe('rename-random-color', () => {
  test('patched bundle declares __cxC with the 8-color pool', () => {
    // __cxC is the unique local name for the randomly-picked color.
    // Parse the bundle and find its VariableDeclarator.
    const { ast } = parseBundle(patched);
    let decl: any = null;
    for (const n of walkAST(ast)) {
      if (n.type !== 'VariableDeclarator') continue;
      if ((n as any).id?.name === '__cxC') {
        decl = n;
        break;
      }
    }
    expect(decl).toBeTruthy();
    expect(decl.init?.type).toBe('MemberExpression');
    expect(decl.init.object?.type).toBe('ArrayExpression');
    expect(decl.init.object.elements.length).toBe(8);

    // Pull the array literal out and assert it contains named colors.
    const arrText = patched.slice(
      decl.init.object.start,
      decl.init.object.end,
    );
    const colors = evalExpression<string[]>(arrText);
    expect(colors).toEqual([
      'red',
      'blue',
      'green',
      'yellow',
      'purple',
      'orange',
      'pink',
      'cyan',
    ]);
  });

  test('__cxC is referenced as a color property inside an object literal', () => {
    // The second half of the patch appends `,color:__cxC` to the
    // name-carrying object. Look for "color:__cxC" as a substring.
    expect(countOccurrences(patched, 'color:__cxC')).toBe(1);
  });
});
