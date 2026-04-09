/**
 * No Tips Patch
 *
 * Removes the "Tip: ..." messages shown in the spinner while Claude
 * is thinking. Neutralises the effectiveTip variable so neither the
 * scheduled tips nor the time-based /clear and /btw tips appear.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'no-tips',
  name: 'No Tips',
  description: 'Hide spinner tips',

  apply(ctx) {
    const { index, editor, assert } = ctx;

    // The effectiveTip computation contains this unique string literal.
    // Find it and walk up to the VariableDeclarator to replace the init.
    const marker = 'Use /clear to start fresh when switching topics and free up context';
    const hits = index.literalsByValue.get(marker) || [];
    assert(hits.length > 0, `Could not find "${marker}" literal`);

    const lit = hits[0];
    const decl = index.ancestor(lit, 'VariableDeclarator');
    assert(decl && decl.init, 'Could not find enclosing VariableDeclarator');

    editor.replaceRange(decl.init.start, decl.init.end, 'void 0');
  },
};

export default patch;
