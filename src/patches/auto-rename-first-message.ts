/**
 * Auto /rename on first message
 *
 * Piggybacks on Claude Code's existing "generate Haiku title from first
 * message" hook inside REPL.tsx and persists the generated title the
 * same way `/rename` would — so the /resume picker and the terminal
 * tab both reflect it without the user having to type `/rename`.
 *
 * The stock behavior (in REPL.tsx around the titleDisabled/sessionTitle
 * guard) only stores the generated title in a local `haikuTitle`
 * useState slot, which drives the terminal tab title but nothing
 * persistent: no customTitle write, no /resume picker entry, no
 * project-cache update. This patch hooks that same `.then(title=>…)`
 * callback and fires `saveCustomTitle` + `saveAgentName` as
 * fire-and-forget side effects.
 *
 * We deliberately keep the patch surgical:
 *
 *  • We DON'T call `/rename`'s `call` function directly. Its
 *    `LocalJSXCommandContext` shape is tightly coupled to the command
 *    dispatcher (setMessages, onDone semantics, etc.) and constructing
 *    a valid one from inside onQueryImpl's .then callback is fragile.
 *    Persisting via the two sessionStorage helpers gives the same
 *    user-visible outcome with far less surface area.
 *
 *  • We DON'T update React state (`standaloneAgentContext.name`) for
 *    the prompt bar. That would require discovering the minified name
 *    of the local `store`/`setAppState` binding inside the REPL
 *    component, which is a separate discovery problem. The prompt-bar
 *    agent name refreshes from the transcript on the next session
 *    restart — acceptable for an opt-in convenience patch, and the
 *    terminal tab DOES update in the current session because
 *    `sessionTitle` is recomputed from the project cache on every
 *    render (REPL.tsx reads `getCurrentSessionTitle(getSessionId())`
 *    every time, and `saveCustomTitle` updates that cache synchronously).
 *
 *  • We kebab-case the generated title before persisting so the saved
 *    value looks like a `/rename` output rather than a sentence-case
 *    haiku title. Claude Code's built-in `generateSessionTitle` is
 *    prompted for sentence case ("Fix login button on mobile"); we
 *    lowercase and hyphenate inline so `/resume` shows
 *    "fix-login-button-on-mobile" — matching what the user gets from
 *    running `/rename` manually.
 *
 * Discovery strategy:
 *
 *  1. Find `/rename`'s `call` function via its unique teammate-block
 *     string literal (same anchor used by rename-random-color). Inside
 *     it, extract the minified identifiers for `saveCustomTitle`,
 *     `saveAgentName`, and `getSessionId` by matching their known
 *     call shapes — saveCustomTitle/saveAgentName are the two 3-arg
 *     awaited calls, getSessionId is the 0-arg call whose result is
 *     assigned to the variable later passed as the first arg to
 *     saveCustomTitle.
 *
 *  2. Find the REPL auto-title IfStatement by walking up from the
 *     unique string literal `"<local-command-stdout>"`. We verify the
 *     enclosing IfStatement contains all four command-tag literals
 *     (`<local-command-stdout>`, `<command-message>`, `<command-name>`,
 *     `<bash-input>`) in its test — that combination only appears in
 *     the REPL auto-title block per a grep of the cc-source tree.
 *
 *  3. Inside that IfStatement, find the `.then(arrow, …)` call (which
 *     wraps `generateSessionTitle(text, sig).then(…)`) and inject the
 *     persistence code at the very top of the arrow's body. The
 *     original body still runs afterward, so setHaikuTitle and the
 *     retry-flag bookkeeping are unchanged.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'auto-rename-first-message',
  name: 'Auto /rename on First Message',
  description: 'Persist an auto-generated session title on the first user message so /resume and the terminal tab reflect it without typing /rename',

  apply(ctx) {
    const { ast, editor, find, index, assert } = ctx;
    const { findFirst, findAll, walkAST } = find;

    // ── 1. Locate /rename's call function ──────────────────────────
    const renameMarker = findFirst(ast, (n: any) =>
      n.type === 'Literal' &&
      typeof n.value === 'string' &&
      n.value.startsWith('Cannot rename: This session is a swarm teammate'));
    assert(renameMarker, 'Could not find rename teammate-block string literal');

    const renameFn = index.enclosingFunction(renameMarker);
    assert(renameFn, 'Could not find enclosing rename call function');

    // ── 2. Extract saveCustomTitle / saveAgentName / getSessionId ──
    //
    // rename's call function does, in source order:
    //   const sessionId = getSessionId() as UUID         // 0-arg
    //   const fullPath  = getTranscriptPath()            // 0-arg
    //   await saveCustomTitle(sessionId, newName, fullPath)  // 3-arg await
    //   ...
    //   await saveAgentName(sessionId, newName, fullPath)    // 3-arg await
    //
    // Each awaited 3-arg CallExpression to a bare Identifier is one of
    // save{CustomTitle,AgentName}. generateSessionName is also awaited
    // but takes 2 args, so arity disambiguates. We sort by source
    // position to assign them deterministically.
    const threeArgAwaited = findAll(renameFn, (n: any) =>
      n.type === 'AwaitExpression' &&
      n.argument?.type === 'CallExpression' &&
      n.argument.callee?.type === 'Identifier' &&
      n.argument.arguments?.length === 3);
    assert(threeArgAwaited.length >= 2,
      `Expected >=2 three-arg awaited calls in rename, got ${threeArgAwaited.length}`);
    threeArgAwaited.sort((a: any, b: any) => a.start - b.start);

    const saveCustomTitleName = threeArgAwaited[0].argument.callee.name;
    const saveAgentNameName = threeArgAwaited[1].argument.callee.name;
    assert(saveCustomTitleName !== saveAgentNameName,
      'saveCustomTitle and saveAgentName resolved to the same identifier — discovery is wrong');

    // The first argument to saveCustomTitle is the local `sessionId`
    // variable. Trace it back to its VariableDeclarator to find which
    // 0-arg Identifier call initializes it — that identifier is
    // `getSessionId`. Using this trace (instead of "the first 0-arg
    // call in the function") avoids mis-picking `isTeammate()`, which
    // is also a 0-arg Identifier call earlier in the function.
    const sidArg = threeArgAwaited[0].argument.arguments[0];
    assert(sidArg?.type === 'Identifier',
      'Expected first arg of saveCustomTitle to be an Identifier (the sessionId var)');
    const sidVarName = sidArg.name;

    const sidDecl = findFirst(renameFn, (n: any) =>
      n.type === 'VariableDeclarator' &&
      n.id?.type === 'Identifier' && n.id.name === sidVarName &&
      n.init?.type === 'CallExpression' &&
      n.init.callee?.type === 'Identifier' &&
      (n.init.arguments?.length ?? -1) === 0);
    assert(sidDecl, `Could not find VariableDeclarator for ${sidVarName} initialized from a 0-arg call`);
    const getSessionIdName = sidDecl.init.callee.name;

    // ── 3. Locate the REPL auto-title IfStatement ─────────────────
    // In the bundle, the tag constants from xml.ts are NOT inlined
    // by the bundler — they remain as top-level const bindings
    // (e.g. `ND = "local-command-stdout"`). The REPL source code
    // `text.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}>`)` therefore
    // emits as `X.startsWith(`<${ND}>`)` — a TemplateLiteral argument
    // with one interpolation, NOT a plain Literal. We search for the
    // IfStatement whose test contains four such `.startsWith(tpl)`
    // calls with four distinct tag identifiers.
    //
    // Helper: does a CallExpression match `X.startsWith(`<${TAG}>`)`
    // where TAG is the name of some identifier? Returns that name, or
    // null if the shape doesn't match.
    const getTagFromStartsWith = (n: any): string | null => {
      if (n.type !== 'CallExpression') return null;
      const callee = n.callee;
      if (callee?.type !== 'MemberExpression') return null;
      if (callee.property?.type !== 'Identifier' || callee.property.name !== 'startsWith') return null;
      const arg = n.arguments?.[0];
      if (!arg || arg.type !== 'TemplateLiteral') return null;
      if (arg.expressions?.length !== 1) return null;
      if (arg.quasis?.length !== 2) return null;
      // Match the literal parts `<` and `>` — template literal quasi
      // `value` is an object with `raw` and `cooked`; we check raw.
      const q0 = arg.quasis[0]?.value?.raw ?? arg.quasis[0]?.value?.cooked;
      const q1 = arg.quasis[1]?.value?.raw ?? arg.quasis[1]?.value?.cooked;
      if (q0 !== '<' || q1 !== '>') return null;
      const expr = arg.expressions[0];
      if (expr?.type !== 'Identifier') return null;
      return expr.name;
    };

    // First find the minified names of the four tag constants so we
    // can positively confirm the IfStatement we find is the auto-title
    // block and not some other 4-startsWith structure that happens to
    // exist. Each tag is declared as `VAR = "<tagvalue>"` at the
    // module level, so we find its VariableDeclarator by the literal
    // value on its init.
    const tagValues = ['local-command-stdout', 'command-message', 'command-name', 'bash-input'];
    const tagVarNames = new Set<string>();
    for (const tagValue of tagValues) {
      const decl = findFirst(ast, (n: any) =>
        n.type === 'VariableDeclarator' &&
        n.id?.type === 'Identifier' &&
        n.init?.type === 'Literal' &&
        n.init.value === tagValue);
      assert(decl, `Could not find VariableDeclarator for tag "${tagValue}"`);
      tagVarNames.add(decl.id.name);
    }
    assert(tagVarNames.size === 4,
      `Expected 4 distinct tag identifiers, got ${tagVarNames.size}`);

    // Now scan every IfStatement for one whose test contains
    // startsWith calls referencing all four tag identifiers.
    const candidates = findAll(ast, (n: any) => n.type === 'IfStatement');
    let autoTitleIf: any = null;
    for (const cand of candidates) {
      const seen = new Set<string>();
      for (const c of walkAST(cand.test)) {
        const tagName = getTagFromStartsWith(c);
        if (tagName && tagVarNames.has(tagName)) seen.add(tagName);
      }
      if (seen.size === 4) {
        autoTitleIf = cand;
        break;
      }
    }
    assert(autoTitleIf, 'Could not find auto-title IfStatement referencing all four tag identifiers');

    // ── 4. Find the .then(arrow, …) callback ──────────────────────
    // Inside the auto-title block, the shape is
    //   <gen>(text, <signal>).then(T => { if(T) setHaikuTitle(T); else … }, () => { … })
    // We target the first-argument callback of that .then(). Don't
    // touch the rejection handler — persistence should only run on
    // success.
    const thenCall = findFirst(autoTitleIf, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (n.callee?.type !== 'MemberExpression') return false;
      if (n.callee.property?.type !== 'Identifier' || n.callee.property.name !== 'then') return false;
      const firstArg = n.arguments?.[0];
      if (!firstArg) return false;
      return firstArg.type === 'ArrowFunctionExpression' || firstArg.type === 'FunctionExpression';
    });
    assert(thenCall, 'Could not find .then(callback) inside auto-title IfStatement');

    const arrow = thenCall.arguments[0];
    assert(arrow.body?.type === 'BlockStatement',
      'Expected .then callback to have a BlockStatement body');
    assert(arrow.params?.length === 1 && arrow.params[0].type === 'Identifier',
      'Expected .then callback to have exactly one Identifier param');
    const titleParam = arrow.params[0].name;

    // ── 5. Inject persistence at the top of the arrow body ────────
    // Sequence:
    //   1. bail if the generated title is null/empty
    //   2. kebab-case it: lowercase → non-alnum to hyphens → trim
    //      hyphens. Gives "Fix login button on mobile" →
    //      "fix-login-button-on-mobile", matching /rename output style.
    //   3. fire saveCustomTitle and saveAgentName as fire-and-forget
    //      promises. Both are async; we attach .catch(()=>{}) so an
    //      unhandled rejection from disk errors doesn't crash Node.
    //   4. the surrounding try/catch covers the getSessionId() call
    //      and any synchronous throws. A failure here silently falls
    //      through to the original .then body — setHaikuTitle still
    //      runs, so at worst the feature no-ops for this turn.
    //
    // The original arrow body (setHaikuTitle + retry-flag logic) is
    // untouched and runs immediately after this preamble.
    const bodyStart = arrow.body.start + 1; // just inside the `{`
    const inject =
      `if(${titleParam}){try{` +
        `var __cxAR_T=(${titleParam}+"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");` +
        `if(__cxAR_T){` +
          `var __cxAR_S=${getSessionIdName}();` +
          `${saveCustomTitleName}(__cxAR_S,__cxAR_T).catch(function(){});` +
          `${saveAgentNameName}(__cxAR_S,__cxAR_T).catch(function(){});` +
        `}` +
      `}catch(e){}}`;
    editor.insertAt(bodyStart, inject);
  },
};

export default patch;
