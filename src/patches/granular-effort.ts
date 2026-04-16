/**
 * Granular Effort Slider Patch
 *
 * Replaces the discrete low/medium/high/xhigh/max effort picker in `/model`
 * with a numeric slider. Users cycle the value with ← →, the integer persists
 * across sessions as-is (not the mapped canonical level), and the API call
 * receives a conventional low/medium/high/xhigh/max string derived at the
 * request boundary.
 *
 * Per-model range mirrors what the model actually supports (2 buckets per
 * supported level):
 *   - Opus 4.7   → 1..10 (low/medium/high/xhigh/max)
 *   - Opus 4.6   → 1..8  (low/medium/high/max — no xhigh)
 *   - Sonnet 4.6 → 1..8  (low/medium/high/max — no xhigh)
 *   - Haiku      → no slider, no banner suffix (effort param is unsupported)
 *
 * Scale (each pair maps to one level):
 *   1-2  → low
 *   3-4  → medium
 *   5-6  → high
 *   7-8  → xhigh (when supported) or max (when xhigh unsupported)
 *   9-10 → max (only when both xhigh and max are supported)
 *
 * Patch sites:
 *   1. cycleEffortLevel — numeric cycle via early-return prelude. Honors
 *      the function's includeMax (3rd arg) and includeXHigh (4th arg) so
 *      the cap matches the supported levels.
 *   2. ModelPicker display — replaces "<Capitalize(O6)> effort" suffix
 *      with " N/M" where M is the per-model cap (read from focusedSupportsMax
 *      and focusedSupportsXhigh, both extracted from the displayEffort clamp).
 *   3. convertEffortValueToLevel — pass numbers through unchanged so the
 *      picker re-initializes to the same integer the user picked.
 *   4. toPersistableEffort — allow numbers to flow to settings.
 *   5. Settings Zod schema — widen effortLevel from enum-of-strings to
 *      a union with int.
 *   6. API-layer effort assignment — map number → string right before the
 *      request body is built, using the model param (Y) to pick the right
 *      level set.
 *   7. getEffortSuffix template — startup banner says "with N/M effort",
 *      gated on model: omitted for haiku, /10 for opus-4-7, /8 otherwise.
 *
 * Works alongside persist-max-effort (which already appends "max" to the
 * effort enums). All edits are zero-width insertions so they compose
 * correctly with persist-max-effort's own zero-width insertions.
 */

import type { Patch } from '../types.js';

const patch: Patch = {
  id: 'granular-effort',
  name: 'Granular Effort Slider',
  description: 'Replace /model effort picker with a 1-10 numeric slider',
  defaultEnabled: true,

  apply(ctx) {
    const { ast, editor, find, src, assert } = ctx;
    const { findFirst } = find;

    // ── 1. cycleEffortLevel: prepend early-return numeric cycle ───────
    //
    // Source (bundle, post-2.1.111):
    //   function qhY(q,K,_,z){
    //     let Y=["low","medium","high"];
    //     if(z)Y.push("xhigh");
    //     if(_)Y.push("max");
    //     let A=Y.indexOf(q),O=A!==-1?A:Y.indexOf("high");
    //     if(K==="right")return Y[(O+1)%Y.length];
    //     else return Y[(O-1+Y.length)%Y.length];
    //   }
    //
    // Identified by the unique `Y.push("xhigh")` CallExpression — only one
    // function in the bundle pushes that string literal.
    //
    // We prepend an unconditional early-return sequence at the top of the
    // body rather than replacing it wholesale. This avoids a conflict with
    // persist-max-effort, which inserts `,"max"` into the 3-element array
    // literal inside this same body — a replaceRange here would partially
    // overlap that insert and corrupt the output. With an early return, the
    // original body becomes dead code and inserts inside it are harmless.
    const cycleFn = findFirst(ast, (n: any) => {
      if (n.type !== 'FunctionDeclaration' || n.params.length !== 4) return false;
      const xhighPush = findFirst(n, (c: any) =>
        c.type === 'CallExpression' &&
        c.callee?.type === 'MemberExpression' &&
        c.callee.property?.type === 'Identifier' &&
        c.callee.property.name === 'push' &&
        c.arguments.length === 1 &&
        c.arguments[0]?.type === 'Literal' &&
        c.arguments[0].value === 'xhigh',
      );
      return xhighPush !== null;
    });
    assert(cycleFn, 'Could not find cycleEffortLevel function');

    const [pV, pDir, pAllowMax, pAllowXhigh] = cycleFn.params.map((p: any) => p.name);

    // Build supported-levels list from includeMax/includeXHigh, allocate 2
    // integer slots per level. cap = lvls.length * 2 → 6, 8, or 10.
    // String inputs map to the midpoint of their bucket so they round-trip
    // cleanly through display. Stale values above cap clamp down.
    const cyclePrelude =
      `var _cxL=["low","medium","high"];` +
      `if(${pAllowXhigh})_cxL.push("xhigh");` +
      `if(${pAllowMax})_cxL.push("max");` +
      `var _cxMax=_cxL.length*2;` +
      `var _cxIdx=_cxL.indexOf(${pV});` +
      `var _cxY=typeof ${pV}==="number"?${pV}:` +
      `(_cxIdx>=0?(_cxIdx+1)*2:6);` +
      `if(_cxY>_cxMax)_cxY=_cxMax;` +
      `if(_cxY<1)_cxY=1;` +
      `if(${pDir}==="right")return _cxY>=_cxMax?1:_cxY+1;` +
      `return _cxY<=1?_cxMax:_cxY-1;`;
    editor.insertAt(cycleFn.body.start + 1, cyclePrelude);

    // ── 2. ModelPicker display text ──────────────────────────────────
    //
    // Source (bundle):
    //   createElement(jxK,{effort:O6})," ",
    //   O6==="xhigh"?"xHigh":gH6(O6)," ","effort",
    //   O6===n?" (default)":""," ",
    //   ...
    //
    // We replace the run from the xhigh-label ConditionalExpression through
    // the "(default)" ConditionalExpression with [Math.min(N,M),"/",M].
    //
    // The xhigh-label cond is unique: `O6==="xhigh"?"xHigh":gH6(O6)` — the
    // only ConditionalExpression in the bundle whose consequent is the
    // string literal "xHigh".
    //
    // To find the focusedSupportsMax and focusedSupportsXhigh variable
    // names we locate the displayEffort clamp:
    //   i?"xhigh":v==="max"&&!z6||v==="xhigh"&&!A6?"high":v
    // and pull `z6` and `A6` out of the negation operands.
    const xhighLabelCond = findFirst(ast, (n: any) =>
      n.type === 'ConditionalExpression' &&
      n.consequent?.type === 'Literal' &&
      n.consequent.value === 'xHigh');
    assert(xhighLabelCond, 'Could not find ModelPicker xhigh-label conditional');

    // Walk up to the createElement CallExpression containing this cond.
    let pickerCall: any = ctx.index.parentMap.get(xhighLabelCond);
    while (pickerCall && pickerCall.type !== 'CallExpression') {
      pickerCall = ctx.index.parentMap.get(pickerCall);
    }
    assert(pickerCall, 'Could not find createElement call wrapping xhigh-label cond');

    const callArgs = pickerCall.arguments;
    const xhighIdx = callArgs.indexOf(xhighLabelCond);
    assert(xhighIdx >= 0, 'xhigh-label cond not a direct child of the createElement call');

    // The "(default)" ConditionalExpression should follow at xhighIdx+3:
    //   [xhighIdx]   = O6==="xhigh"?"xHigh":gH6(O6)
    //   [xhighIdx+1] = " "
    //   [xhighIdx+2] = "effort"
    //   [xhighIdx+3] = O6===n?" (default)":""
    const defaultCond = callArgs[xhighIdx + 3];
    assert(
      defaultCond?.type === 'ConditionalExpression',
      'Expected " (default)" ConditionalExpression at xhighIdx+3',
    );
    const defaultLit = findFirst(defaultCond, (n: any) =>
      n.type === 'Literal' && n.value === ' (default)');
    assert(defaultLit, 'Default-marker conditional did not contain " (default)"');

    // The xhigh cond's test is `O6==="xhigh"` — extract the displayEffort
    // identifier (O6) from the left side.
    const dispVar = xhighLabelCond.test?.left?.name;
    assert(dispVar, 'Could not extract displayEffort variable name from xhigh cond');

    // Find the displayEffort clamp ConditionalExpression to extract
    // focusedSupportsMax and focusedSupportsXhigh:
    //   <test>?"high":<dispVar>
    // where <test> = `v==="max"&&!z6||v==="xhigh"&&!A6` (LogicalExpression ||)
    const dispClamp = findFirst(ast, (n: any) => {
      if (n.type !== 'ConditionalExpression') return false;
      if (n.consequent?.type !== 'Literal' || n.consequent.value !== 'high') return false;
      if (n.alternate?.type !== 'Identifier') return false;
      const t = n.test;
      if (t?.type !== 'LogicalExpression' || t.operator !== '||') return false;
      const matchesMaxClause = (e: any, lit: string) =>
        e?.type === 'LogicalExpression' && e.operator === '&&' &&
        e.left?.type === 'BinaryExpression' && e.left.operator === '===' &&
        e.left.right?.type === 'Literal' && e.left.right.value === lit &&
        e.right?.type === 'UnaryExpression' && e.right.operator === '!' &&
        e.right.argument?.type === 'Identifier';
      return matchesMaxClause(t.left, 'max') && matchesMaxClause(t.right, 'xhigh');
    });
    assert(dispClamp, 'Could not find displayEffort clamp ConditionalExpression');
    const supportsMaxVar = dispClamp.test.left.right.argument.name;
    const supportsXhighVar = dispClamp.test.right.right.argument.name;

    // Compose the replacement. M (cap) is computed from the support flags;
    // N (numerator) maps O6 to its bucket midpoint when it's still a string.
    const numExpr =
      `(typeof ${dispVar}==="number"?${dispVar}:` +
      `({low:2,medium:4,high:6,xhigh:8,max:10}[${dispVar}]||6))`;
    const capExpr =
      `((3+(${supportsXhighVar}?1:0)+(${supportsMaxVar}?1:0))*2)`;
    editor.replaceRange(
      xhighLabelCond.start, defaultCond.end,
      `Math.min(${numExpr},${capExpr}),"/",${capExpr}`,
    );

    // ── 3. convertEffortValueToLevel: preserve numbers ───────────────
    //
    // Source (bundle):
    //   function xt6(q){if(typeof q==="string")return kh8(q)?q:"high";return"high"}
    //
    // Identified structurally: a 1-param function whose body has a
    // `typeof q === "string"` check and returns the string literal "high"
    // at least twice (the two fallback returns).
    const convertFn = findFirst(ast, (n: any) => {
      if (
        (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression') ||
        n.params.length !== 1
      ) {
        return false;
      }
      const hasStringTypeof = findFirst(n, (c: any) =>
        c.type === 'BinaryExpression' &&
        c.operator === '===' &&
        c.left?.type === 'UnaryExpression' && c.left.operator === 'typeof' &&
        c.right?.type === 'Literal' && c.right.value === 'string',
      );
      if (!hasStringTypeof) return false;
      let highCount = 0;
      const scan = (node: any): void => {
        if (!node || typeof node !== 'object' || highCount >= 2) return;
        if (node.type === 'Literal' && node.value === 'high') highCount++;
        for (const k of Object.keys(node)) {
          if (k === 'type' || k === 'start' || k === 'end') continue;
          const v = node[k];
          if (Array.isArray(v)) for (const it of v) scan(it);
          else if (v && typeof v === 'object') scan(v);
        }
      };
      scan(n.body);
      return highCount >= 2;
    });
    assert(convertFn, 'Could not find convertEffortValueToLevel function');

    const convertParam = convertFn.params[0].name;
    editor.insertAt(
      convertFn.body.start + 1,
      `if(typeof ${convertParam}==="number")return ${convertParam};`,
    );

    // ── 4. toPersistableEffort: allow numbers through ───────────────
    //
    // Source (bundle):
    //   function It6(q){if(q==="low"||q==="medium"||q==="high"||q==="xhigh")return q;return}
    //
    // Identified by walking the rightmost-first-three values of a `||`
    // chain: the inner `(q==="low"||q==="medium")||q==="high"` subtree
    // exists in this function regardless of how many trailing comparisons
    // (xhigh, max) come after.
    const persistFn = findFirst(ast, (n: any) => {
      if (
        (n.type !== 'FunctionDeclaration' && n.type !== 'FunctionExpression') ||
        n.params.length !== 1
      ) {
        return false;
      }
      const chain = findFirst(n, (c: any) => {
        if (c.type !== 'LogicalExpression' || c.operator !== '||') return false;
        const values: string[] = [];
        let cur: any = c;
        while (cur && cur.type === 'LogicalExpression' && cur.operator === '||') {
          const r = cur.right;
          if (r?.type !== 'BinaryExpression' || r.operator !== '===' ||
              r.right?.type !== 'Literal') return false;
          values.unshift(r.right.value as string);
          cur = cur.left;
        }
        if (cur?.type !== 'BinaryExpression' || cur.operator !== '===' ||
            cur.right?.type !== 'Literal') return false;
        values.unshift(cur.right.value as string);
        return (
          values.length === 3 &&
          values[0] === 'low' &&
          values[1] === 'medium' &&
          values[2] === 'high'
        );
      });
      return chain !== null;
    });
    assert(persistFn, 'Could not find toPersistableEffort function');

    const persistParam = persistFn.params[0].name;
    editor.insertAt(
      persistFn.body.start + 1,
      `if(typeof ${persistParam}==="number")return ${persistParam};`,
    );

    // ── 5. Settings Zod schema: effortLevel accepts numbers ─────────
    //
    // Source (bundle, post-2.1.111):
    //   effortLevel:y.enum(["low","medium","high","xhigh"]).optional().catch(void 0)
    //
    // Wrap the `y.enum([...])` call in `y.union([ ..., y.number().int() ])`
    // so numeric values survive the `.catch(void 0)` guard on read.
    //
    // Identified structurally: a CallExpression with callee `<root>.enum`
    // whose first argument is the 4-element ["low","medium","high","xhigh"]
    // array. Other enum arrays in the bundle are 5 elements.
    const zodEnumCall = findFirst(ast, (n: any) => {
      if (n.type !== 'CallExpression') return false;
      if (
        n.callee.type !== 'MemberExpression' ||
        n.callee.property?.type !== 'Identifier' ||
        n.callee.property.name !== 'enum'
      ) {
        return false;
      }
      const arg = n.arguments[0];
      if (arg?.type !== 'ArrayExpression' || arg.elements.length !== 4) return false;
      return (
        arg.elements[0]?.type === 'Literal' && arg.elements[0].value === 'low' &&
        arg.elements[1]?.type === 'Literal' && arg.elements[1].value === 'medium' &&
        arg.elements[2]?.type === 'Literal' && arg.elements[2].value === 'high' &&
        arg.elements[3]?.type === 'Literal' && arg.elements[3].value === 'xhigh'
      );
    });
    assert(zodEnumCall, 'Could not find h.enum(["low","medium","high","xhigh"]) call');

    const zodRoot = src(zodEnumCall.callee.object);
    editor.insertAt(zodEnumCall.start, `${zodRoot}.union([`);
    editor.insertAt(zodEnumCall.end, `,${zodRoot}.number().int()])`);

    // ── 6. API effort assignment: map number → string ───────────────
    //
    // Source (bundle):
    //   function d6A(q,K,_,z,Y){
    //     if(!QI(Y)||"effort"in K)return;
    //     if(q===void 0)z.push(Qv1);
    //     else if(typeof q==="string")K.effort=q,z.push(Qv1)
    //   }
    //
    // The 5th arg (Y) is the model string. We use it to pick the right
    // level set. Levels mirror the runtime support detectors:
    //   xhigh: opus-4-7 only
    //   max:   opus-4-7, opus-4-6, sonnet-4-6 (other models that support
    //          effort drop through to no-max)
    //
    // Identified structurally: a FunctionDeclaration whose body contains a
    // `"effort" in X` BinaryExpression (unique in the bundle) AND assigns
    // to a MemberExpression with property name "effort".
    const apiEffortFn = findFirst(ast, (n: any) => {
      if (n.type !== 'FunctionDeclaration' || n.params.length < 5) return false;
      const hasInEffort = findFirst(n, (c: any) =>
        c.type === 'BinaryExpression' &&
        c.operator === 'in' &&
        c.left?.type === 'Literal' && c.left.value === 'effort',
      );
      if (!hasInEffort) return false;
      const hasEffortAssign = findFirst(n, (c: any) =>
        c.type === 'AssignmentExpression' &&
        c.left?.type === 'MemberExpression' &&
        c.left.property?.type === 'Identifier' &&
        c.left.property.name === 'effort',
      );
      return hasEffortAssign !== null;
    });
    assert(apiEffortFn, 'Could not find API effort assignment function');

    const apiParam = apiEffortFn.params[0].name;
    const apiModelParam = apiEffortFn.params[4].name;
    editor.insertAt(
      apiEffortFn.body.start + 1,
      `if(typeof ${apiParam}==="number"){` +
        `var _cxM=String(${apiModelParam}||"").toLowerCase();` +
        `var _cxXh=/opus-4-7/.test(_cxM);` +
        `var _cxMx=/opus-4-7|opus-4-6|sonnet-4-6/.test(_cxM);` +
        `var _cxL=["low","medium","high"];` +
        `if(_cxXh)_cxL.push("xhigh");` +
        `if(_cxMx)_cxL.push("max");` +
        `var _cxI=Math.ceil(${apiParam}/2)-1;` +
        `if(_cxI<0)_cxI=0;` +
        `if(_cxI>=_cxL.length)_cxI=_cxL.length-1;` +
        `${apiParam}=_cxL[_cxI];` +
      `}`,
    );

    // ── 7. getEffortSuffix: render "N/M effort" in the startup banner ──
    //
    // Source (bundle):
    //   function jy6(q,K){
    //     if(K===void 0)return"";
    //     let _=wy6(q,K);
    //     if(_===void 0)return"";
    //     return ` with ${xt6(_)} effort`
    //   }
    //
    // Rewrite the template literal so the banner reads
    //   "Opus 4.7 with 4/10 effort · Claude Max"   (xhigh + max)
    //   "Opus 4.6 with 5/8 effort · Claude Max"   (max only)
    //   "Haiku 4.5 · Claude Max"                   (no effort)
    // instead of the stock "with medium effort" wording.
    //
    // Match: a TemplateLiteral whose quasis are exactly [" with ", " effort"]
    // and whose single expression is a call to convertFn (xt6). The /model
    // picker has another " with " template, but that one's expression is a
    // chalk.bold(...) call, so the convertFn-name filter disambiguates.
    const convertName = convertFn.id?.name;
    assert(convertName, 'convertEffortValueToLevel must be a named declaration');

    const suffixTmpl = findFirst(ast, (n: any) => {
      if (n.type !== 'TemplateLiteral') return false;
      if (n.quasis.length !== 2 || n.expressions.length !== 1) return false;
      if (n.quasis[0]?.value?.cooked !== ' with ') return false;
      if (n.quasis[1]?.value?.cooked !== ' effort') return false;
      const expr = n.expressions[0];
      return (
        expr?.type === 'CallExpression' &&
        expr.callee?.type === 'Identifier' &&
        expr.callee.name === convertName
      );
    });
    assert(suffixTmpl, 'Could not find getEffortSuffix template literal');

    const suffixFn = ctx.index.enclosingFunction(suffixTmpl);
    assert(
      suffixFn && suffixFn.params.length >= 1,
      'getEffortSuffix enclosing function missing expected model param',
    );
    const modelParam = suffixFn.params[0].name;

    // The expression argument is `_` (the resolveAppliedEffort result).
    // Reuse it directly so the replacement stays in scope.
    const suffixInner = src(suffixTmpl.expressions[0].arguments[0]);
    // IIFE: model + suffixInner → "" | " with N/M effort". Inline because
    // the original site is a single expression returning a string.
    const newSuffixTmpl =
      '(function(_m,_v){' +
        'if(/haiku/i.test(_m))return"";' +
        'var _xh=/opus-4-7/i.test(_m);' +
        'var _mx=/opus-4-7|opus-4-6|sonnet-4-6/i.test(_m);' +
        'var _M=(3+(_xh?1:0)+(_mx?1:0))*2;' +
        'var _n=typeof _v==="number"?_v:' +
          '({low:2,medium:4,high:6,xhigh:8,max:10})[_v]||6;' +
        'if(_n>_M)_n=_M;' +
        'return" with "+_n+"/"+_M+" effort";' +
      '})(' + modelParam + ',' + suffixInner + ')';
    editor.replaceRange(suffixTmpl.start, suffixTmpl.end, newSuffixTmpl);
  },
};

export default patch;
