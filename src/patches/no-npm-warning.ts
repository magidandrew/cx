/**
 * No NPM Warning Patch
 *
 * Suppresses the "Claude Code has switched from npm to native installer"
 * notification that appears on every startup for npm installs.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'no-npm-warning',
  name: 'No NPM Warning',
  description: 'Suppress the "switched from npm to native installer" nag',

  apply(ctx) {
    const { ast, editor, find, assert } = ctx;
    const { findFirst } = find;

    // Find the ReturnStatement that returns {key:"npm-deprecation-warning",...}
    const ret = findFirst(ast, (n: any) => {
      if (n.type !== 'ReturnStatement') return false;
      const arg = n.argument;
      if (!arg || arg.type !== 'ObjectExpression') return false;
      return arg.properties.some((p: any) =>
        p.type === 'Property' &&
        p.key?.type === 'Identifier' && p.key.name === 'key' &&
        p.value?.type === 'Literal' && p.value.value === 'npm-deprecation-warning');
    });
    assert(ret, 'Could not find return with key:"npm-deprecation-warning"');

    // Replace the entire return statement with `return null`
    editor.replaceRange(ret.start, ret.end, 'return null');
  },
};

export default patch;
