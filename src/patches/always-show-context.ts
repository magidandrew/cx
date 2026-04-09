/**
 * Always Show Context
 *
 * Shows context usage percentage at all times, not just when approaching
 * the limit. The built-in TokenWarning only fires within 20k tokens of
 * the threshold — on a 1M context window, that's ~98% full, far too late.
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/18456 (51 thumbs up)
 *
 * Strategy:
 * 1. Find TokenWarning by its unique "Context low" string
 * 2. Remove the isAboveWarningThreshold gate so the indicator always renders
 * 3. Fix the warning color to be neutral when below threshold
 * 4. Soften "Context low" label to "Context" for always-on display
 *
 * For auto-compact users (the default): shows a dim "X% context used"
 * line at all times. For manual-compact users: shows "Context (X% remaining)"
 * in neutral color when below threshold, escalating to warning/error colors
 * as context fills up.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'always-show-context',
  name: 'Always Show Context',
  description: 'Always display context usage percentage, not just when near limit',

  apply(ctx) {
    const { ast, editor, find, index, assert, src } = ctx;
    const { findFirst } = find;

    // Find TokenWarning function via its unique "Context low" marker.
    // Check indexed literals first (string concat), then template elements.
    let marker = null;
    for (const [value, nodes] of index.literalsByValue) {
      if (typeof value === 'string' && value.includes('Context low')) {
        marker = nodes[0];
        break;
      }
    }
    if (!marker) {
      marker = findFirst(ast, (n: any) =>
        n.type === 'TemplateElement' &&
        n.value?.raw?.includes('Context low')
      );
    }
    assert(marker, 'Could not find "Context low" marker in bundle');

    const fn = index.enclosingFunction(marker);
    assert(fn, 'Could not find TokenWarning function');

    // Find the early-return gate:
    //   if (!isAboveWarningThreshold || suppressWarning) { return null; }
    // Pattern: IfStatement → test: !X || Y, consequent: return null,
    // and it must appear before the "Context low" string.
    const gate = findFirst(fn, (n: any) => {
      if (n.type !== 'IfStatement' || n.start >= marker.start) return false;
      const t = n.test;
      if (t.type !== 'LogicalExpression' || t.operator !== '||') return false;
      if (t.left.type !== 'UnaryExpression' || t.left.operator !== '!') return false;
      return findFirst(n.consequent, (r: any) =>
        r.type === 'ReturnStatement' &&
        r.argument?.type === 'Literal' &&
        r.argument.value === null
      ) !== null;
    });
    assert(gate, 'Could not find early-return gate: if(!X||Y){return null}');

    // Save the minified name for isAboveWarningThreshold before editing
    const warnVar = gate.test.left.argument;
    assert(warnVar.type === 'Identifier',
      'Expected Identifier for isAboveWarningThreshold');

    // Edit 1: Remove threshold check from gate, keep suppress check.
    // !isAboveWarningThreshold || suppressWarning → suppressWarning
    editor.replaceRange(gate.test.start, gate.test.end, src(gate.test.right));

    // Edit 2: Neutral color when below warning threshold.
    // Find: isAboveErrorThreshold ? "error" : "warning"
    // Replace "warning" with: isAboveWarningThreshold ? "warning" : void 0
    // This makes text render in default color when context usage is low.
    const colorTernary = findFirst(fn, (n: any) =>
      n.type === 'ConditionalExpression' &&
      n.consequent.type === 'Literal' && n.consequent.value === 'error' &&
      n.alternate.type === 'Literal' && n.alternate.value === 'warning'
    );
    if (colorTernary) {
      editor.replaceRange(
        colorTernary.alternate.start,
        colorTernary.alternate.end,
        `${warnVar.name}?"warning":void 0`
      );
    }

    // Edit 3: Soften "Context low" → "Context" for neutral always-on display.
    const fnSrc = src(fn);
    const needle = 'Context low';
    let pos = 0;
    while ((pos = fnSrc.indexOf(needle, pos)) !== -1) {
      editor.replaceRange(
        fn.start + pos,
        fn.start + pos + needle.length,
        'Context'
      );
      pos += needle.length;
    }

    // Edit 4: Change "X% until auto-compact" → "X% context used"
    // The bundle has: reactiveOnlyMode ? `${100-var}% context used` : `${var}% until auto-compact`
    // reactiveOnlyMode is always false, so patch the alternate branch to also show context used.
    const autocompactTpl = findFirst(fn, (n: any) =>
      n.type === 'TemplateLiteral' &&
      n.quasis.some((q: any) => q.value?.raw?.includes('% until auto-compact'))
    );
    if (autocompactTpl) {
      const varName = src(autocompactTpl.expressions[0]);
      editor.replaceRange(
        autocompactTpl.start,
        autocompactTpl.end,
        `\`\${100-${varName}}% context used\``
      );
    }
  },
};

export default patch;
