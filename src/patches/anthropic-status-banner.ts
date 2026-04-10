/**
 * Anthropic Status Banner Patch
 *
 * Polls https://status.claude.com/api/v2/summary.json every 60s and renders
 * a one-line warning banner in the prompt footer whenever a Claude-Code-
 * relevant component (Claude Code or Claude API) is not fully operational,
 * or an unresolved incident targets one of those components.
 *
 * The banner appears as a new line directly below the "⏵⏵ bypass permissions
 * on" row in the PromptInputFooter, on the same (left) column so it doesn't
 * interfere with the right-side Notifications (context usage, auto-updater,
 * etc). It's sticky until the upstream status clears.
 *
 * The text is wrapped in an OSC 8 hyperlink to the incident shortlink (or
 * status.claude.com as fallback). Cmd+click opens it in supporting
 * terminals — same mechanism Claude Code uses for PR URLs.
 *
 * Testing knob: set CX_STATUS_FORCE=1 to render a fake "Test: degraded
 * performance" banner regardless of upstream status. Useful for verifying
 * layout without waiting for a real incident.
 *
 * Injection strategy — the React Compiler splits PromptInputFooterLeftSide
 * into two minified functions: an outer one (the real component — has
 * exitMessage/isPasting/isSearching early returns), and an inner "core"
 * function that renders the steady-state row containing "? for shortcuts".
 * Both live adjacent at module scope, not nested. We chain through them:
 *
 *   1. Anchor on the unique "? for shortcuts" literal. Its enclosing
 *      FunctionDeclaration is the inner core (call it `CoreFn`).
 *   2. Find the sole `createElement(CoreFn, …)` call site. Its enclosing
 *      FunctionDeclaration is the outer wrapper — this is the true
 *      PromptInputFooterLeftSide after minification (call it `LeftSideFn`).
 *   3. Find the sole `createElement(LeftSideFn, …)` call site — this sits
 *      inside PromptInputFooter. Its direct parent CallExpression is the
 *      left-column Box: createElement(Box, {flexDirection:"column", …},
 *      StatusLine?, LeftSideFn, …).
 *   4. Extract React (`callee.object`), Box (parent.arguments[0]), and
 *      Text (via a sibling `createElement(…, {dimColor:…})`) refs.
 *   5. Inject a module-scope function declaration `_cxStatusBanner` that
 *      owns polling + rendering.
 *   6. Insert `,createElement(_cxStatusBanner, {R,Box,Text})` right after
 *      the LeftSideFn createElement so it becomes the next column child
 *      (below "⏵⏵ bypass permissions on").
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'anthropic-status-banner',
  name: 'Anthropic Status Banner',
  description: 'Warn in the footer when status.claude.com reports issues affecting Claude Code',
  defaultEnabled: true,

  apply(ctx) {
    const { ast, editor, find, index, src, assert } = ctx;
    const { findFirst } = find;

    // Helper: find the sole createElement(FnName, …) call in the bundle.
    const findSoleCreateElementCall = (fnName: string) => {
      const hits: any[] = [];
      for (const n of index.allNodes) {
        if (n.type !== 'CallExpression') continue;
        if (n.callee?.type !== 'MemberExpression') continue;
        if (n.callee.property?.type !== 'Identifier') continue;
        if (n.callee.property.name !== 'createElement') continue;
        const first = n.arguments[0];
        if (first?.type === 'Identifier' && first.name === fnName) hits.push(n);
      }
      return hits;
    };

    // ── 1. Anchor: "? for shortcuts" literal → Core inner fn ──────────
    const hintLit = findFirst(ast, (n: any) =>
      n.type === 'Literal' && n.value === '? for shortcuts');
    assert(hintLit, 'Could not find "? for shortcuts" literal');

    const coreFn = index.enclosingFunction(hintLit);
    assert(
      coreFn && coreFn.type === 'FunctionDeclaration' && coreFn.id,
      'Could not find named FunctionDeclaration enclosing "? for shortcuts"',
    );
    const coreName = coreFn.id.name;

    // ── 2. createElement(CoreFn, …) → enclosing fn is LeftSideFn ──────
    const coreCalls = findSoleCreateElementCall(coreName);
    assert(
      coreCalls.length === 1,
      `Expected exactly 1 createElement(${coreName}, …) call, got ${coreCalls.length}`,
    );
    const coreRender = coreCalls[0];
    const leftSideFn = index.enclosingFunction(coreRender);
    assert(
      leftSideFn && leftSideFn.type === 'FunctionDeclaration' && leftSideFn.id,
      `Could not find named fn enclosing createElement(${coreName}, …)`,
    );
    const leftSideName = leftSideFn.id.name;

    // ── 3. createElement(LeftSideFn, …) → sits inside PromptInputFooter
    const leftSideCalls = findSoleCreateElementCall(leftSideName);
    assert(
      leftSideCalls.length === 1,
      `Expected exactly 1 createElement(${leftSideName}, …) call, got ${leftSideCalls.length}`,
    );
    const renderCall = leftSideCalls[0];
    const R = src(renderCall.callee.object);

    // ── 4. Parent createElement = left-column Box ─────────────────────
    const parentCall = index.parentMap.get(renderCall);
    assert(
      parentCall?.type === 'CallExpression' &&
        parentCall.callee?.type === 'MemberExpression' &&
        parentCall.callee.property?.name === 'createElement',
      'Expected LeftSideFn render to sit directly inside a createElement call',
    );
    const BoxRef = src(parentCall.arguments[0]);

    // Sanity check: the enclosing Box should have flexDirection:"column".
    // This catches regressions if the layout changes upstream.
    const parentProps = parentCall.arguments[1];
    const hasColumnProp =
      parentProps?.type === 'ObjectExpression' &&
      parentProps.properties.some(
        (p: any) =>
          p.type === 'Property' &&
          p.key?.type === 'Identifier' &&
          p.key.name === 'flexDirection' &&
          p.value?.type === 'Literal' &&
          p.value.value === 'column',
      );
    assert(
      hasColumnProp,
      'Expected LeftSideFn render to sit inside a column Box — layout changed?',
    );

    // ── 5. Text reference: walk up from the "? for shortcuts" anchor ──
    // The literal lives in `createElement(Text, {dimColor:!0, key:...},
    // "? for shortcuts")` — first arg of that call is Text. This is
    // robust because the anchor is already unique (we used it in step 1)
    // and the Text binding is a module-level identifier shared with the
    // enclosing PromptInputFooter scope (neither function declares it
    // locally).
    //
    // Earlier revisions tried `findFirst(footerFn, n => has(dimColor))`,
    // but that hit `<PromptInputHelpMenu dimColor>` (line 136 of the .tsx)
    // which is the first dimColor use in the footer. Using the
    // help-menu component as Text caused the banner to render the full
    // help menu twice — once per child.
    let textCallWalk: any = hintLit;
    for (let i = 0; i < 5; i++) {
      textCallWalk = index.parentMap.get(textCallWalk);
      if (!textCallWalk) break;
      if (
        textCallWalk.type === 'CallExpression' &&
        textCallWalk.callee?.type === 'MemberExpression' &&
        textCallWalk.callee.property?.name === 'createElement'
      ) {
        break;
      }
    }
    const footerFn = index.enclosingFunction(parentCall) || ast;
    assert(
      textCallWalk?.type === 'CallExpression' &&
        textCallWalk.arguments[0]?.type === 'Identifier',
      'Could not walk up from "? for shortcuts" to its wrapping createElement(Text, …)',
    );
    const TextRef = src(textCallWalk.arguments[0]);

    // ── 5b. Hooks namespace (possibly distinct from `R`) ──────────────
    // The bundler creates parallel React bindings in this scope: one used
    // only for createElement (our `R`, e.g. `eA`) and another used for
    // hooks like useMemo (e.g. `dX6`). They resolve to the same React
    // module at runtime, but each binding only has the properties the
    // containing source actually references — so `R.useState` may be
    // undefined even when useState works on the sibling binding.
    //
    // Find ANY *.useMemo / *.useState / *.useEffect / *.useRef member
    // expression inside the footer function and grab its object identifier.
    const hookCall = findFirst(footerFn, (n: any) => {
      if (n.type !== 'MemberExpression') return false;
      if (n.object?.type !== 'Identifier') return false;
      if (n.property?.type !== 'Identifier') return false;
      const p = n.property.name;
      return (
        p === 'useMemo' ||
        p === 'useState' ||
        p === 'useEffect' ||
        p === 'useRef' ||
        p === 'useCallback'
      );
    });
    assert(hookCall, 'Could not find a React hooks namespace (*.useMemo etc.)');
    const HooksRef = src(hookCall.object);

    // ── 6. Inject module-scope helper function declaration ────────────
    // Function declarations are hoisted, so appending at end-of-module is
    // safe: it's reachable from every call site.
    //
    // The function is self-initializing via globalThis so re-mounts don't
    // duplicate the poll interval. All work — fetch, filtering, state,
    // React hooks, OSC 8 wrapping — happens inside this one declaration.
    //
    // Color strategy: theme colors (RGB) don't survive wrap-ansi when
    // nested inside OSC 8 hyperlinks (see cc-source/src/utils/hyperlink.ts
    // comments). Use basic ANSI yellow (\x1b[33m) inline inside the OSC 8
    // sequence, and render it via <Text> without a color prop. The icon
    // stays in its own <Text color="warning"> since it's outside the link.
    const helper = `
function _cxStatusBanner(_cxProps){
  var R=_cxProps.R,H=_cxProps.H,Box=_cxProps.Box,Text=_cxProps.Text;
  var g=globalThis;
  if(!g._cxStatusInit){
    g._cxStatusInit=true;
    g._cxStatusState={indicator:"none",msg:""};
    g._cxStatusSubs=new Set();
    if(process.env.CX_STATUS_FORCE){
      g._cxStatusState={indicator:"minor",msg:"Test: "+process.env.CX_STATUS_FORCE};
    }
    g._cxStatusFetch=async function(){
      try{
        var ctrl=new AbortController();
        var to=setTimeout(function(){ctrl.abort();},10000);
        var res=await fetch("https://status.claude.com/api/v2/summary.json",{signal:ctrl.signal});
        clearTimeout(to);
        if(!res||!res.ok)return;
        var data=await res.json();
        var isRelevant=function(name){return name==="Claude Code"||(typeof name==="string"&&name.indexOf("Claude API")===0);};
        var rel=(data.components||[]).filter(function(c){return isRelevant(c&&c.name);});
        var prio={operational:0,under_maintenance:1,degraded_performance:2,partial_outage:3,major_outage:4};
        var worst="operational";
        for(var i=0;i<rel.length;i++){
          var st=rel[i].status;
          if((prio[st]||0)>(prio[worst]||0))worst=st;
        }
        var incidents=(data.incidents||[]).filter(function(inc){
          var comps=(inc&&inc.components)||[];
          for(var j=0;j<comps.length;j++)if(isRelevant(comps[j]&&comps[j].name))return true;
          return false;
        });
        var next;
        if(process.env.CX_STATUS_FORCE){return;}
        if(worst==="operational"&&incidents.length===0){
          next={indicator:"none",msg:""};
        }else{
          var label;
          if(incidents.length>0){
            label=incidents[0].name||"Ongoing incident";
          }else if(worst==="degraded_performance"){
            label="Degraded performance";
          }else if(worst==="partial_outage"){
            label="Partial outage";
          }else if(worst==="major_outage"){
            label="Major outage";
          }else if(worst==="under_maintenance"){
            label="Under maintenance";
          }else{
            label="Issue detected";
          }
          next={indicator:worst,msg:label};
        }
        g._cxStatusState=next;
        g._cxStatusSubs.forEach(function(cb){try{cb(next);}catch(_){}});
      }catch(_){/* swallow — offline etc */}
    };
    if(!process.env.CX_STATUS_FORCE)g._cxStatusFetch();
    var iv=setInterval(g._cxStatusFetch,60000);
    if(iv&&typeof iv.unref==="function")iv.unref();
  }
  var st=H.useState(g._cxStatusState);
  var state=st[0],setState=st[1];
  H.useEffect(function(){
    var cb=function(v){setState(Object.assign({},v));};
    g._cxStatusSubs.add(cb);
    return function(){g._cxStatusSubs.delete(cb);};
  },[]);
  if(!state||state.indicator==="none")return null;
  var linked="\\x1b]8;;https://status.claude.com\\x07"+"\\x1b[33m"+state.msg+"\\x1b[39m"+"\\x1b]8;;\\x07";
  return R.createElement(Box,{flexShrink:0},
    R.createElement(Text,{color:"warning"},"\\u26A0 "),
    R.createElement(Text,null,linked));
}
`;

    editor.insertAt(ast.end, helper);

    // ── 7. Insert createElement(_cxStatusBanner, …) as next sibling ──
    // Inject right after the PromptInputFooterLeftSide createElement
    // expression so it becomes the next argument-child of the parent
    // column Box. The leading comma completes the preceding argument.
    const bannerCall = `,${R}.createElement(_cxStatusBanner,{R:${R},H:${HooksRef},Box:${BoxRef},Text:${TextRef}})`;
    editor.insertAt(renderCall.end, bannerCall);
  },
};

export default patch;
