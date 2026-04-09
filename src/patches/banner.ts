/**
 * Attribution Banner Patch
 *
 * Changes "Claude Code" to "Claude Code · @wormcoffee" on the title line.
 * Targets the bold <Text> in the condensed layout and the border title
 * in the boxed layout. No extra elements, no layout changes.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'banner',
  name: 'Attribution Banner',
  description: 'Show "@wormcoffee" on the Claude Code title line',

  apply(ctx) {
    const { ast, editor, find, index, src, assert } = ctx;
    const { findFirst } = find;

    // ── Condensed layout: createElement(T, {bold:true}, "Claude Code") ──
    // Use literal index to find "Claude Code", then walk up to the createElement call.

    const claudeCodeLiterals = index.literalsByValue.get('Claude Code') || [];
    let boldTextCall = null;
    for (const lit of claudeCodeLiterals) {
      const call = index.ancestor(lit, 'CallExpression');
      if (!call || call.callee.type !== 'MemberExpression' || call.callee.property.name !== 'createElement') continue;
      const hasBold = call.arguments.some((a: any) =>
        a?.type === 'ObjectExpression' &&
        a.properties.some((p: any) => p.key?.type === 'Identifier' && p.key.name === 'bold'));
      if (hasBold) { boldTextCall = call; break; }
    }
    assert(boldTextCall, 'Could not find createElement(T, {bold}, "Claude Code")');

    const textLiteral = boldTextCall.arguments.find((a: any) =>
      a.type === 'Literal' && a.value === 'Claude Code');
    editor.replaceRange(textLiteral.start, textLiteral.end,
      '"Claude Code Extensions (cx) by x.com/@wormcoffee"');

    // ── Boxed layout: b7("claude",o)("Claude Code") in the border title ──

    // ── Boxed layout: b7("claude",o)("Claude Code") ──
    // Find "Claude Code" literal whose parent CallExpression's callee is another call with "claude"
    let titleCall = null;
    for (const lit of claudeCodeLiterals) {
      const call = index.parentMap.get(lit);
      if (!call || call.type !== 'CallExpression' || call.arguments.length !== 1) continue;
      if (call.callee.type === 'CallExpression' &&
          call.callee.arguments[0]?.type === 'Literal' &&
          call.callee.arguments[0].value === 'claude') {
        titleCall = call;
        break;
      }
    }
    if (titleCall) {
      editor.replaceRange(titleCall.arguments[0].start, titleCall.arguments[0].end,
        '"Claude Code Extensions (cx) by x.com/@wormcoffee"');
    }
  },
};

export default patch;
