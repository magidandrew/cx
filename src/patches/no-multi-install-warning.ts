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

    // Two bundle shapes carry this marker. Catch both.
    //
    //   - update() / `claude doctor` CLI: an IfStatement consequent
    //     (BlockStatement) prints the warning with the multi-install table.
    //     Replace the entire IfStatement with an empty statement.
    //   - Doctor.tsx React output: a JSX child of the form
    //     `cond && createElement(..."Multiple installations found"...)`.
    //     In the 2.1.111 bundle this appears as a bare LogicalExpression
    //     (no enclosing IfStatement wrapper — older bundles had a
    //     react-compiler cache check around it). Replace the whole
    //     LogicalExpression with `!1` — React treats a falsy child as
    //     "render nothing."
    //
    // Both shapes are found by scanning all IfStatement and
    // LogicalExpression(&&) nodes whose source contains the marker; we
    // take the innermost match in either category so an outer wrapper
    // (e.g. a legacy react-compiler cache IfStatement around the JSX)
    // doesn't eat an unrelated subtree.
    const hits = findAll(ast, (n: any) => {
      if (n.type !== 'IfStatement' &&
          !(n.type === 'LogicalExpression' && n.operator === '&&')) {
        return false;
      }
      return source.substring(n.start, n.end).includes(marker);
    });
    assert(hits.length > 0,
      `Could not find any if-block or && expression containing "${marker}"`);

    // Innermost first so outer wrappers can't eat an inner match.
    hits.sort((a: any, b: any) => (a.end - a.start) - (b.end - b.start));

    const patched: Array<[number, number]> = [];
    for (const node of hits) {
      const overlaps = patched.some(([s, e]) => node.start < e && node.end > s);
      if (overlaps) continue;
      const replacement = node.type === 'IfStatement' ? '' : '!1';
      editor.replaceRange(node.start, node.end, replacement);
      patched.push([node.start, node.end]);
    }
  },
};

export default patch;
