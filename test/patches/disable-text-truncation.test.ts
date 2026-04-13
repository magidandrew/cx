/**
 * disable-text-truncation.test.ts
 *
 * The patch injects `return;` as the first statement of the
 * useMaybeTruncateInput useEffect callback. The callback is an
 * ArrowFunctionExpression that destructures `{newPastedContents}` —
 * we locate it via that pattern and assert the first statement of
 * its body is a bare `return;`.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { getIsolatedBundle, parseBundle } from '../harness/index.js';
import { walkAST } from '../../src/ast.js';
import type { ASTNode } from '../../src/types.js';

let patched: string;

beforeAll(() => {
  patched = getIsolatedBundle('disable-text-truncation').source;
});

describe('disable-text-truncation', () => {
  test('effect callback starts with a bare "return;"', () => {
    // Find the ObjectPattern destructuring newPastedContents,
    // walk up to its enclosing ArrowFunctionExpression, then check
    // the first statement of that function's body.
    const { ast, index } = parseBundle(patched);

    let pattern: ASTNode | null = null;
    for (const n of walkAST(ast)) {
      if (n.type !== 'ObjectPattern') continue;
      const props = (n as any).properties ?? [];
      const hasNPC = props.some((p: any) =>
        p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'newPastedContents') ||
          (p.key.type === 'Literal' && p.key.value === 'newPastedContents')),
      );
      if (hasNPC) {
        pattern = n;
        break;
      }
    }
    expect(pattern).toBeTruthy();

    let arrow: any = pattern;
    while (arrow && arrow.type !== 'ArrowFunctionExpression') {
      arrow = (index as any).parentMap.get(arrow);
    }
    expect(arrow).toBeTruthy();
    expect(arrow.body?.type).toBe('BlockStatement');

    // Injected `return;` is the first statement in the body.
    const first = arrow.body.body?.[0];
    expect(first).toBeTruthy();
    expect(first.type).toBe('ReturnStatement');
    // Bare `return;` has no argument.
    expect(first.argument == null).toBe(true);
  });
});
