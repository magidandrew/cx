/**
 * Always Show Thinking Patch
 *
 * Makes Claude's thinking blocks always display expanded instead of
 * collapsed behind "∴ Thinking (ctrl+o to expand)".
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/8477 (195 thumbs up)
 *
 * In AssistantThinkingMessage, the gate is:
 *   const shouldShowFullThinking = isTranscriptMode || verbose;
 *   if (!shouldShowFullThinking) { return <collapsed view> }
 *
 * We find the function by its unique "∴ Thinking" string and replace
 * the negated OR gate with `false` so the expanded view always renders.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'always-show-thinking',
  name: 'Always Show Thinking',
  description: 'Show thinking block content inline instead of collapsed',

  apply(ctx) {
    const { ast, editor, find, index, assert, src } = ctx;
    const { findFirst } = find;

    // Find the AssistantThinkingMessage function by its unique string literal.
    // The "∴" character (U+2234, "therefore") only appears in this component.
    // Use the literal index to find the marker, then walk up to its enclosing function.
    let thinkingMarker = null;
    for (const [value, nodes] of index.literalsByValue) {
      if (typeof value === 'string' && value.includes('\u2234 Thinking')) {
        thinkingMarker = nodes[0];
        break;
      }
    }
    assert(thinkingMarker, 'Could not find "∴ Thinking" literal');
    const thinkingFn = index.enclosingFunction(thinkingMarker);
    assert(thinkingFn, 'Could not find AssistantThinkingMessage function (marker: "∴ Thinking")');

    // Find the gate: if(!(Y||O)) where Y=isTranscriptMode, O=verbose.
    // Structure: IfStatement whose test is UnaryExpression(!) wrapping LogicalExpression(||)
    // This is the FIRST such pattern in the function, appearing before the "∴ Thinking" strings.
    const gate = findFirst(thinkingFn, (n: any) =>
      n.type === 'IfStatement'
      && n.test.type === 'UnaryExpression'
      && n.test.operator === '!'
      && n.test.argument.type === 'LogicalExpression'
      && n.test.argument.operator === '||'
    );
    assert(gate, 'Could not find thinking display gate: if(!(X||Y))');

    // Verify this is the right gate by checking it appears before the "∴ Thinking" string
    const firstThinkingLiteral = findFirst(thinkingFn, (n: any) =>
      n.type === 'Literal' && typeof n.value === 'string'
      && n.value.includes('\u2234 Thinking'));
    assert(
      gate.start < firstThinkingLiteral.start,
      'Gate should appear before "∴ Thinking" literal'
    );

    // Replace the test expression with `false` so the collapsed branch is never taken.
    // This makes thinking always display in expanded mode.
    editor.replaceRange(gate.test.start, gate.test.end, 'false');
  },
};

export default patch;
