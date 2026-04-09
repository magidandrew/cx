/**
 * Random Clawd Color Patch
 *
 * Picks a random color for the Clawd mascot on each startup
 * instead of the default orange theme color.
 */

export default {
  id: 'random-clawd',
  name: 'Random Clawd Color',
  description: 'Randomize the Clawd mascot color on each startup',

  apply(ctx) {
    const { ast, editor, find, assert } = ctx;
    const { findFirst, findAll } = find;

    // Find the Clawd component: function oM6(q) { ... }
    // Identified by containing the strings "clawd_body" and "clawd_background"
    // and the feet characters "▘▘ ▝▝".
    const clawdFn = findFirst(ast, n => {
      if (n.type !== 'FunctionDeclaration') return false;
      let hasClawd = false, hasFeet = false;
      for (const child of find.walkAST(n.body)) {
        if (child.type === 'Literal') {
          if (child.value === 'clawd_body') hasClawd = true;
          if (child.value === '▘▘ ▝▝') hasFeet = true;
        }
      }
      return hasClawd && hasFeet;
    });
    assert(clawdFn, 'Could not find Clawd component function');

    // Inject a random color picker before the function
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#E74C3C', '#2ECC71', '#3498DB', '#E67E22', '#1ABC9C',
      '#9B59B6', '#F39C12', '#00BCD4', '#FF5722', '#8BC34A',
    ];
    const colorArray = JSON.stringify(colors);
    editor.insertAt(clawdFn.start,
      `var __rc=${colorArray}[Math.floor(Math.random()*${colors.length})];`);

    // Replace all "clawd_body" literals within the function with __rc
    const clawdBodyLiterals = findAll(clawdFn, n =>
      n.type === 'Literal' && n.value === 'clawd_body');

    for (const lit of clawdBodyLiterals) {
      editor.replaceRange(lit.start, lit.end, '__rc');
    }
  },
};
