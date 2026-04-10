/**
 * Session Timer Patch
 *
 * Displays two timers in the prompt footer:
 *   Claude Active: 6m 15s (34%)
 *   Session: 18m 42s
 *
 * - "Claude Active" is the hero metric — time Claude was generating
 *   responses or running tools (tracked via the isLoading prop).
 * - "Session" is wall-clock time since the component first mounted.
 * - Percentage shows what fraction of the session Claude was active.
 *
 * Hooks into the same ModeIndicator function that cx-badge uses,
 * injecting React state/effect hooks to track and display the timers.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'session-timer',
  name: 'Session Timer',
  description: 'Show Claude active time and session duration in the footer',
  defaultEnabled: false,

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findFirst } = find;

    // ── Find ModeIndicator via "? for shortcuts" marker ──────────────

    const shortcutsHint = findFirst(ast, (n: any) =>
      n.type === 'Literal' && n.value === '? for shortcuts');
    assert(shortcutsHint, 'Could not find "? for shortcuts" literal');

    const modeIndicatorFn = findFirst(ast, (node: any) => {
      if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return false;
      let found = false;
      const check = (n: any) => {
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

    // ── Find the final <Box height={1} overflow="hidden"> return ─────

    const boxWithHeight1 = findFirst(modeIndicatorFn, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      return n.arguments.some((arg: any) => {
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

    // ── Extract React namespace, Box, and Text references ────────────

    const callee = boxWithHeight1.callee;
    let R: string;
    if (callee.type === 'MemberExpression') {
      R = src(callee.object);
    } else {
      R = src(callee);
    }

    const BoxRef = src(boxWithHeight1.arguments[0]);

    // Find Text component via " · " separator (same approach as cx-badge)
    const separatorCall = findFirst(modeIndicatorFn, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      return n.arguments.some((a: any) => a?.type === 'Literal' && a.value === ' · ');
    });
    assert(separatorCall, 'Could not find separator " · " createElement');
    const TextRef = src(separatorCall.arguments[0]);

    // ── Find isLoading in the function's props ───────────────────────
    // ModeIndicator receives destructured props: { mode, ..., isLoading, ... }
    // The param is an ObjectPattern; we need the minified local name for isLoading.

    const propsParam = modeIndicatorFn.params[0];
    assert(propsParam, 'ModeIndicator has no params');

    let isLoadingVar: string | null = null;
    if (propsParam.type === 'ObjectPattern') {
      for (const prop of propsParam.properties) {
        if (prop.type === 'Property' &&
            ((prop.key.type === 'Identifier' && prop.key.name === 'isLoading') ||
             (prop.key.type === 'Literal' && prop.key.value === 'isLoading'))) {
          isLoadingVar = prop.value.type === 'Identifier' ? prop.value.name
            : prop.value.type === 'AssignmentPattern' ? prop.value.left.name
            : null;
          break;
        }
      }
    }

    // If not destructured directly, the props may be accessed as t0.isLoading
    // (the React compiler pattern). In that case we use the param name directly.
    if (!isLoadingVar) {
      if (propsParam.type === 'Identifier') {
        isLoadingVar = `${propsParam.name}.isLoading`;
      } else {
        // Search for .isLoading member access in the function body
        const memberAccess = findFirst(modeIndicatorFn, (n: any) =>
          n.type === 'MemberExpression' &&
          n.property.type === 'Identifier' &&
          n.property.name === 'isLoading');
        assert(memberAccess, 'Could not find isLoading access in ModeIndicator');
        isLoadingVar = src(memberAccess);
      }
    }

    // ── Inject timer hooks at the start of the function body ─────────
    // We inject:
    //  1. A session start ref (persists across re-renders)
    //  2. A state variable for active accumulated ms
    //  3. A ref for tracking the loading-start timestamp
    //  4. A useEffect that reacts to isLoading changes
    //  5. A 1-second interval useEffect to force re-renders for session time

    const body = modeIndicatorFn.body;
    assert(body.type === 'BlockStatement', 'ModeIndicator body is not a block');

    // Insert right after the opening brace
    const insertPos = body.start + 1;

    // Timer formatting function (inline, no external deps)
    // Formats seconds into "Xm Ys" or "Xh Ym" depending on magnitude
    const fmtFn = `function __stFmt(ms){` +
      `var s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);` +
      `s=s%60;m=m%60;` +
      `if(h>0)return h+"h "+m+"m";` +
      `if(m>0)return m+"m "+s+"s";` +
      `return s+"s"` +
      `}`;

    // The hooks code. We use a global-ish object on window to persist state
    // across React re-renders without additional hook overhead. The session
    // start is captured once. Active time is accumulated via useEffect on
    // isLoading transitions.
    const hooksCode =
      // Timer state: [activeMs, forceUpdate counter]
      `var __stState=${R}.useState(function(){return{active:0,tick:0}});` +
      `var __stActive=__stState[0].active,__stTick=__stState[0].tick,__stSet=__stState[1];` +

      // Ref to persist session start and loading-start timestamp
      `var __stRef=${R}.useRef(null);` +
      `if(!__stRef.current)__stRef.current={start:Date.now(),loadStart:0};` +

      // Effect: track isLoading transitions
      `${R}.useEffect(function(){` +
        `var r=__stRef.current;` +
        `if(${isLoadingVar}){` +
          `if(!r.loadStart)r.loadStart=Date.now();` +
        `}else{` +
          `if(r.loadStart){` +
            `var elapsed=Date.now()-r.loadStart;` +
            `r.loadStart=0;` +
            `__stSet(function(p){return{active:p.active+elapsed,tick:p.tick}});` +
          `}` +
        `}` +
      `},[${isLoadingVar}]);` +

      // Effect: 1-second interval for live session clock + active clock while loading
      `${R}.useEffect(function(){` +
        `var id=setInterval(function(){` +
          `__stSet(function(p){` +
            `var r=__stRef.current;` +
            `var bonus=(r.loadStart?Date.now()-r.loadStart:0);` +
            `return{active:p.active+bonus,tick:p.tick+1};` +
          `});` +
          // Reset loadStart to now if still loading to avoid double-counting
          `if(__stRef.current.loadStart)__stRef.current.loadStart=Date.now();` +
        `},1000);` +
        `return function(){clearInterval(id)};` +
      `},[]);` +

      // Compute display values
      `var __stNow=Date.now();` +
      `var __stSessionMs=__stNow-(__stRef.current?__stRef.current.start:__stNow);` +
      `var __stActiveMs=__stActive;` +
      `var __stPct=__stSessionMs>0?Math.round(__stActiveMs/__stSessionMs*100):0;` +
      fmtFn;

    editor.insertAt(insertPos, hooksCode);

    // ── Inject timer display in the footer Box ───────────────────────
    // Add timer after the last child of the Box, right-aligned.
    // We add a spacer Box with flexGrow:1 and then the timer text.

    // The Box call ends with ')'. The children are all arguments after the
    // props object. We insert before the closing ')' of createElement.
    const boxEnd = boxWithHeight1.end;

    // Timer element: right-aligned, dimmed session timer with active hero metric
    const timerEl =
      `,${R}.createElement(${BoxRef},{flexGrow:1})` +
      `,${R}.createElement(${BoxRef},{flexShrink:0},` +
        `${R}.createElement(${TextRef},{dimColor:true},` +
          `"Active: "+__stFmt(__stActiveMs)` +
          `+(__stPct>0?" ("+__stPct+"%)":"")` +
          `+" \u00b7 Session: "+__stFmt(__stSessionMs)` +
        `)` +
      `)`;

    // Insert just before the closing paren of the createElement call
    editor.insertAt(boxEnd - 1, timerEl);
  },
};

export default patch;
