/**
 * Disable Long-Text Truncation
 *
 * Prevents text longer than ~10,000 characters from being collapsed into
 * a "[...Truncated text #N +X lines...]" placeholder when typed/pasted
 * into the prompt input. Long content stays inline so you can review and
 * edit it before submitting.
 *
 * Note: this is a separate system from `disable-paste-collapse`. That
 * patch turns off the "[Pasted text #N]" collapse on each paste event;
 * this one turns off the length-based truncation that runs in a React
 * effect against the *current* input value (and fires regardless of
 * whether the content arrived via paste).
 *
 * Strategy: useMaybeTruncateInput() runs a useEffect whose callback
 * destructures `{newInput, newPastedContents}` from a call to
 * maybeTruncateInput() whenever input length exceeds 10,000 chars.
 * The destructured property `newPastedContents` is a stable, unique
 * marker for that callback. We find it via the ObjectPattern, walk up
 * to the enclosing arrow function, and inject an early `return;` so the
 * effect never runs the truncation path.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'disable-text-truncation',
  name: 'Disable Long-Text Truncation',
  description: 'Show long input inline instead of collapsing into [...Truncated text #N]',

  apply(ctx) {
    const { ast, editor, find, index, assert } = ctx;
    const { findFirst } = find;

    // Find the unique ObjectPattern that destructures `newPastedContents`.
    // It only appears inside useMaybeTruncateInput()'s effect callback —
    // the two other references to that property name are ObjectExpression
    // returns inside maybeTruncateInput() itself, not ObjectPatterns.
    const pattern = findFirst(ast, (n: any) => {
      if (n.type !== 'ObjectPattern') return false;
      return n.properties.some((p: any) =>
        p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'newPastedContents') ||
         (p.key.type === 'Literal' && p.key.value === 'newPastedContents')));
    });
    assert(pattern, 'Could not find {newPastedContents} destructuring pattern');

    // Walk up to the enclosing arrow function (the useEffect callback).
    let arrow: any = pattern;
    while (arrow && arrow.type !== 'ArrowFunctionExpression') {
      arrow = index.parentMap.get(arrow);
    }
    assert(arrow, 'Could not find enclosing arrow function for the truncation effect');
    assert(arrow.body?.type === 'BlockStatement',
      'Truncation effect callback: expected block body');

    // Insert an early return so the effect never runs.
    editor.insertAt(arrow.body.start + 1, 'return;');
  },
};

export default patch;
