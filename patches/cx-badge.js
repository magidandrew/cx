/**
 * CX Badge Patch
 *
 * Adds a small "cx" indicator to the left of the permission mode text
 * (e.g. "bypass permissions on", "accept edits on") in the footer.
 * When no mode is active, the badge still shows on the footer line.
 */

export default {
  id: 'cx-badge',
  name: 'CX Badge',
  description: 'Show a persistent "cx" indicator in the prompt footer',

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findFirst } = find;

    // Find the ModeIndicator function via the unique "? for shortcuts" string.
    // Then locate the final return that builds <Box height={1} overflow="hidden">
    // which contains modePart, tasksPart, and parts.

    // Strategy: find the string "? for shortcuts" — it's inside a JSX element
    // in ModeIndicator. Then find the enclosing function.
    const shortcutsHint = findFirst(ast, n =>
      n.type === 'Literal' && n.value === '? for shortcuts');
    assert(shortcutsHint, 'Could not find "? for shortcuts" literal');

    // Walk up to find the function containing this
    const modeIndicatorFn = findFirst(ast, node => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return false;
      // Check if the "? for shortcuts" literal is inside this function
      let found = false;
      const check = n => {
        if (n === shortcutsHint) { found = true; return; }
        if (found) return;
        for (const key of Object.keys(n)) {
          if (key === 'type' || key === 'start' || key === 'end') continue;
          const val = n[key];
          if (val && typeof val === 'object') {
            if (Array.isArray(val)) {
              for (const item of val) {
                if (item && typeof item.type === 'string') check(item);
                if (found) return;
              }
            } else if (typeof val.type === 'string') {
              check(val);
              if (found) return;
            }
          }
        }
      };
      check(node);
      return found;
    });
    assert(modeIndicatorFn, 'Could not find ModeIndicator function');

    // Find the createElement call with height:1 and overflow:"hidden" props
    // This is the final return: <Box height={1} overflow="hidden">
    const boxWithHeight1 = findFirst(modeIndicatorFn, n => {
      if (n.type !== 'CallExpression') return false;
      // Look for an object argument with height:1 and overflow:"hidden"
      return n.arguments.some(arg => {
        if (arg?.type !== 'ObjectExpression') return false;
        let hasHeight = false;
        let hasOverflow = false;
        for (const p of arg.properties) {
          if (p.key?.name === 'height' && p.value?.value === 1) hasHeight = true;
          if (p.key?.name === 'overflow' && p.value?.value === 'hidden') hasOverflow = true;
        }
        return hasHeight && hasOverflow;
      });
    });
    assert(boxWithHeight1, 'Could not find <Box height={1} overflow="hidden">');

    // Get the React namespace from the createElement call
    // The call looks like: R.createElement(Box, {height:1, overflow:"hidden"}, ...children)
    const callee = boxWithHeight1.callee;
    let R;
    if (callee.type === 'MemberExpression') {
      R = src(callee.object);
    } else {
      // Could be jsxs or jsx direct call
      R = src(callee);
    }

    // Find the Box component reference (first argument to createElement)
    const BoxRef = src(boxWithHeight1.arguments[0]);

    // Find the Text component — look for a createElement call with " · " string
    const separatorCall = findFirst(modeIndicatorFn, n => {
      if (n.type !== 'CallExpression') return false;
      return n.arguments.some(a => a?.type === 'Literal' && a.value === ' · ');
    });
    assert(separatorCall, 'Could not find separator " · " createElement');
    const TextRef = src(separatorCall.arguments[0]);

    // Insert a CX badge as the first child of the Box.
    // The children start after the props object.
    // Find the props object position
    const propsArg = boxWithHeight1.arguments.find(a =>
      a?.type === 'ObjectExpression' &&
      a.properties.some(p => p.key?.name === 'height'));

    // Insert right after the props argument (before the first child)
    const insertPos = propsArg.end;

    // CX badge: inverse claude orange
    const cxBadge = `,${R}.createElement(${BoxRef},{flexShrink:0},${R}.createElement(${TextRef},{inverse:true,color:"claude"},"cx"),${R}.createElement(${TextRef},null," "))`;

    editor.insertAt(insertPos, cxBadge);
  },
};
