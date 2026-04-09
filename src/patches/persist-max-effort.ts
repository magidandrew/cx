/**
 * Persist Max Effort Patch
 *
 * The public build strips "max" from toPersistableEffort(), so `/effort max`
 * only lasts for the current session. This patch restores the "max" check
 * so it persists to settings.json and survives restarts.
 *
 * Source (effort.ts):
 *   if (value === 'low' || value === 'medium' || value === 'high' || value === 'max')
 * Bundle (stripped):
 *   if (q === "low" || q === "medium" || q === "high")
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'persist-max-effort',
  name: 'Persist Max Effort',
  description: 'Save "max" effort to settings so it survives restarts',

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findFirst, findAll } = find;

    // Find the toPersistableEffort function. It's a function whose body has
    // exactly the pattern: q==="low"||q==="medium"||q==="high"
    // This is a unique 3-way string comparison in the bundle.
    const persistFn = findFirst(ast, (n: any) => {
      if (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression' && n.type !== 'ArrowFunctionExpression') return false;
      // Find the LogicalExpression chain: q==="low" || q==="medium" || q==="high"
      return findFirst(n, (inner: any) => {
        if (inner.type !== 'LogicalExpression' || inner.operator !== '||') return false;
        // The rightmost comparison should be q==="high"
        if (inner.right.type !== 'BinaryExpression') return false;
        if (inner.right.operator !== '===') return false;
        if (inner.right.right?.type !== 'Literal' || inner.right.right.value !== 'high') return false;
        // The left side should be another || with "medium"
        if (inner.left.type !== 'LogicalExpression' || inner.left.operator !== '||') return false;
        if (inner.left.right?.type !== 'BinaryExpression') return false;
        if (inner.left.right.right?.type !== 'Literal' || inner.left.right.right.value !== 'medium') return false;
        return true;
      }) !== null;
    });
    assert(persistFn, 'Could not find toPersistableEffort function (low||medium||high pattern)');

    // Find the "high" literal in the comparison chain
    const highLiteral = findFirst(persistFn, (n: any) => {
      if (n.type !== 'BinaryExpression' || n.operator !== '===') return false;
      return n.right?.type === 'Literal' && n.right.value === 'high';
    });
    assert(highLiteral, 'Could not find q==="high" comparison');

    // Get the parameter name (e.g., 'q') from the left side
    const paramName = highLiteral.left.type === 'Identifier' ? highLiteral.left.name : src(highLiteral.left);

    // Insert ||q==="max" after the q==="high" comparison
    editor.insertAt(highLiteral.end, `||${paramName}==="max"`);

    // Fix ["low","medium","high"] arrays (Zod schema + EFFORT_LEVELS) that also
    // strip "max". Without this, settings.json validation silently drops "max"
    // on read via .catch(undefined).
    const effortArrays = findAll(ast, (n: any) => {
      if (n.type !== 'ArrayExpression' || n.elements.length !== 3) return false;
      const vals = n.elements.map((e: any) => e?.type === 'Literal' ? e.value : null);
      return vals[0] === 'low' && vals[1] === 'medium' && vals[2] === 'high';
    });
    assert(effortArrays.length > 0, 'Could not find ["low","medium","high"] arrays to patch');
    for (const arr of effortArrays) {
      editor.insertAt(arr.elements[2].end, ',"max"');
    }
  },
};

export default patch;
