/**
 * Session Usage Indicator
 *
 * Display both 5-hour session usage and context usage in the format:
 *   "25% session used · 15% context used"
 *
 * Every 7 seconds the "session used" portion flashes to the 5-hour
 * window reset time for 2 seconds before returning to the percentage.
 * The "% context used" tail stays put across both phases:
 *   "session resets in 2h 14m · 15% context used"
 *
 * Session usage comes from the unified rate-limit response headers
 * (five_hour.utilization / five_hour.resets_at), tracked on every API
 * call by claudeAiLimits.ts and exposed via getRawUtilization(). When
 * the session data isn't available yet (cold start, API keys without a
 * Claude.ai subscription, etc.) the "X% session used · " prefix is
 * omitted and only context usage is shown.
 *
 * This patch supersedes always-show-context — both patches edit the
 * same TokenWarning label template and will collide if enabled at the
 * same time. Pick one.
 *
 * Strategy:
 * 1. Locate TokenWarning via its unique "Context low" string.
 * 2. Resolve the minified name of getRawUtilization() by following the
 *    chain: ["five_hour","5h"] array → extractRawUtilization function →
 *    its assignment target (rawUtilization var) → the 0-arg function
 *    that returns that var.
 * 3. Drop the early-return gate so the indicator always renders.
 * 4. Neutralize the color when below the warning threshold.
 * 5. Soften "Context low" → "Context".
 * 6. Replace the auto-compact label template with an IIFE that swaps
 *    only the "session used" prefix between the utilization percent
 *    and a reset-time flash on a 7-second cycle (t%7 >= 5 ⇒ flash).
 * 7. Force TokenWarning to re-render every second by injecting a
 *    useSyncExternalStore call bound to a module-level ticker. The
 *    subscribe/snapshot closures are defined at module scope so
 *    they're stable across renders and React doesn't resubscribe.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'session-usage',
  name: 'Session Usage',
  description: "Show '25% session used · 15% context used' (flashes reset time every 5s)",
  // Off by default because it edits the same TokenWarning template as
  // always-show-context — the transform will auto-resolve the conflict
  // (dropping always-show-context) if a user enables both.
  defaultEnabled: false,
  conflictsWith: ['always-show-context'],

  apply(ctx) {
    const { ast, editor, find, index, assert, src } = ctx;
    const { findFirst } = find;

    // ── 1. Find TokenWarning via its "Context low" marker ───────────
    let marker: any = null;
    for (const [value, nodes] of index.literalsByValue) {
      if (typeof value === 'string' && value.includes('Context low')) {
        marker = nodes[0];
        break;
      }
    }
    if (!marker) {
      marker = findFirst(ast, (n: any) =>
        n.type === 'TemplateElement' &&
        n.value?.raw?.includes('Context low')
      );
    }
    assert(marker, 'Could not find "Context low" marker in bundle');

    const fn = index.enclosingFunction(marker);
    assert(fn, 'Could not find TokenWarning function');

    // ── 2. Resolve the minified name of getRawUtilization() ─────────
    //
    // Chain:
    //   (a) ArrayExpression ["five_hour","5h"] is inside extractRawUtilization
    //   (b) assignments of the form `V = extract(...)` give us the
    //       top-level rawUtilization var name
    //   (c) `function G(){return V}` — G is getRawUtilization
    const pair = findFirst(ast, (n: any) =>
      n.type === 'ArrayExpression' &&
      n.elements?.length === 2 &&
      n.elements[0]?.type === 'Literal' && n.elements[0].value === 'five_hour' &&
      n.elements[1]?.type === 'Literal' && n.elements[1].value === '5h'
    );
    assert(pair, 'Could not find ["five_hour","5h"] pair');

    const extractFn = index.enclosingFunction(pair);
    assert(extractFn?.id?.name,
      'Could not resolve extractRawUtilization function name');
    const extractName = extractFn.id.name;

    let rawVarName: string | null = null;
    for (const n of index.nodesByType.get('AssignmentExpression') || []) {
      if (
        n.right?.type === 'CallExpression' &&
        n.right.callee?.type === 'Identifier' &&
        n.right.callee.name === extractName &&
        n.left?.type === 'Identifier'
      ) {
        rawVarName = n.left.name;
        break;
      }
    }
    assert(rawVarName, 'Could not find rawUtilization variable assignment');

    let getterName: string | null = null;
    for (const n of index.nodesByType.get('FunctionDeclaration') || []) {
      if (n.params.length !== 0) continue;
      const body = n.body?.body;
      if (!body || body.length !== 1) continue;
      const ret = body[0];
      if (ret.type !== 'ReturnStatement') continue;
      if (
        ret.argument?.type === 'Identifier' &&
        ret.argument.name === rawVarName &&
        n.id?.name
      ) {
        getterName = n.id.name;
        break;
      }
    }
    assert(getterName, 'Could not find getRawUtilization getter function');

    // ── 3. Drop the early-return threshold gate ─────────────────────
    //
    //   if (!isAboveWarningThreshold || suppressWarning) return null;
    //                                   ^^^^^^^^^^^^^^^^
    // Keep only the right side so the indicator renders on every
    // turn, not just when we're within 20k tokens of the limit.
    const gate = findFirst(fn, (n: any) => {
      if (n.type !== 'IfStatement' || n.start >= marker.start) return false;
      const t = n.test;
      if (t.type !== 'LogicalExpression' || t.operator !== '||') return false;
      if (t.left.type !== 'UnaryExpression' || t.left.operator !== '!') return false;
      return findFirst(n.consequent, (r: any) =>
        r.type === 'ReturnStatement' &&
        r.argument?.type === 'Literal' &&
        r.argument.value === null
      ) !== null;
    });
    assert(gate, 'Could not find early-return gate in TokenWarning');

    const warnVar = gate.test.left.argument;
    assert(warnVar.type === 'Identifier',
      'Expected Identifier for isAboveWarningThreshold');

    editor.replaceRange(gate.test.start, gate.test.end, src(gate.test.right));

    // ── 4. Neutral color when below warning threshold ───────────────
    //
    //   isAboveErrorThreshold ? "error" : "warning"
    //                                     ^^^^^^^^^
    // → isAboveWarningThreshold ? "warning" : void 0
    //
    // Prevents the label from being yellow during the always-on state.
    const colorTernary = findFirst(fn, (n: any) =>
      n.type === 'ConditionalExpression' &&
      n.consequent.type === 'Literal' && n.consequent.value === 'error' &&
      n.alternate.type === 'Literal' && n.alternate.value === 'warning'
    );
    if (colorTernary) {
      editor.replaceRange(
        colorTernary.alternate.start,
        colorTernary.alternate.end,
        `${warnVar.name}?"warning":void 0`
      );
    }

    // ── 5. Soften "Context low" → "Context" ─────────────────────────
    const fnSrc = src(fn);
    const needle = 'Context low';
    let pos = 0;
    while ((pos = fnSrc.indexOf(needle, pos)) !== -1) {
      editor.replaceRange(
        fn.start + pos,
        fn.start + pos + needle.length,
        'Context'
      );
      pos += needle.length;
    }

    // ── 6. Replace the auto-compact label template ──────────────────
    //
    // Bundle has:
    //   f = W ? `${100-P}% context used` : `${P}% until auto-compact`
    //
    // W (reactiveOnlyMode) is always false in the public build, so the
    // template literal we want is the one containing "% until auto-compact".
    //
    // Replacement is an IIFE that only swaps the "session used" prefix
    // on a 7-second cycle. The "% context used" tail is fixed.
    //   t%7 in [0..4] → "25% session used · 15% context used"
    //   t%7 in [5..6] → "session resets in 2h 14m · 15% context used"
    //
    // If the 5-hour window data (r) isn't available the flash is
    // skipped and the "% session used · " prefix is omitted gracefully.
    const labelTpl = findFirst(fn, (n: any) =>
      n.type === 'TemplateLiteral' &&
      n.quasis.some((q: any) => q.value?.raw?.includes('% until auto-compact'))
    );
    assert(labelTpl, 'Could not find auto-compact label template literal');

    const pctVar = src(labelTpl.expressions[0]);
    const G = getterName;
    const iife =
      `(function(){` +
        `var r=${G}().five_hour,` +
            `t=Math.floor(Date.now()/1000),` +
            `c=(100-${pctVar})+"% context used";` +
        `if(r&&t%7>=5){` +
          `var s=Math.max(0,Math.floor(r.resets_at-Date.now()/1000)),` +
              `h=Math.floor(s/3600),` +
              `m=Math.floor((s%3600)/60),` +
              `p=h>0?"session resets in "+h+"h "+m+"m":` +
                 `m>0?"session resets in "+m+"m":` +
                 `"session resets in <1m";` +
          `return p+" \u00b7 "+c` +
        `}` +
        `return (r?Math.round(r.utilization*100)+"% session used \u00b7 ":"")+c` +
      `}())`;
    editor.replaceRange(labelTpl.start, labelTpl.end, iife);

    // ── 7. Force a re-render every second for the reset-time flash ──
    //
    // React only re-runs TokenWarning when its parent re-renders or a
    // subscribed store changes. To drive the 5-second flash cycle we
    // subscribe to a wall-clock ticker via useSyncExternalStore. The
    // subscribe + snapshot closures live at module scope so they're
    // stable across renders (otherwise React resubscribes every
    // render, setting up and tearing down a setInterval each time).
    //
    // React namespace: grab the identifier from an existing
    //   <ns>.createElement(...) call inside TokenWarning.
    const createEl = findFirst(fn, (n: any) =>
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      n.callee.property?.type === 'Identifier' &&
      n.callee.property.name === 'createElement' &&
      n.callee.object?.type === 'Identifier'
    );
    assert(createEl, 'Could not find createElement call in TokenWarning');
    const R = createEl.callee.object.name;

    // Module-level ticker helpers, inserted just before the function
    // declaration. The subscribe callback sets up a 1-second interval
    // that pokes React; the snapshot returns an integer that advances
    // every second so useSyncExternalStore detects the change.
    editor.insertAt(fn.start,
      `var __cxsusSub=function(cb){` +
        `var i=setInterval(cb,1000);` +
        `return function(){clearInterval(i)}` +
      `};` +
      `var __cxsusGet=function(){return Math.floor(Date.now()/1000)};`
    );

    // Hook call at the very top of the function body — unconditional
    // so it satisfies the rules of hooks. Insert after the opening
    // "{" of the BlockStatement.
    editor.insertAt(fn.body.start + 1,
      `${R}.useSyncExternalStore(__cxsusSub,__cxsusGet);`
    );
  },
};

export default patch;
