/**
 * Delete Sessions Patch
 *
 * Adds Option+D (Opt+D / Alt+D) to delete the focused session from
 * the /resume picker. First Opt+D stages a confirmation overlay;
 * second Opt+D actually deletes the .jsonl transcript and related
 * per-session directories (file-history, session-env, and the sibling
 * subagent dir under .claude/projects/<slug>/<sessionId>/). Any other
 * key cancels.
 *
 * Addresses: https://github.com/anthropics/claude-code/issues/13514
 *
 * Why not Ctrl+D:
 *   The bundle's Global keybinding map hardcodes
 *   `"ctrl+d":"app:exit"`, and the keybinding manager calls
 *   `stopImmediatePropagation()` on match — so the second Ctrl+D
 *   gets swallowed by the exit handler before our `onKeyDown`
 *   handler ever sees it. The reserved-binding list even flags it
 *   as `"Cannot be rebound - used for exit (hardcoded)"`. Option+D
 *   has no global binding, so our handler sees both presses cleanly.
 *
 * Why the patch is more than just "rm the file":
 *
 *  1. The resume picker's LogSelector is memoized via the React
 *     Compiler, so adding confirmation UI that only appears when a
 *     module-level flag is set would never re-render. We inject a
 *     real `useState` hook near the top of LogSelector and drive the
 *     confirmation *render* through it. Because the key handler is
 *     also memoized (React Compiler caches the callback against a
 *     fixed deps list that we can't easily extend), reading the
 *     state value from the handler would give a stale closure — so
 *     the handler reads/writes a companion `useRef` whose `current`
 *     is always fresh at call time, then calls `setState` purely to
 *     force a re-render.
 *
 *  2. ResumeConversation passes `onLogsChanged` conditionally on
 *     `isCustomTitleEnabled()` — when that feature flag is off,
 *     LogSelector has no way to refresh its list. We rewrite the
 *     ternary so `onLogsChanged` is always passed, giving delete a
 *     reliable refresh path.
 *
 *  3. After the final return statement we override `g3` (the rendered
 *     root element) with a confirmation Box when the pending-delete
 *     state is set. This keeps the normal memo cache intact — on
 *     cancel we return the cached main UI unchanged.
 *
 *     CRITICAL: the current bundle delivers key events via an
 *     `onKeyDown` prop on the root Box (not `useInput`), so our
 *     confirmation Box MUST copy that same `onKeyDown` prop —
 *     otherwise the handler gets detached the moment the override
 *     renders, and the user's second Opt+D (or any cancel keystroke)
 *     never reaches the handler. We discover the key handler's
 *     variable name by finding the existing `onKeyDown` property in
 *     LogSelector's createElement calls.
 *
 *  4. The discoverable keyboard shortcut hint row at the bottom of
 *     the picker gets a new `Opt+D delete` entry, inserted right
 *     after the existing `Ctrl+R rename` hint, so users know the
 *     shortcut exists without having to read docs. The chord string
 *     is `"opt+d"` — the bundle's chord parser (`Ae6`) maps
 *     `opt`/`option`/`alt` to the same `.alt` token, and the display
 *     formatter (`tJz.alt`) renders it as "Opt" on macOS with the
 *     `modCase:"title"` format the other hints use.
 *
 * Variable discovery is driven by string markers from the original
 * TSX ("tengu_session_rename_started", "Resume Session", prop names
 * preserved through destructuring) so the patch is robust to the
 * React Compiler and minifier choices.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'delete-sessions',
  name: 'Delete Sessions from /resume',
  description: 'Opt+D in the resume picker deletes the focused session (confirm by pressing Opt+D again)',

  apply(ctx) {
    const { ast, editor, find, query, src, index, assert } = ctx;
    const { findFirst, findAll } = find;
    const { getDestructuredName } = query;

    // ── 1. Locate LogSelector function ──────────────────────────────
    // It's the only function that contains BOTH the header string
    // "Resume Session" and the "tengu_session_rename_started" event.
    const logSelectorFn = findFirst(ast, (n: any) => {
      if (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression') return false;
      const hasHeader = findFirst(n, (c: any) =>
        c.type === 'Literal' && c.value === 'Resume Session');
      if (!hasHeader) return false;
      return findFirst(n, (c: any) =>
        c.type === 'Literal' && c.value === 'tengu_session_rename_started') !== null;
    });
    assert(logSelectorFn, 'Could not find LogSelector function');

    // ── 2. Discover the React namespace from an existing useState call ──
    const firstUseState = findFirst(logSelectorFn, (n: any) =>
      n.type === 'CallExpression' &&
      n.callee.type === 'MemberExpression' &&
      n.callee.property.name === 'useState');
    assert(firstUseState, 'Could not find useState call in LogSelector');
    const reactNs = src(firstUseState.callee.object); // e.g. "Sq.default"

    // ── 3. Discover onLogsChanged's minified name ─────────────────────
    // LogSelector destructures its props into local names. The prop
    // KEYS are preserved (they're string-literal keys in the caller's
    // object expression), so we can look up by original name.
    // Recent bundles inline the props destructure into LogSelector's
    // function signature (`function LogSelector({logs, onSelect, ...})`)
    // instead of a separate `const {...} = t0` statement. Match the
    // ObjectPattern wherever it lives so both shapes work.
    const propsDestructure = findFirst(logSelectorFn, (n: any) => {
      if (n.type !== 'ObjectPattern') return false;
      return getDestructuredName(n, 'logs') !== null &&
             getDestructuredName(n, 'onSelect') !== null &&
             getDestructuredName(n, 'onCancel') !== null;
    });
    assert(propsDestructure, 'Could not find LogSelector props destructure');
    const onLogsChangedVar = getDestructuredName(propsDestructure, 'onLogsChanged');
    assert(onLogsChangedVar, 'Could not find onLogsChanged in LogSelector destructure');

    // ── 4. Locate the key handler (the one passed to useInput) ────────
    // It's a FunctionExpression containing "tengu_session_rename_started"
    // with a single param (the ink key event).
    // Current bundles declare the handler as a nested named function
    // (`function w7(u1){...}`); earlier bundles used an arrow/function
    // expression assigned to a local. Accept all three shapes.
    const keyHandler = findFirst(logSelectorFn, (n: any) => {
      if (n.type !== 'FunctionExpression' &&
          n.type !== 'ArrowFunctionExpression' &&
          n.type !== 'FunctionDeclaration') return false;
      if (n === logSelectorFn) return false;
      if (n.params.length !== 1) return false;
      return findFirst(n, (c: any) =>
        c.type === 'Literal' && c.value === 'tengu_session_rename_started') !== null;
    });
    assert(keyHandler, 'Could not find LogSelector key handler');
    assert(keyHandler.body?.type === 'BlockStatement',
      'Expected key handler to have a BlockStatement body');

    const keyVar = keyHandler.params[0].name; // e.g. "g1"

    // ── 5. Extract the focusedLog var from the rename if-statement ────
    // The rename branch's test looks like `key.ctrl && key.key==="r" && focusedLog`.
    // Walk up from the analytics call to its enclosing IfStatement, then
    // take the rightmost Identifier in the test expression — that's the
    // focusedLog variable (e.g. "q4").
    const renameCall = findFirst(keyHandler, (n: any) =>
      n.type === 'CallExpression' &&
      n.arguments[0]?.type === 'Literal' &&
      n.arguments[0].value === 'tengu_session_rename_started');
    assert(renameCall, 'Could not find tengu_session_rename_started call');

    let renameIf: any = renameCall;
    while (renameIf && renameIf.type !== 'IfStatement') {
      renameIf = index.parentMap.get(renameIf);
    }
    assert(renameIf, 'Could not find enclosing rename IfStatement');

    let testNode: any = renameIf.test;
    while (testNode.type === 'LogicalExpression') testNode = testNode.right;
    assert(testNode.type === 'Identifier',
      `Expected rightmost of rename test to be an Identifier, got ${testNode.type}`);
    const focusedLogVar = testNode.name; // e.g. "q4"

    // ── 6. Discover Box/Text component variable names ────────────────
    // Box is used with {flexDirection: "column", ...}; Text with just
    // {dimColor: true, ...}. Find one of each in LogSelector's createElements.
    const boxCall = findFirst(logSelectorFn, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (n.callee.type !== 'MemberExpression' || n.callee.property.name !== 'createElement') return false;
      const props = n.arguments[1];
      if (!props || props.type !== 'ObjectExpression') return false;
      return props.properties.some((p: any) =>
        p.type === 'Property' &&
        p.key.type === 'Identifier' && p.key.name === 'flexDirection');
    });
    assert(boxCall, 'Could not find a Box createElement call');
    const boxVar = src(boxCall.arguments[0]);

    const textCall = findFirst(logSelectorFn, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (n.callee.type !== 'MemberExpression' || n.callee.property.name !== 'createElement') return false;
      const props = n.arguments[1];
      if (!props || props.type !== 'ObjectExpression') return false;
      // Text with {dimColor: true} and no layout props
      const hasDimColor = props.properties.some((p: any) =>
        p.type === 'Property' &&
        p.key.type === 'Identifier' && p.key.name === 'dimColor');
      const hasLayout = props.properties.some((p: any) =>
        p.type === 'Property' &&
        p.key.type === 'Identifier' &&
        (p.key.name === 'flexDirection' || p.key.name === 'paddingLeft' || p.key.name === 'flexShrink'));
      return hasDimColor && !hasLayout;
    });
    assert(textCall, 'Could not find a Text createElement call');
    const textVar = src(textCall.arguments[0]);

    // ── 6b. Discover the key handler variable name ──────────────────
    // The current bundle attaches the key handler via an `onKeyDown`
    // prop on the root Box (earlier bundles used `useInput`). Find any
    // Property whose key is `onKeyDown` with an Identifier value — that
    // identifier is what the confirmation Box needs to re-use, or
    // every key after the first Ctrl+D goes into the void.
    const onKeyDownProp = findFirst(logSelectorFn, (n: any) => {
      if (n.type !== 'Property') return false;
      const isOnKeyDown =
        (n.key.type === 'Identifier' && n.key.name === 'onKeyDown') ||
        (n.key.type === 'Literal' && n.key.value === 'onKeyDown');
      return isOnKeyDown && n.value.type === 'Identifier';
    });
    assert(onKeyDownProp, 'Could not find onKeyDown prop on a LogSelector element');
    const keyHandlerVar = onKeyDownProp.value.name;

    // ── 6c. Locate the Ctrl+R KeyboardShortcutHint to discover its
    //        component variable and as an anchor for inserting Ctrl+D ─
    // The hint row renders entries like
    //   createElement(l8, {chord: "ctrl+r", action: "rename", format: {...}})
    // We look up the ctrl+r entry (which is always present) and inject
    // a matching ctrl+d entry right after it.
    const ctrlRHint = findFirst(logSelectorFn, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (n.callee.type !== 'MemberExpression' || n.callee.property.name !== 'createElement') return false;
      const props = n.arguments[1];
      if (!props || props.type !== 'ObjectExpression') return false;
      const chord = props.properties.find((p: any) =>
        p.type === 'Property' &&
        p.key.type === 'Identifier' && p.key.name === 'chord');
      return !!chord && chord.value.type === 'Literal' && chord.value.value === 'ctrl+r';
    });
    assert(ctrlRHint, 'Could not find ctrl+r KeyboardShortcutHint call');
    const shortcutHintVar = src(ctrlRHint.arguments[0]);

    // ── 7. Locate the final return statement in LogSelector ─────────
    // Early bundles memoized the main UI into an Identifier and did
    // `return g3;`. Current bundles return the createElement call
    // directly (`return S7.default.createElement(u, {...}, ...);`).
    // Either shape is fine — we'll wrap the return's argument in a
    // conditional at Step 10.
    const directReturns = findAll(logSelectorFn, (n: any) =>
      n.type === 'ReturnStatement').filter((r: any) =>
      index.enclosingFunction(r) === logSelectorFn);
    assert(directReturns.length > 0, 'No return statements found in LogSelector');
    directReturns.sort((a: any, b: any) => a.start - b.start);
    const lastReturn = directReturns[directReturns.length - 1];
    assert(lastReturn.argument,
      'Final return in LogSelector has no argument');

    // ── 8. Inject the useState hook at the top of LogSelector ────────
    // Place it right before the first useState call so it sits in the
    // same phase of the function as existing hooks.
    let firstUseStateStmt: any = firstUseState;
    while (firstUseStateStmt) {
      const parent = index.parentMap.get(firstUseStateStmt);
      if (!parent) break;
      if (parent.type === 'BlockStatement' && parent === logSelectorFn.body) break;
      firstUseStateStmt = parent;
    }
    assert(firstUseStateStmt && index.parentMap.get(firstUseStateStmt) === logSelectorFn.body,
      'Could not find top-level statement wrapping the first useState');

    // The ref holds the current pending-delete path and is read by
    // the memoized key handler — refs are stable across renders so
    // the handler's closure always sees the latest value.
    // The state exists purely to trigger a re-render when the ref
    // changes, so the confirmation overlay appears/disappears.
    editor.insertAt(firstUseStateStmt.start,
      `let __cxDR=${reactNs}.useRef(null),` +
      `__cxDS=${reactNs}.useState(null),__cxDP=__cxDS[0],__cxSDP=__cxDS[1];`);

    // ── 9. Inject Opt+D handling at the top of the key handler ──────
    const keyBodyStart = keyHandler.body.start + 1; // inside the `{`

    // The handler:
    //  • Opt+D on a focused log sets pending or, if already pending,
    //    deletes the .jsonl and related per-session directories, clears
    //    pending, and calls onLogsChanged to refresh the list.
    //  • Any other key while pending clears the pending state (so
    //    navigation still works during the "confirm?" prompt).
    //
    // The modifier check is `(key.meta || key.alt)`: node's terminal
    // input layer can set either flag depending on the terminal's
    // Option-key mode (Terminal.app/iTerm can send Option as an Esc
    // prefix — `.meta` — or as a raw alt modifier — `.alt`). We accept
    // both so the binding works across common mac terminal setups.
    //
    // All fs/path/os calls are inside try/catch so a missing ancillary
    // directory never blocks deletion of the main transcript.
    // The bundle is ESM (`"type": "module"` in the npm package),
    // so CJS `require()` is not defined at runtime. We resolve fs via
    // `await import("node:fs/promises")` instead, and derive dir/base
    // from string ops so we don't also need to resolve node:path.
    const deleteHandler =
      `if((${keyVar}.meta||${keyVar}.alt)&&${keyVar}.key==="d"&&${focusedLogVar}&&${focusedLogVar}.fullPath){` +
        `if(typeof ${keyVar}.preventDefault==="function")${keyVar}.preventDefault();` +
        `if(__cxDR.current===${focusedLogVar}.fullPath){` +
          `const __cxDp=${focusedLogVar}.fullPath;` +
          `const __cxSlash=Math.max(__cxDp.lastIndexOf("/"),__cxDp.lastIndexOf("\\\\"));` +
          `const __cxDir=__cxSlash>=0?__cxDp.slice(0,__cxSlash):"";` +
          `const __cxBase=__cxSlash>=0?__cxDp.slice(__cxSlash+1):__cxDp;` +
          `const __cxSid=__cxBase.replace(/\\.jsonl$/,"");` +
          `const __cxH=(process.env.HOME||process.env.USERPROFILE||"");` +
          `const __cxTargets=[` +
            `__cxDir+"/"+__cxSid,` +
            `__cxH+"/.claude/file-history/"+__cxSid,` +
            `__cxH+"/.claude/session-env/"+__cxSid` +
          `];` +
          `import("node:fs/promises").then((__cxFs)=>` +
            `__cxFs.unlink(__cxDp).catch(()=>{}).then(()=>` +
              `Promise.all(__cxTargets.map((__cxR)=>__cxFs.rm(__cxR,{recursive:true,force:true}).catch(()=>{})))` +
            `)` +
          `).catch(()=>{}).finally(()=>{try{if(typeof ${onLogsChangedVar}==="function")${onLogsChangedVar}()}catch(e){}});` +
          `__cxDR.current=null;` +
          `__cxSDP(null);` +
        `}else{` +
          `__cxDR.current=${focusedLogVar}.fullPath;` +
          `__cxSDP(${focusedLogVar}.fullPath);` +
        `}` +
        `return;` +
      `}` +
      `if(__cxDR.current){__cxDR.current=null;__cxSDP(null);}`;

    editor.insertAt(keyBodyStart, deleteHandler);

    // ── 10. Override the rendered root when pending-delete is set ────
    // Wrap the return's argument in a conditional: if __cxDP holds a
    // path, render a confirmation Box instead of the normal tree. The
    // confirmation Box copies `onKeyDown` from the discovered key
    // handler variable so keys still reach the handler — without this,
    // the second Opt+D (and every cancel keystroke) drops on the floor.
    //
    // The Opt+D shortcut hint (see § 10b) lives INSIDE this return
    // expression, so we can't do a separate editor.insertAt for it —
    // the replaceRange below would overwrite the inserted bytes.
    // Instead, we splice the hint into the original argument source
    // at the ctrl+r hint's byte offset and bake it into the replacement.
    // Ink's bundled keydown plumbing delivers keys by bubbling from a
    // focused element — not by attaching `onKeyDown` to any Box. The
    // main picker works because the inner TreeSelect/FlatOptionsSelect
    // has focus and its keystrokes bubble up to LogSelector's root
    // Box. Our confirmation overlay has no focusable children, so
    // WITHOUT `tabIndex: 0` + `autoFocus: true` on the overlay Box,
    // no element in the tree has focus and keydown events never fire.
    // User-visible symptom: the first Opt+D renders the overlay, but
    // neither the second Opt+D nor any cancel key reaches the handler.
    // `key: "cx-del-confirm"` forces React to treat this as a new
    // element rather than an in-place prop update of the main return
    // Box. `autoFocus: true` only fires on mount, and without the key
    // bump React reuses the outer Box (same type, same position in
    // the conditional) on the normal → confirm transition, so focus
    // is never grabbed and keys are never delivered.
    const confirmExpr =
      `${reactNs}.createElement(${boxVar},{key:"cx-del-confirm",flexDirection:"column",paddingLeft:2,paddingTop:1,tabIndex:0,autoFocus:true,onKeyDown:${keyHandlerVar}},` +
        `${reactNs}.createElement(${textVar},{bold:true,color:"red"},"Delete this session?"),` +
        `${reactNs}.createElement(${textVar},{dimColor:true},String(__cxDP)),` +
        `${reactNs}.createElement(${boxVar},{paddingTop:1},` +
          `${reactNs}.createElement(${textVar},null,"Press "),` +
          `${reactNs}.createElement(${textVar},{bold:true},"Opt+D"),` +
          `${reactNs}.createElement(${textVar},null," again to confirm, any other key to cancel")` +
        `)` +
      `)`;

    // ── 10b. Opt+D shortcut hint, injected into the row in-place ─────
    // Placed immediately after the existing Ctrl+R rename hint so the
    // row reads "...Ctrl+V Preview · Ctrl+R Rename · Opt+D Delete · ..."
    // The `"opt+d"` chord is normalized by the bundle's chord parser
    // (Ae6) to the `.alt` token, and tJz.alt renders as "Opt" on macOS
    // with the `modCase:"title"` format the other hints already use.
    const optDHint =
      `,${reactNs}.createElement(${shortcutHintVar},` +
      `{chord:"opt+d",action:"delete",format:{modCase:"title",charCase:"upper"}})`;

    const origReturnSrc = src(lastReturn.argument);
    const hintOffsetInReturn = ctrlRHint.end - lastReturn.argument.start;
    assert(hintOffsetInReturn >= 0 && hintOffsetInReturn <= origReturnSrc.length,
      'Ctrl+R hint is not inside LogSelector final return — anchor mismatch');
    const augmentedReturnSrc =
      origReturnSrc.slice(0, hintOffsetInReturn) + optDHint +
      origReturnSrc.slice(hintOffsetInReturn);

    editor.replaceRange(lastReturn.argument.start, lastReturn.argument.end,
      `(__cxDP?(${confirmExpr}):(${augmentedReturnSrc}))`);

    // ── 11. Always pass onLogsChanged from ResumeConversation ────────
    // The original code passes `isCustomTitleEnabled() ? () => loadLogs(...) : undefined`.
    // We rewrite that ternary to always evaluate the `then` branch, so
    // the delete handler can reliably refresh the list.
    //
    // Find the props object whose keys include both `onLogsChanged` and
    // `onSelect` (that's the LogSelector invocation from the bundled
    // ResumeConversation). If the onLogsChanged value is a conditional
    // expression, replace it with the consequent.
    const logSelectorInvocations = findAll(ast, (n: any) => {
      if (n.type !== 'ObjectExpression') return false;
      const hasOnLogs = n.properties.some((p: any) =>
        p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'onLogsChanged') ||
         (p.key.type === 'Literal' && p.key.value === 'onLogsChanged')));
      if (!hasOnLogs) return false;
      return n.properties.some((p: any) =>
        p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'onSelect') ||
         (p.key.type === 'Literal' && p.key.value === 'onSelect')));
    });
    assert(logSelectorInvocations.length >= 1,
      'Could not find LogSelector invocation object with onLogsChanged');

    let rewroteAtLeastOne = false;
    for (const obj of logSelectorInvocations) {
      const onLogsProp = obj.properties.find((p: any) =>
        p.type === 'Property' &&
        ((p.key.type === 'Identifier' && p.key.name === 'onLogsChanged') ||
         (p.key.type === 'Literal' && p.key.value === 'onLogsChanged')));
      if (!onLogsProp) continue;
      const v = onLogsProp.value;
      if (v?.type === 'ConditionalExpression') {
        editor.replaceRange(v.start, v.end, src(v.consequent));
        rewroteAtLeastOne = true;
      }
    }
    assert(rewroteAtLeastOne,
      'Could not rewrite onLogsChanged ternary on any LogSelector invocation');
  },
};

export default patch;
