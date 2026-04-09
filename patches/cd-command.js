/**
 * /cd Command Patch
 *
 * Adds a /cd <path> slash command to change the working directory
 * mid-session without losing conversation context.
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/3473 (54 👍)
 *
 * AST strategy: find the bundled setCwd function (via its "tengu_shell_set_cwd"
 * telemetry string) and getCwdState (via its named export mapping), then inject
 * a new LocalCommand into the memoized COMMANDS array. The command calls setCwd
 * and reports the new working directory.
 */

export default {
  id: 'cd-command',
  name: '/cd Command',
  description: '/cd <path> — change where bash commands run (same as shell cd, keeps project settings)',

  apply(ctx) {
    const { ast, editor, find, query, index, src, assert } = ctx;

    // ── 1. Find setCwd function via telemetry string ─────────────────
    // setCwd logs "tengu_shell_set_cwd" on success. The shell exec function
    // also logs it on failure, but inside an async arrow — setCwd is the
    // only sync FunctionDeclaration containing this string.
    const setCwdFns = query.findFunctionsContainingStrings(
      ast, 'tengu_shell_set_cwd',
    );
    assert(setCwdFns.length >= 1, 'Could not find functions with tengu_shell_set_cwd');
    const setCwdFn = setCwdFns.find(fn =>
      fn.type === 'FunctionDeclaration' && !fn.async);
    assert(setCwdFn, 'Could not find setCwd (sync FunctionDeclaration)');
    const setCwdName = ctx.getFunctionName(setCwdFn);
    assert(setCwdName, 'Could not determine setCwd function name');

    // ── 2. Find getCwdState via export mapping ───────────────────────
    // The state module exports: getCwdState:()=>XX
    // This is a Property with Identifier key and zero-param ArrowFunction value.
    const getCwdProp = find.findFirst(ast, n =>
      n.type === 'Property' &&
      n.key?.type === 'Identifier' && n.key.name === 'getCwdState' &&
      n.value?.type === 'ArrowFunctionExpression' &&
      n.value.params.length === 0 &&
      n.value.body?.type === 'Identifier');
    assert(getCwdProp, 'Could not find getCwdState export mapping');
    const getCwdName = getCwdProp.value.body.name;

    // ── 3. Find the COMMANDS array ───────────────────────────────────
    // Locate via the compact command: find its definition object, trace to
    // the exported variable, then find the large array containing it.
    const compactObj = query.findObjectWithStringProps(ast, [
      ['name', 'compact'],
      ['type', 'local'],
    ]);
    assert(compactObj, 'Could not find compact command definition');

    // Walk up to: localVar = {name:"compact",...}
    let assignNode = index.parentMap.get(compactObj);
    while (assignNode && assignNode.type !== 'AssignmentExpression') {
      assignNode = index.parentMap.get(assignNode);
    }
    assert(
      assignNode?.type === 'AssignmentExpression' &&
      assignNode.left?.type === 'Identifier',
      'Could not find compact assignment',
    );
    const localVar = assignNode.left.name;

    // Find re-export: exportVar = localVar
    const reExport = find.findFirst(ast, n =>
      n.type === 'AssignmentExpression' &&
      n.right?.type === 'Identifier' && n.right.name === localVar &&
      n.left?.type === 'Identifier' && n.left.name !== localVar);
    assert(reExport, 'Could not find compact re-export');
    const exportVar = reExport.left.name;

    // Find the array containing exportVar (COMMANDS has 40+ elements)
    const commandsArr = find.findFirst(ast, n => {
      if (n.type !== 'ArrayExpression') return false;
      if (n.elements.length < 20) return false;
      return n.elements.some(el =>
        el?.type === 'Identifier' && el.name === exportVar);
    });
    assert(commandsArr, 'Could not find COMMANDS array');

    // ── 4. Inject /cd command ────────────────────────────────────────
    // Insert as last concrete element, before the closing bracket.
    // The command calls setCwd (which validates path, resolves symlinks,
    // updates internal state) and returns the new CWD.
    const lastEl = commandsArr.elements[commandsArr.elements.length - 1];
    const cdCmd =
      `,{type:"local",name:"cd",description:"Change working directory"` +
      `,argumentHint:"<path>",supportsNonInteractive:true` +
      `,load:()=>Promise.resolve({call:async(q)=>{` +
        `let p=q.trim();` +
        `if(!p)return{type:"text",value:"Current directory: "+${getCwdName}()};` +
        `if(p.startsWith("~"))p=(process.env.HOME||"")+p.slice(1);` +
        `try{${setCwdName}(p);return{type:"text",value:"Changed to "+${getCwdName}()}}` +
        `catch(e){return{type:"text",value:e.message||"Failed to change directory"}}` +
      `}})}`;
    editor.insertAt(lastEl.end, cdCmd);
  },
};
