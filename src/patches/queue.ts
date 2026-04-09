/**
 * Ctrl+Q Message Queue Patch
 *
 * Adds a "queue" feature: pressing Ctrl+Q enqueues the current input
 * with priority 'later', so it executes FIFO after the current turn
 * completes (one queued command per turn).
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'queue',
  name: 'Ctrl+Q Message Queue',
  description: 'Queue messages with Ctrl+Q to run sequentially after current turn',

  apply(ctx) {
    const { ast, editor, find, query, src, assert } = ctx;
    const { findFirst, findAll } = find;
    const {
      findArrayWithConsecutiveStrings,
      findObjectWithStringProps,
      findHookCallWithObjectKeys,
      findFunctionsContainingStrings,
      getDestructuredName,
    } = query;

    // ── Variable Discovery ────────────────────────────────────────────

    // chatHandlers useMemo (by string keys in its object)
    const chatHandlersMemo = findHookCallWithObjectKeys(ast, 'useMemo', [
      'chat:undo', 'chat:newline', 'chat:stash', 'chat:imagePaste',
    ]);
    assert(chatHandlersMemo, 'Could not find chatHandlers useMemo');
    const R = src(chatHandlersMemo.callee.object); // React namespace

    const handlersObject = findFirst(chatHandlersMemo.arguments[0], (n: any) =>
      n.type === 'ObjectExpression' &&
      n.properties.some((p: any) => p.type === 'Property' && p.key.type === 'Literal' && p.key.value === 'chat:undo'));
    assert(handlersObject, 'Could not find handlers object in useMemo');

    const depsArray = chatHandlersMemo.arguments[1];
    assert(depsArray?.type === 'ArrayExpression', 'Could not find deps array');

    // PromptInput function (by ObjectPattern param with known prop keys)
    const promptInputFn = findFirst(ast, (node: any) => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return false;
      const p = node.params[0];
      if (!p || p.type !== 'ObjectPattern') return false;
      return getDestructuredName(p, 'input') !== null &&
             getDestructuredName(p, 'mode') !== null &&
             getDestructuredName(p, 'pastedContents') !== null;
    });
    assert(promptInputFn, 'Could not find PromptInput component function');
    const propsPattern = promptInputFn.params[0];

    // Props from destructured parameter (keys preserved in minified code)
    const v: Record<string, any> = {};
    for (const name of ['input', 'mode', 'pastedContents', 'setPastedContents', 'onInputChange']) {
      v[name] = getDestructuredName(propsPattern, name);
      assert(v[name], `Could not find "${name}" in props destructuring`);
    }

    // setCursorOffset — from useState(input.length)
    const useStateCandidates = findAll(promptInputFn, (node: any) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'ArrayPattern' || node.id.elements.length < 2) return false;
      const init = node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'MemberExpression' || init.callee.property.name !== 'useState') return false;
      const arg = init.arguments[0];
      return arg?.type === 'MemberExpression' && arg.property.name === 'length' && arg.object.name === v.input;
    });
    assert(useStateCandidates.length === 1, `Expected 1 useState(${v.input}.length), found ${useStateCandidates.length}`);
    v.setCursorOffset = useStateCandidates[0].id.elements[1].name;

    // trackAndSetInput — useCallback with deps=[onInputChange]
    const trackCandidates = findAll(promptInputFn, (node: any) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier') return false;
      const init = node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'MemberExpression' || init.callee.property.name !== 'useCallback') return false;
      const deps = init.arguments[1];
      if (!deps || deps.type !== 'ArrayExpression' || deps.elements.length !== 1) return false;
      return deps.elements[0]?.name === v.onInputChange;
    });
    assert(trackCandidates.length === 1, `Expected 1 useCallback with deps=[${v.onInputChange}]`);
    v.trackAndSetInput = trackCandidates[0].id.name;

    // clearBuffer — from useInputBuffer destructuring (key preserved)
    const clearBufDecls = findAll(promptInputFn, (node: any) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'ObjectPattern') return false;
      return node.id.properties.some((p: any) => p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'clearBuffer') ||
         (p.key.type === 'Literal' && p.key.value === 'clearBuffer')));
    });
    assert(clearBufDecls.length >= 1, 'Could not find clearBuffer destructuring');
    v.clearBuffer = getDestructuredName(clearBufDecls[0].id, 'clearBuffer');

    // enqueue — function with push({...spread, priority: ?? "next"}) + "enqueue" string
    const enqueueCandidates = findFunctionsContainingStrings(ast, 'enqueue');
    const enqueueMatches = enqueueCandidates.filter((fn: any) =>
      findFirst(fn, (n: any) => {
        if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.property.name !== 'push') return false;
        const arg = n.arguments[0];
        if (!arg || arg.type !== 'ObjectExpression') return false;
        if (!arg.properties.some((p: any) => p.type === 'SpreadElement')) return false;
        const pp = arg.properties.find((p: any) => p.type === 'Property' && p.key.name === 'priority');
        return pp?.value.type === 'LogicalExpression' && pp.value.operator === '??' &&
               pp.value.right.type === 'Literal' && pp.value.right.value === 'next';
      }) !== null);
    assert(enqueueMatches.length === 1, `Expected 1 enqueue function, found ${enqueueMatches.length}`);
    v.enqueue = ctx.getFunctionName(enqueueMatches[0]);
    assert(v.enqueue, 'Could not determine enqueue function name');

    // expandPastedTextRefs — backward loop + .slice + .type/"text" + .index + .match
    const expandCandidates = findFunctionsContainingStrings(ast, 'text');
    const expandMatches = expandCandidates.filter((fn: any) => {
      if (fn.params.length !== 2) return false;
      if (!findFirst(fn, (n: any) => n.type === 'ForStatement' && n.update?.type === 'UpdateExpression' && n.update.operator === '--')) return false;
      if (findAll(fn, (n: any) => n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'slice').length < 2) return false;
      if (!findFirst(fn, (n: any) => n.type === 'MemberExpression' && n.property.name === 'index')) return false;
      if (!findFirst(fn, (n: any) => n.type === 'MemberExpression' && n.property.name === 'match')) return false;
      return findFirst(fn, (n: any) => {
        if (n.type !== 'BinaryExpression' || (n.operator !== '!==' && n.operator !== '===')) return false;
        const unwrap = (x: any) => x.type === 'ChainExpression' ? x.expression : x;
        const l = unwrap(n.left), r = unwrap(n.right);
        return (l.type === 'MemberExpression' && l.property.name === 'type' && n.right.value === 'text') ||
               (r.type === 'MemberExpression' && r.property.name === 'type' && n.left.value === 'text');
      }) !== null;
    });
    assert(expandMatches.length === 1, `Expected 1 expandPastedTextRefs, found ${expandMatches.length}`);
    v.expandPastedTextRefs = ctx.getFunctionName(expandMatches[0]);
    assert(v.expandPastedTextRefs, 'Could not determine expandPastedTextRefs name');

    // ── Patch 1: KEYBINDING_ACTIONS ───────────────────────────────────

    const arr = findArrayWithConsecutiveStrings(ast, 'chat:submit', 'chat:newline');
    assert(arr, 'Could not find KEYBINDING_ACTIONS array');
    const el = arr.elements.find((e: any) => e.type === 'Literal' && e.value === 'chat:submit');
    editor.insertAt(el.end, ',"chat:queue"');

    // ── Patch 2: DEFAULT_BINDINGS ─────────────────────────────────────

    const obj = findObjectWithStringProps(ast, [['enter', 'chat:submit'], ['up', 'history:previous']]);
    assert(obj, 'Could not find DEFAULT_BINDINGS object');
    const enterProp = obj.properties.find((p: any) => p.type === 'Property' &&
      ((p.key.type === 'Identifier' && p.key.name === 'enter') || (p.key.type === 'Literal' && p.key.value === 'enter')));
    editor.insertAt(enterProp.end, ',"ctrl+q":"chat:queue"');

    // ── Patch 3: handleQueue callback + chatHandlers ──────────────────

    const qH = '__qH';
    const code =
      `let ${qH}=${R}.useCallback(()=>{` +
      `let __t=${v.input}.trimEnd();if(__t==="")return;` +
      `let __f=${v.expandPastedTextRefs}(__t,${v.pastedContents});` +
      `${v.enqueue}({value:__f,preExpansionValue:__t,mode:${v.mode},` +
      `priority:"later",pastedContents:Object.values(${v.pastedContents})` +
      `.some(c=>c.type==="image")?${v.pastedContents}:void 0});` +
      `${v.trackAndSetInput}(""),${v.setCursorOffset}(0),` +
      `${v.setPastedContents}({}),${v.clearBuffer}()` +
      `},[${v.input},${v.pastedContents},${v.mode},${v.trackAndSetInput},` +
      `${v.setCursorOffset},${v.setPastedContents},${v.clearBuffer}]);`;

    const memoDecl = findFirst(ast, (n: any) => n.type === 'VariableDeclaration' && n.declarations.some((d: any) => d.init === chatHandlersMemo));
    assert(memoDecl, 'Could not find VariableDeclaration for chatHandlers useMemo');
    editor.insertAt(memoDecl.start, code);

    const lastProp = handlersObject.properties[handlersObject.properties.length - 1];
    editor.insertAt(lastProp.end, `,"chat:queue":${qH}`);

    const lastDep = depsArray.elements[depsArray.elements.length - 1];
    editor.insertAt(lastDep.end, `,${qH}`);

    // ── Patch 4: processQueueIfReady ──────────────────────────────────

    const processQueueFn = findFirst(ast, (node: any) => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression' && node.type !== 'ArrowFunctionExpression') return false;
      if (findAll(node, (n: any) => n.type === 'Property' && n.key.type === 'Identifier' && n.key.name === 'processed').length < 2) return false;
      return findFirst(node, (n: any) => n.type === 'BinaryExpression' && n.operator === '===' && n.right.type === 'Literal' && n.right.value === 'bash') !== null;
    });
    assert(processQueueFn, 'Could not find processQueueIfReady function');

    const ifStmt = findFirst(processQueueFn, (node: any) => {
      if (node.type !== 'IfStatement') return false;
      return findFirst(node.test, (n: any) => n.type === 'BinaryExpression' && n.operator === '===' &&
        n.left.type === 'MemberExpression' && n.left.property.name === 'mode' &&
        n.right.type === 'Literal' && n.right.value === 'bash') !== null;
    });
    assert(ifStmt, 'Could not find if-statement with .mode === "bash"');

    const bashCheck = findFirst(ifStmt.test, (n: any) => n.type === 'BinaryExpression' && n.operator === '===' &&
      n.left.type === 'MemberExpression' && n.left.property.name === 'mode' && n.right.value === 'bash');
    const nextVar = src(bashCheck.left.object);
    editor.insertAt(ifStmt.test.end, `||${nextVar}.priority==="later"`);

    const targetModeDecl = findFirst(processQueueFn, (node: any) => {
      if (node.type !== 'VariableDeclarator' || node.start <= ifStmt.end) return false;
      return node.init?.type === 'MemberExpression' && node.init.property.name === 'mode' && src(node.init.object) === nextVar;
    });
    assert(targetModeDecl, 'Could not find targetMode = next.mode');
    const targetModeVar = targetModeDecl.id.name;
    editor.insertAt(targetModeDecl.end, `,__p=${nextVar}.priority??"next"`);

    const dqamCallback = findFirst(processQueueFn, (node: any) => {
      if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') return false;
      if (node.start <= ifStmt.end) return false;
      return findFirst(node, (n: any) => n.type === 'BinaryExpression' && n.operator === '===' &&
        n.left.type === 'MemberExpression' && n.left.property.name === 'mode' &&
        n.right.type === 'Identifier' && n.right.name === targetModeVar) !== null;
    });
    assert(dqamCallback, 'Could not find dequeueAllMatching callback');

    const modeComparison = findFirst(dqamCallback, (n: any) => n.type === 'BinaryExpression' && n.operator === '===' &&
      n.left.type === 'MemberExpression' && n.left.property.name === 'mode' &&
      n.right.type === 'Identifier' && n.right.name === targetModeVar);
    const cbParam = dqamCallback.params[0].name;
    editor.insertAt(modeComparison.end, `&&(${cbParam}.priority??"next")===__p`);
  },
};

export default patch;
