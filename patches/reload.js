/**
 * Ctrl+X Ctrl+R Reload Patch
 *
 * Adds a "reload" keybinding: pressing Ctrl+X Ctrl+R exits Claude with
 * exit code 75. The cx wrapper catches this and re-spawns with --continue,
 * picking up any patch changes while preserving the conversation.
 */

export default {
  id: 'reload',
  name: 'Ctrl+X Ctrl+R Reload',
  description: 'Reload cx session with Ctrl+X Ctrl+R (re-applies patches, keeps conversation)',

  apply(ctx) {
    const { ast, editor, find, query, src, assert } = ctx;
    const { findFirst } = find;
    const {
      findArrayWithConsecutiveStrings,
      findObjectWithStringProps,
      findHookCallWithObjectKeys,
    } = query;

    // ── 1. KEYBINDING_ACTIONS: register "chat:reload" ────────────────

    const actionsArr = findArrayWithConsecutiveStrings(ast, 'chat:submit', 'chat:newline');
    assert(actionsArr, 'Could not find KEYBINDING_ACTIONS array');
    const newlineEl = actionsArr.elements.find(e => e.type === 'Literal' && e.value === 'chat:newline');
    editor.insertAt(newlineEl.end, ',"chat:reload"');

    // ── 2. DEFAULT_BINDINGS: bind Ctrl+X Ctrl+R → chat:reload ────────

    const bindingsObj = findObjectWithStringProps(ast, [['enter', 'chat:submit'], ['up', 'history:previous']]);
    assert(bindingsObj, 'Could not find DEFAULT_BINDINGS Chat object');
    const upProp = bindingsObj.properties.find(p => p.type === 'Property' &&
      ((p.key.type === 'Identifier' && p.key.name === 'up') ||
       (p.key.type === 'Literal' && p.key.value === 'up')));
    editor.insertAt(upProp.end, ',"ctrl+x ctrl+r":"chat:reload"');

    // ── 3. Handler: process.exit(75) in chatHandlers useMemo ─────────

    const chatHandlersMemo = findHookCallWithObjectKeys(ast, 'useMemo', [
      'chat:undo', 'chat:newline', 'chat:stash', 'chat:imagePaste',
    ]);
    assert(chatHandlersMemo, 'Could not find chatHandlers useMemo');
    const R = src(chatHandlersMemo.callee.object);

    const handlersObject = findFirst(chatHandlersMemo.arguments[0], n =>
      n.type === 'ObjectExpression' &&
      n.properties.some(p => p.type === 'Property' && p.key.type === 'Literal' && p.key.value === 'chat:undo'));
    assert(handlersObject, 'Could not find handlers object in useMemo');

    const depsArray = chatHandlersMemo.arguments[1];
    assert(depsArray?.type === 'ArrayExpression', 'Could not find deps array');

    const memoDecl = findFirst(ast, n =>
      n.type === 'VariableDeclaration' && n.declarations.some(d => d.init === chatHandlersMemo));
    assert(memoDecl, 'Could not find VariableDeclaration for chatHandlers useMemo');

    // useCallback with empty deps — process.exit(75) never changes
    editor.insertAt(memoDecl.start, `let __rH=${R}.useCallback(()=>{process.exit(75)},[]);`);

    const lastProp = handlersObject.properties[handlersObject.properties.length - 1];
    editor.insertAt(lastProp.end, `,"chat:reload":__rH`);

    const lastDep = depsArray.elements[depsArray.elements.length - 1];
    editor.insertAt(lastDep.end, `,__rH`);
  },
};
