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

    // PromptInput function — the function that contains the chatHandlers
    // useMemo. In 2.1.108 `input` was dropped from props and is now read
    // locally inside the component, so we locate the function via the
    // memo instead of the (now-missing) `input` prop.
    const promptInputFn = ctx.index.enclosingFunction(chatHandlersMemo);
    assert(promptInputFn && promptInputFn.params[0]?.type === 'ObjectPattern',
      'Could not find PromptInput component function');
    const propsPattern = promptInputFn.params[0];

    // Props from destructured parameter (keys preserved in minified code).
    // `input` is intentionally not in this list — see below.
    const v: Record<string, any> = {};
    for (const name of ['mode', 'pastedContents', 'setPastedContents', 'onInputChange']) {
      v[name] = getDestructuredName(propsPattern, name);
      assert(v[name], `Could not find "${name}" in props destructuring`);
    }

    // input + setCursorOffset — from useState(X.length) where X is the
    // input string. X may be a prop (<=2.1.105) or a local hook result
    // (2.1.108+); either way there's exactly one such useState in the
    // component.
    const useStateCandidates = findAll(promptInputFn, (node: any) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'ArrayPattern' || node.id.elements.length < 2) return false;
      const init = node.init;
      if (!init || init.type !== 'CallExpression' || init.callee.type !== 'MemberExpression' || init.callee.property.name !== 'useState') return false;
      const arg = init.arguments[0];
      return arg?.type === 'MemberExpression' && arg.property.name === 'length' && arg.object.type === 'Identifier';
    });
    assert(useStateCandidates.length === 1, `Expected 1 useState(X.length), found ${useStateCandidates.length}`);
    v.input = useStateCandidates[0].init.arguments[0].object.name;
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

    // ── Patch 5: "queued ❯" marker on Ctrl+Q messages ─────────────────
    // HighlightedThinkingText renders each user message with `❯ text`.
    // Only commands enqueued via Ctrl+Q (priority="later") should get the
    // "queued" prefix — not regular Enter submissions that briefly pass
    // through the queue with priority="next". Since priority isn't in the
    // QueuedMessageContext, we cross-reference the command queue by text:
    // if isQueued AND a "later" command matches this message's text.

    // Find useCommandQueue — `function fl(){return X.useSyncExternalStore(id,id)}`
    const useCommandQueueFn = findFirst(ast, (node: any) => {
      if (node.type !== 'FunctionDeclaration' || node.params.length !== 0) return false;
      if (!node.body || node.body.type !== 'BlockStatement' || node.body.body.length !== 1) return false;
      const stmt = node.body.body[0];
      if (stmt.type !== 'ReturnStatement' || !stmt.argument) return false;
      const call = stmt.argument;
      if (call.type !== 'CallExpression' || call.callee.type !== 'MemberExpression') return false;
      if (call.callee.property.name !== 'useSyncExternalStore') return false;
      if (call.arguments.length !== 2) return false;
      return call.arguments.every((a: any) => a.type === 'Identifier');
    });
    assert(useCommandQueueFn, 'Could not find useCommandQueue function');
    const useQueueName = useCommandQueueFn.id.name;

    // Find HighlightedThinkingText — function that references both
    // `X.pointer` (figures.pointer) and `Y.isQueued` (queue context).
    const highlightedTextCandidates = findAll(ast, (node: any) => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return false;
      if (node.params.length !== 1) return false;
      const hasPointer = findFirst(node, (n: any) =>
        n.type === 'MemberExpression' &&
        n.property.type === 'Identifier' &&
        n.property.name === 'pointer' &&
        n.object.type === 'Identifier') !== null;
      if (!hasPointer) return false;
      return findFirst(node, (n: any) =>
        n.type === 'MemberExpression' &&
        n.property.type === 'Identifier' &&
        n.property.name === 'isQueued') !== null;
    });
    assert(highlightedTextCandidates.length === 1,
      `Expected 1 HighlightedThinkingText, found ${highlightedTextCandidates.length}`);
    const highlightedTextFn = highlightedTextCandidates[0];
    const htParam = highlightedTextFn.params[0].name;

    // Find the isQueued variable — VariableDeclarator whose init reads `.isQueued`
    const isQueuedDecl = findFirst(highlightedTextFn, (node: any) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) return false;
      return findFirst(node.init, (n: any) =>
        n.type === 'MemberExpression' &&
        n.property.type === 'Identifier' &&
        n.property.name === 'isQueued') !== null;
    });
    assert(isQueuedDecl, 'Could not find isQueued variable in HighlightedThinkingText');
    const isQueuedVar = isQueuedDecl.id.name;

    // Inject after the first statement (the combined `let K=…,O=…,$=…` decl):
    // compute __cxIsLater once per render. useCommandQueue() subscribes us
    // to queue changes so we re-render when the matching command is dequeued.
    const htFirstStmt = highlightedTextFn.body.body[0];
    assert(htFirstStmt, 'HighlightedThinkingText body is empty');
    const htInject =
      `let __cxQ=${useQueueName}();` +
      `let __cxIsLater=${isQueuedVar}&&__cxQ.some(function(c){` +
      `return c&&c.priority==="later"&&` +
      `(c.value===${htParam}.text||c.preExpansionValue===${htParam}.text)` +
      `});`;
    editor.insertAt(htFirstStmt.end, htInject);

    // Prepend "queued " before every `X.pointer` inside the function, gated
    // on __cxIsLater so only Ctrl+Q'd items get the marker.
    const pointerRefs = findAll(highlightedTextFn, (n: any) =>
      n.type === 'MemberExpression' &&
      n.property.type === 'Identifier' &&
      n.property.name === 'pointer' &&
      n.object.type === 'Identifier');
    assert(pointerRefs.length >= 1, 'Expected at least 1 pointer reference in HighlightedThinkingText');
    for (const ref of pointerRefs) {
      editor.insertAt(ref.start, `(__cxIsLater?"queued ":"")+`);
    }
  },
};

export default patch;
