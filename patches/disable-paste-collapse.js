/**
 * Disable Paste Collapse
 *
 * Prevents pasted text from being collapsed into "[Pasted text #N +X lines]"
 * placeholders. All pasted content is inserted inline so you can review and
 * edit it before submitting.
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/23134 (77 👍)
 *
 * Strategy: find the paste-collapse condition in onTextPaste() — identified
 * by the call to formatPastedTextRef (Xd8) which contains the stable string
 * literal "Pasted text #" — and replace the guard condition with `false`.
 */

export default {
  id: 'disable-paste-collapse',
  name: 'Disable Paste Collapse',
  description: 'Show pasted text inline instead of collapsing into [Pasted text #N]',

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findFirst } = find;

    // Find the formatPastedTextRef function by its "Pasted text #" template literal.
    const fmtFn = findFirst(ast, n =>
      n.type === 'FunctionDeclaration' &&
      src(n).includes('Pasted text #'));
    assert(fmtFn, 'Could not find formatPastedTextRef function');
    const fmtName = fmtFn.id.name; // e.g. "Xd8"

    // Find the onTextPaste function: contains a call to formatPastedTextRef
    // and an if-statement whose consequent calls it.
    // We look for the IfStatement whose consequent block contains a call
    // to fmtName — that's the collapse gate.
    const collapseIf = findFirst(ast, n => {
      if (n.type !== 'IfStatement') return false;
      // The consequent must contain a call to fmtName
      const hasFmtCall = findFirst(n.consequent, c =>
        c.type === 'CallExpression' &&
        c.callee.type === 'Identifier' &&
        c.callee.name === fmtName);
      if (!hasFmtCall) return false;
      // The alternate should insert text directly (else branch)
      return n.alternate !== null;
    });
    assert(collapseIf, 'Could not find paste-collapse if-statement');

    // Replace the test expression with `false`
    const test = collapseIf.test;
    editor.replaceRange(test.start, test.end, 'false');
  },
};
