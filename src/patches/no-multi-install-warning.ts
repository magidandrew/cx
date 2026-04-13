/**
 * No Multi-Install Warning Patch
 *
 * Suppresses the "Warning: Multiple installations found" nag that
 * appears during `claude update` and `claude doctor` when both an
 * npm and a native installation exist. Since cx requires the npm
 * bundle alongside the native install, this warning is always a
 * false positive.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'no-multi-install-warning',
  name: 'No Multi-Install Warning',
  description: 'Suppress "Multiple installations found" nag in update/doctor',

  apply(ctx) {
    const { ast, source, editor, find, assert } = ctx;
    const { findAll } = find;

    const marker = 'Multiple installations found';

    // Find every IfStatement whose source contains the marker. Two hit
    // in current bundles: update() (BlockStatement consequent printing
    // the warning) and Doctor.tsx (React memo cache check that assigns
    // the warning fragment to a local).
    const hits = findAll(ast, (n: any) => {
      if (n.type !== 'IfStatement') return false;
      return source.substring(n.start, n.end).includes(marker);
    });
    assert(hits.length > 0, `Could not find any if-block containing "${marker}"`);

    // Innermost first so outer wrappers (e.g. a React-compiler cache check
    // around the warning) can't eat a whole unrelated subtree.
    hits.sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start));

    // Delete each non-overlapping occurrence. Overlap check keeps us from
    // double-patching an enclosing IfStatement once we've already removed
    // an inner one.
    const patched: Array<[number, number]> = [];
    for (const ifNode of hits) {
      const overlaps = patched.some(([s, e]) => ifNode.start < e && ifNode.end > s);
      if (overlaps) continue;
      editor.replaceRange(ifNode.start, ifNode.end, '');
      patched.push([ifNode.start, ifNode.end]);
    }
  },
};

export default patch;
