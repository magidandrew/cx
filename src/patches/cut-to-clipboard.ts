/**
 * Cut to Clipboard
 *
 * Adds a cut action for the prompt box: Option/Alt+X copies the current input
 * to the system clipboard and clears the prompt.
 *
 * Ctrl+X is already a chord prefix in Claude Code (Ctrl+X Ctrl+E for the
 * external editor, Ctrl+X Ctrl+K for kill agents, plus cx's Ctrl+X Ctrl+R
 * reload patch), so this patch binds to Alt+X instead to avoid conflicts.
 */

import type { ASTNode, Patch } from '../types.js';

function isPropKey(node: ASTNode, key: string): boolean {
  return node.type === 'Property' && (
    (node.key.type === 'Identifier' && node.key.name === key) ||
    (node.key.type === 'Literal' && node.key.value === key)
  );
}

function isLiteralValue(node: ASTNode, value: string): boolean {
  return node.type === 'Literal' && node.value === value;
}

const patch: Patch = {
  id: 'cut-to-clipboard',
  name: 'Cut prompt to clipboard (Alt+X)',
  description: 'Option/Alt+X copies the current prompt text to the system clipboard and clears the input',
  defaultEnabled: true,

  apply(ctx) {
    const { ast, index, editor, find, query, src, assert } = ctx;
    const { findFirst } = find;
    const {
      findArrayWithConsecutiveStrings,
      findObjectWithStringProps,
      findHookCallWithObjectKeys,
      getDestructuredName,
    } = query;

    // ── 1. KEYBINDING_ACTIONS: register "chat:cut" ────────────────────

    const actionsArr = findArrayWithConsecutiveStrings(ast, 'chat:submit', 'chat:newline');
    assert(actionsArr, 'Could not find KEYBINDING_ACTIONS array');

    const actionInsertAfter = actionsArr.elements.find((e: ASTNode) => isLiteralValue(e, 'chat:clearInput'))
      ?? actionsArr.elements.find((e: ASTNode) => isLiteralValue(e, 'chat:imagePaste'))
      ?? actionsArr.elements.find((e: ASTNode) => isLiteralValue(e, 'chat:newline'));
    assert(actionInsertAfter, 'Could not find KEYBINDING_ACTIONS insertion point');
    editor.insertAt(actionInsertAfter.end, ',"chat:cut"');

    // ── 2. DEFAULT_BINDINGS: bind Alt+X → chat:cut ────────────────────

    const bindingsObj = findObjectWithStringProps(ast, [['enter', 'chat:submit'], ['up', 'history:previous']]);
    assert(bindingsObj, 'Could not find DEFAULT_BINDINGS Chat object');

    const bindingInsertAfter = bindingsObj.properties.find((p: ASTNode) =>
      p.type === 'Property' &&
      p.value.type === 'Literal' &&
      p.value.value === 'chat:clearInput')
      ?? bindingsObj.properties.find((p: ASTNode) => isPropKey(p, 'escape'));
    assert(bindingInsertAfter, 'Could not find DEFAULT_BINDINGS insertion point');
    editor.insertAt(bindingInsertAfter.end, ',"alt+x":"chat:cut"');

    // ── 3. PromptInput: add cut handler + chat:cut registration ───────

    const chatHandlersMemo = findHookCallWithObjectKeys(ast, 'useMemo', [
      'chat:undo', 'chat:newline', 'chat:stash', 'chat:imagePaste',
    ]);
    assert(chatHandlersMemo, 'Could not find chatHandlers useMemo');
    const reactRef = src(chatHandlersMemo.callee.object);

    const handlersObject = findFirst(chatHandlersMemo.arguments[0], (n: ASTNode) =>
      n.type === 'ObjectExpression' &&
      n.properties.some((p: ASTNode) => isPropKey(p, 'chat:undo')));
    assert(handlersObject, 'Could not find handlers object in chatHandlers useMemo');

    const depsArray = chatHandlersMemo.arguments[1];
    assert(depsArray?.type === 'ArrayExpression', 'Could not find deps array for chatHandlers useMemo');

    const memoDecl = findFirst(ast, (n: ASTNode) =>
      n.type === 'VariableDeclaration' &&
      n.declarations.some((d: ASTNode) => d.init === chatHandlersMemo));
    assert(memoDecl, 'Could not find VariableDeclaration for chatHandlers useMemo');

    const clearInputProp = handlersObject.properties.find((p: ASTNode) => isPropKey(p, 'chat:clearInput'));
    assert(clearInputProp?.type === 'Property', 'Could not find chat:clearInput handler');
    const clearInputHandler = src(clearInputProp.value);

    const submitRegister = findFirst(ast, (n: ASTNode) =>
      n.type === 'CallExpression' &&
      n.callee.type === 'MemberExpression' &&
      !n.callee.computed &&
      n.callee.property.type === 'Identifier' &&
      n.callee.property.name === 'registerHandler' &&
      n.arguments[0]?.type === 'ObjectExpression' &&
      n.arguments[0].properties.some((p: ASTNode) =>
        isPropKey(p, 'action') &&
        p.type === 'Property' &&
        p.value.type === 'Literal' &&
        p.value.value === 'chat:submit'));
    assert(submitRegister, 'Could not find chat:submit registerHandler call');

    const submitRegisterArg = submitRegister.arguments[0];
    assert(submitRegisterArg?.type === 'ObjectExpression', 'Could not find registerHandler argument object');
    const submitHandlerProp = submitRegisterArg.properties.find((p: ASTNode) => isPropKey(p, 'handler'));
    assert(submitHandlerProp?.type === 'Property', 'Could not find submit handler property');
    const submitHandlerFn = submitHandlerProp.value;
    assert(submitHandlerFn.type === 'ArrowFunctionExpression', 'submit handler is not an arrow function');

    let submitCall: ASTNode | null = null;
    if (submitHandlerFn.body.type === 'BlockStatement') {
      const stmt = submitHandlerFn.body.body.find((s: ASTNode) => s.type === 'ExpressionStatement');
      submitCall = stmt?.type === 'ExpressionStatement' ? stmt.expression : null;
    } else {
      submitCall = submitHandlerFn.body;
    }
    assert(submitCall?.type === 'CallExpression', 'Could not find submit handler call');
    const inputArg = submitCall.arguments[0];
    assert(inputArg?.type === 'Identifier', 'Could not find current input identifier');
    const inputName = src(inputArg);

    const promptFn = index.enclosingFunction(chatHandlersMemo);
    assert(promptFn, 'Could not find PromptInput function');

    const notificationsDecl = findFirst(promptFn, (n: ASTNode) =>
      n.type === 'VariableDeclarator' &&
      n.id.type === 'ObjectPattern' &&
      getDestructuredName(n.id, 'addNotification') !== null);
    assert(notificationsDecl?.type === 'VariableDeclarator', 'Could not find addNotification binding');
    const addNotificationName = getDestructuredName(notificationsDecl.id, 'addNotification');
    assert(addNotificationName, 'Could not resolve addNotification identifier');

    const setClipboardFn = findFirst(ast, (n: ASTNode) => {
      if (n.type !== 'FunctionDeclaration') return false;
      if (!n.async || !n.id || n.params.length !== 1) return false;
      const hasOsc52 = findFirst(n, (c: ASTNode) =>
        c.type === 'TemplateLiteral' &&
        c.quasis.some((q: any) => q.value?.cooked?.includes('52;c;'))) !== null;
      if (!hasOsc52) return false;
      return findFirst(n, (c: ASTNode) =>
        c.type === 'CallExpression' &&
        c.callee.type === 'MemberExpression' &&
        !c.callee.computed &&
        c.callee.property.type === 'Identifier' &&
        c.callee.property.name === 'toString' &&
        c.arguments.length === 1 &&
        c.arguments[0].type === 'Literal' &&
        c.arguments[0].value === 'base64') !== null;
    });
    assert(setClipboardFn?.type === 'FunctionDeclaration', 'Could not find setClipboard function');
    const setClipboardName = setClipboardFn.id.name;

    editor.insertAt(
      memoDecl.start,
      `let __cutH=${reactRef}.useCallback(()=>{if(${inputName}==="")return;` +
      `void ${setClipboardName}(${inputName}).then(__raw=>{if(__raw)process.stdout.write(__raw);` +
      `${addNotificationName}({key:"selection-copied",text:"cut to clipboard",color:"success",priority:"immediate",timeoutMs:2000})}).catch(()=>{});` +
      `${clearInputHandler}()},[${inputName},${clearInputHandler},${addNotificationName}]);`,
    );

    const lastProp = handlersObject.properties[handlersObject.properties.length - 1];
    assert(lastProp, 'Could not find chatHandlers insertion point');
    editor.insertAt(lastProp.end, ',"chat:cut":__cutH');

    const lastDep = depsArray.elements[depsArray.elements.length - 1];
    assert(lastDep, 'Could not find chatHandlers deps insertion point');
    editor.insertAt(lastDep.end, ',__cutH');
  },
};

export default patch;
